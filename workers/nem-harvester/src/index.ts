/**
 * NEM Data Harvester Worker
 * Continuously ingests AEMO price data to R2 storage
 */

import { parseDispatchRegionSum, parseDispatchPrice } from './parsers';
import { 
  localDateAEST, 
  localToUTCISO, 
  isTodayAEST, 
  sameLocalDate,
  expandDateRange,
  daySlotsAEST 
} from './dates';
import { putGzJson, getGzJson } from './storage';

export interface Env {
  NEM_R2: R2Bucket;
  DB: D1Database;
  BACKFILL_QUEUE: Queue;
  ADMIN_SECRET: string;
}

interface BackfillJob {
  date: string;
  type?: 'price' | 'fcas' | 'all';
}

const BASE_CURRENT = "https://www.nemweb.com.au/Reports/Current/DispatchIS_Reports/";
const BASE_ARCHIVE = "https://www.nemweb.com.au/Reports/Archive/DispatchIS_Reports/";
const BASE_CURRENT_PRICE = "https://www.nemweb.com.au/Reports/Current/Dispatch_SCADA/";
const BASE_ARCHIVE_PRICE = "https://www.nemweb.com.au/Reports/Archive/Dispatch_SCADA/";
const REGIONS = ['NSW1', 'QLD1', 'SA1', 'TAS1', 'VIC1'];
const FCAS_SERVICES = ['RAISE6SEC', 'LOWER6SEC', 'RAISE60SEC', 'LOWER60SEC', 'RAISE5MIN', 'LOWER5MIN', 'RAISEREG', 'LOWERREG'];

export default {
  // CRON: Pull latest live data every 2 minutes
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(updateLiveToday(env));
  },

  // QUEUE: Process backfill jobs
  async queue(batch: MessageBatch<BackfillJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await backfillDay(message.body.date, env);
        message.ack();
      } catch (error) {
        console.error(`Backfill failed for ${message.body.date}:`, error);
        message.retry();
      }
    }
  },

  // HTTP API
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Public API: Get day data
    if (path === '/api/day' || path === '/api/price') {
      const region = (url.searchParams.get('region') || 'VIC1').toUpperCase();
      const date = url.searchParams.get('date') || localDateAEST(new Date());
      
      // Try to get from R2
      const data = await getDayData(env, region, date);
      if (data) {
        return json({ success: true, source: 'r2', data }, corsHeaders);
      }

      // If today, try rolling today object
      if (date === localDateAEST(new Date())) {
        const todayData = await getTodayData(env, region);
        if (todayData) {
          return json({ success: true, source: 'r2-today', data: todayData }, corsHeaders);
        }
      }

      // Fallback to simulation
      return json({ 
        success: true, 
        source: 'simulation', 
        data: simulateDay(region, date) 
      }, corsHeaders);
    }

    // Admin API: Trigger backfill
    if (path === '/admin/backfill' && request.method === 'POST') {
      // Simple auth check
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }

      const { from, to } = await request.json() as { from: string; to: string };
      await enqueueBackfillRange(env, from, to);
      
      return json({ 
        success: true, 
        message: `Backfill enqueued from ${from} to ${to}` 
      }, corsHeaders);
    }

    // Admin API: Status
    if (path === '/admin/status') {
      const stats = await getSystemStats(env);
      return json(stats, corsHeaders);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

// --- Core Functions ---

async function updateLiveToday(env: Env): Promise<void> {
  console.log('Updating live data...');
  
  try {
    // Fetch current directory listing
    const response = await fetch(BASE_CURRENT);
    const html = await response.text();
    
    // Find DISPATCHREGIONSUM files
    const files = Array.from(
      html.matchAll(/href="(DISPATCHREGIONSUM_\d{12,14}\.CSV)"/gi)
    ).map(m => m[1]);
    
    if (!files.length) {
      console.log('No files found in current directory');
      return;
    }
    
    // Get the latest file
    files.sort();
    const latestFile = files[files.length - 1];
    
    // Check if we've already processed this file
    const lastProcessed = await env.DB.prepare(
      'SELECT value FROM system_state WHERE key = ?'
    ).bind('last_processed_file').first();
    
    if (lastProcessed?.value === latestFile) {
      console.log(`Already processed ${latestFile}`);
      return;
    }
    
    // Download and parse the file
    console.log(`Processing ${latestFile}`);
    const csvResponse = await fetch(BASE_CURRENT + latestFile);
    const csvText = await csvResponse.text();
    
    const rows = parseDispatchRegionSum(csvText);
    
    // Group by region and update today's data
    const byRegion = new Map<string, any[]>();
    for (const row of rows) {
      if (!byRegion.has(row.region)) {
        byRegion.set(row.region, []);
      }
      byRegion.get(row.region)!.push(row);
    }
    
    // Update each region's today file
    for (const [region, regionRows] of byRegion) {
      await mergeIntoToday(env, region, regionRows);
    }
    
    // Update last processed file
    await env.DB.prepare(
      'INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES (?, ?, datetime("now"))'
    ).bind('last_processed_file', latestFile).run();
    
    console.log(`Successfully processed ${latestFile}`);
    
    // Check if we need to roll over to a new day
    await checkDayRollover(env);
    
  } catch (error) {
    console.error('Error updating live data:', error);
  }
}

async function backfillDay(date: string, env: Env): Promise<void> {
  console.log(`Backfilling ${date}`);
  
  // Parse date to get year and month for archive path
  const [year, month] = date.split('-');
  const monthName = getMonthName(parseInt(month));
  
  // Construct archive URL
  const archiveUrl = `${BASE_ARCHIVE}${year}/${monthName}/`;
  
  try {
    // Fetch archive listing
    const response = await fetch(archiveUrl);
    const html = await response.text();
    
    // Find all DISPATCHREGIONSUM files for this date
    const datePattern = date.replace(/-/g, '');
    const files = Array.from(
      html.matchAll(new RegExp(`href="(DISPATCHREGIONSUM_${datePattern}\\d{4,6}\\.CSV)"`, 'gi'))
    ).map(m => m[1]);
    
    if (!files.length) {
      console.log(`No files found for ${date}`);
      return;
    }
    
    // Process all files for this day
    const allRows: any[] = [];
    for (const file of files) {
      const csvResponse = await fetch(archiveUrl + file);
      const csvText = await csvResponse.text();
      const rows = parseDispatchRegionSum(csvText);
      allRows.push(...rows.filter(r => sameLocalDate(r.timestamp, date)));
    }
    
    // Group by region and create day files
    const byRegion = new Map<string, any[]>();
    for (const row of allRows) {
      if (!byRegion.has(row.region)) {
        byRegion.set(row.region, []);
      }
      byRegion.get(row.region)!.push(row);
    }
    
    // Save each region's data
    for (const [region, rows] of byRegion) {
      const intervals = aggregateToIntervals(rows, date);
      const key = `nem/silver/day/${region}/${date}.json.gz`;
      
      await putGzJson(env.NEM_R2, key, intervals);
      
      // Update index
      await env.DB.prepare(
        'INSERT OR REPLACE INTO day_index (region, date, key, points, updated_at) VALUES (?, ?, ?, ?, datetime("now"))'
      ).bind(region, date, key, intervals.length).run();
    }
    
    console.log(`Successfully backfilled ${date}`);
    
  } catch (error) {
    console.error(`Error backfilling ${date}:`, error);
    throw error;
  }
}

async function enqueueBackfillRange(env: Env, from: string, to: string): Promise<void> {
  const dates = expandDateRange(from, to);
  
  for (const date of dates) {
    await env.BACKFILL_QUEUE.send({ date, type: 'price' });
  }
  
  console.log(`Enqueued ${dates.length} backfill jobs`);
}

async function mergeIntoToday(env: Env, region: string, newRows: any[]): Promise<void> {
  const key = `nem/silver/today/${region}.json.gz`;
  
  // Get existing today data
  const existing = await getGzJson(env.NEM_R2, key) || [];
  
  // Merge by timestamp
  const byTimestamp = new Map();
  for (const item of existing) {
    byTimestamp.set(item.timestamp, item);
  }
  
  for (const row of newRows) {
    const d = new Date(row.timestamp);
    const hour = d.getHours();
    const minute = d.getMinutes();
    
    byTimestamp.set(row.timestamp, {
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      hour,
      minute,
      price: row.price,
      timestamp: row.timestamp
    });
  }
  
  // Sort and save
  const merged = Array.from(byTimestamp.values())
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  
  await putGzJson(env.NEM_R2, key, merged);
}

async function checkDayRollover(env: Env): Promise<void> {
  const now = new Date();
  const currentHour = now.getUTCHours() + 10; // Rough AEST
  
  // If it's just after midnight AEST
  if (currentHour === 0 && now.getUTCMinutes() < 10) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = localDateAEST(yesterday);
    
    // Copy today files to day files for all regions
    for (const region of REGIONS) {
      const todayKey = `nem/silver/today/${region}.json.gz`;
      const dayKey = `nem/silver/day/${region}/${yesterdayStr}.json.gz`;
      
      const todayData = await getGzJson(env.NEM_R2, todayKey);
      if (todayData && todayData.length > 0) {
        await putGzJson(env.NEM_R2, dayKey, todayData);
        
        // Update index
        await env.DB.prepare(
          'INSERT OR REPLACE INTO day_index (region, date, key, points, updated_at) VALUES (?, ?, ?, ?, datetime("now"))'
        ).bind(region, yesterdayStr, dayKey, todayData.length).run();
        
        // Clear today file
        await putGzJson(env.NEM_R2, todayKey, []);
      }
    }
  }
}

async function getDayData(env: Env, region: string, date: string): Promise<any[] | null> {
  const key = `nem/silver/day/${region}/${date}.json.gz`;
  return await getGzJson(env.NEM_R2, key);
}

async function getTodayData(env: Env, region: string): Promise<any[] | null> {
  const key = `nem/silver/today/${region}.json.gz`;
  return await getGzJson(env.NEM_R2, key);
}

async function getSystemStats(env: Env): Promise<any> {
  const stats = await env.DB.prepare(`
    SELECT 
      COUNT(DISTINCT date) as days_loaded,
      COUNT(DISTINCT region) as regions,
      SUM(points) as total_points,
      MIN(date) as earliest_date,
      MAX(date) as latest_date
    FROM day_index
  `).first();
  
  return {
    success: true,
    stats,
    last_update: new Date().toISOString()
  };
}

function aggregateToIntervals(rows: any[], date: string): any[] {
  // Sort and dedupe by timestamp
  const byTimestamp = new Map();
  for (const row of rows) {
    byTimestamp.set(row.timestamp, row);
  }
  
  // Create 288 5-minute intervals
  const intervals = [];
  const slots = daySlotsAEST(new Date(date));
  
  for (const slot of slots) {
    const row = byTimestamp.get(slot.utcISO);
    intervals.push({
      time: `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`,
      hour: slot.hour,
      minute: slot.minute,
      price: row ? row.price : null,
      timestamp: slot.utcISO
    });
  }
  
  return intervals.filter(i => i.price !== null);
}

function simulateDay(region: string, date: string): any[] {
  // Fallback simulation (same as current)
  const intervals = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      const basePrice = 50;
      const hourlyPattern = Math.sin((hour - 6) * Math.PI / 12) * 30;
      const noise = (Math.random() - 0.5) * 10;
      
      intervals.push({
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        hour,
        minute,
        price: Math.max(0, basePrice + hourlyPattern + noise),
        timestamp: new Date(date).toISOString()
      });
    }
  }
  return intervals;
}

function getMonthName(month: number): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month - 1];
}

function json(data: any, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}
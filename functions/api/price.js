export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const region = (url.searchParams.get('region') || 'VIC1').toUpperCase();
  const requestedDate = url.searchParams.get('date'); // optional YYYY-MM-DD
  
  // Determine date range (single day if date provided, otherwise last 7 days)
  const end = requestedDate ? new Date(requestedDate) : new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (requestedDate ? 0 : 6)); // Single day or 7 days
  
  console.log(`Fetching AEMO data for ${region} from ${start.toISOString()} to ${end.toISOString()}`);
  
  try {
    // Build the list of months we need (current + maybe previous)
    const months = [];
    const now = new Date();
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    
    while (cur <= end) {
      const year = cur.getFullYear();
      const month = cur.getMonth() + 1;
      const yyyymm = `${year}${String(month).padStart(2, '0')}`;
      const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
      months.push({ yyyymm, isCurrent });
      cur.setMonth(cur.getMonth() + 1);
    }
    
    // Build URLs for AEMO CSVs
    const baseCurrent = 'https://www.nemweb.com.au/mms.GRAPHS/DATA/';
    const baseArchive = 'https://www.nemweb.com.au/mms.GRAPHS/data/';
    
    const urls = months.map(m => m.isCurrent
      ? `${baseCurrent}DATACURRENTMONTH_${region}.csv`
      : `${baseArchive}DATA${m.yyyymm}_${region}.csv`
    );
    
    console.log('Fetching AEMO CSV files:', urls);
    
    // Fetch all CSVs in parallel
    const responses = await Promise.all(
      urls.map(u => fetch(u).catch(err => {
        console.error(`Failed to fetch ${u}:`, err);
        return null;
      }))
    );
    
    // Combine all CSV text
    const texts = await Promise.all(
      responses.map(r => r && r.ok ? r.text() : '')
    );
    
    const csvData = texts.join('\n');
    
    if (!csvData || csvData.length < 100) {
      throw new Error('No CSV data retrieved from AEMO');
    }
    
    // Parse CSV and extract price data
    const intervals = [];
    const lines = csvData.split(/\r?\n/);
    
    // Date range for filtering
    const startKey = toDateKey(start); // 'YYYY/MM/DD'
    const endKey = toDateKey(end);
    
    console.log(`Parsing CSV data, filtering dates ${startKey} to ${endKey}`);
    
    for (const line of lines) {
      // Skip empty lines and headers
      if (!line || line.includes('REGION,') || line.startsWith('"REGION"')) continue;
      
      const parts = line.split(',');
      if (parts.length < 5) continue;
      
      // CSV format: REGION, SETTLEMENTDATE, TOTALDEMAND, RRP, PERIODTYPE
      const regionCol = parts[0].replace(/"/g, '').trim();
      const dateTimeStr = parts[1].replace(/"/g, '').trim(); // 'YYYY/MM/DD HH:MM:SS'
      const rrp = parseFloat(parts[3]);
      
      // Skip if not our region or invalid price
      if (regionCol !== region || !isFinite(rrp)) continue;
      
      // Extract date for filtering
      const dayKey = dateTimeStr.slice(0, 10); // 'YYYY/MM/DD'
      if (dayKey < startKey || dayKey > endKey) continue;
      
      // Parse datetime - AEMO times are in NEM time (AEST/AEDT)
      // Convert YYYY/MM/DD HH:MM:SS to parseable format
      const [datePart, timePart] = dateTimeStr.split(' ');
      if (!timePart) continue;
      
      const [year, month, day] = datePart.split('/');
      const [hour, minute, second] = timePart.split(':');
      
      // Create date in local time (will be converted to UTC for storage)
      const dt = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second) || 0
      );
      
      intervals.push({
        time: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`,
        hour: dt.getHours(),
        minute: dt.getMinutes(),
        price: rrp,
        timestamp: dt.toISOString()
      });
    }
    
    console.log(`Parsed ${intervals.length} price intervals from AEMO data`);
    
    if (intervals.length > 0) {
      // Sort by time
      intervals.sort((a, b) => {
        const timeA = a.hour * 60 + a.minute;
        const timeB = b.hour * 60 + b.minute;
        return timeA - timeB;
      });
      
      return new Response(JSON.stringify({
        success: true,
        data: intervals,
        source: 'aemo-nemweb',
        region: region,
        date: requestedDate || 'last-7-days',
        message: 'LIVE prices from AEMO NEMWeb',
        dataPoints: intervals.length
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }
    
    throw new Error('No price data found for the specified date range');
    
  } catch (error) {
    console.error('AEMO fetch failed:', error);
    
    // Fall back to simulation
    console.log('Falling back to NEM simulation');
    const intervals = generateNEMData(region, requestedDate || new Date().toISOString().split('T')[0]);
    
    return new Response(JSON.stringify({
      success: true,
      data: intervals,
      source: 'simulation',
      region: region,
      date: requestedDate || 'today',
      message: 'Using NEM market simulation (AEMO unavailable)',
      error: error.message
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }
}

// Helper function to format date as YYYY/MM/DD for comparison
function toDateKey(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// Handle preflight requests
export async function onRequestOptions({ request }) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// High-quality NEM simulation as fallback
function generateNEMData(region, date) {
  const intervals = [];
  const dateObj = new Date(date);
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
  const month = dateObj.getMonth();
  const isSummer = month >= 11 || month <= 2;
  const isWinter = month >= 5 && month <= 7;
  
  const profiles = {
    'NSW1': { 
      base: 85, 
      solar: isSummer ? 0.3 : 0.5, 
      peak: isSummer ? 1.8 : 1.4,
      volatility: 0.15
    },
    'QLD1': { 
      base: 80, 
      solar: isSummer ? 0.25 : 0.4, 
      peak: isSummer ? 1.9 : 1.3,
      volatility: 0.18
    },
    'SA1': { 
      base: 90, 
      solar: isSummer ? 0.2 : 0.35, 
      peak: isSummer ? 2.2 : 1.6,
      volatility: 0.25
    },
    'TAS1': { 
      base: 70, 
      solar: 0.7,
      peak: isWinter ? 1.5 : 1.2,
      volatility: 0.12
    },
    'VIC1': { 
      base: 88, 
      solar: isSummer ? 0.3 : 0.45, 
      peak: isSummer ? 2.0 : 1.5,
      volatility: 0.20
    }
  };
  
  const profile = profiles[region] || profiles['VIC1'];
  
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      const time = hour + minute / 60;
      let price = profile.base;
      
      // Duck curve pattern
      if (time >= 0 && time < 5) {
        price = profile.base * (0.4 + Math.random() * 0.2);
      } else if (time >= 5 && time < 6.5) {
        price = profile.base * (0.6 + (time - 5) * 0.4);
      } else if (time >= 6.5 && time < 9) {
        price = profile.base * profile.peak * (0.9 + Math.random() * 0.2);
      } else if (time >= 9 && time < 10) {
        price = profile.base * (1.1 + Math.random() * 0.1);
      } else if (time >= 10 && time < 15) {
        const solarImpact = Math.sin((time - 10) * Math.PI / 5);
        price = profile.base * (profile.solar + (1 - profile.solar) * (1 - solarImpact));
        
        if (region === 'SA1' && Math.random() < 0.1 && isSummer) {
          price = -10 - Math.random() * 40;
        }
      } else if (time >= 15 && time < 17) {
        price = profile.base * (0.8 + (time - 15) * 0.3);
      } else if (time >= 17 && time < 20.5) {
        const peakIntensity = 1 - Math.abs(18.5 - time) / 1.5;
        price = profile.base * profile.peak * (1 + peakIntensity * 0.3);
      } else if (time >= 20.5 && time < 22) {
        price = profile.base * (1.2 - (time - 20.5) * 0.3);
      } else {
        price = profile.base * (0.6 + Math.random() * 0.1);
      }
      
      if (isWeekend) price *= 0.75;
      
      price += (Math.random() - 0.5) * profile.base * profile.volatility;
      
      const spikeChance = isSummer ? 0.015 : 0.008;
      if (Math.random() < spikeChance) {
        price *= 3 + Math.random() * 7;
      }
      
      price = Math.max(-1000, Math.min(16600, price));
      
      intervals.push({
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        hour: hour,
        minute: minute,
        price: parseFloat(price.toFixed(2)),
        timestamp: new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), hour, minute).toISOString()
      });
    }
  }
  
  return intervals;
}
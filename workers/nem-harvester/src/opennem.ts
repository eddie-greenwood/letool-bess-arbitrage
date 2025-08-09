/**
 * OpenNEM API integration
 * Alternative data source that's simpler than AEMO direct
 */

export interface OpenNEMPrice {
  time: string;
  value: number;
}

export interface OpenNEMResponse {
  data: Array<{
    region: string;
    network: string;
    history: {
      data: number[];
      interval: string;
      start: string;
      last: string;
    };
  }>;
}

const OPENNEM_BASE = 'https://api.opennem.org.au';

/**
 * Fetch current price from OpenNEM
 */
export async function fetchLatestPrice(region: string): Promise<{
  timestamp: string;
  price: number;
  region: string;
}> {
  const url = `${OPENNEM_BASE}/stats/price/NEM/${region}?period=5m&last=1h`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenNEM API error: ${response.status}`);
  }
  
  const data: OpenNEMResponse = await response.json();
  
  if (!data.data || data.data.length === 0) {
    throw new Error('No data from OpenNEM');
  }
  
  const series = data.data[0];
  const prices = series.history.data;
  const latestPrice = prices[prices.length - 1];
  
  // Calculate timestamp from start and position
  const startTime = new Date(series.history.start);
  const intervalMinutes = 5;
  const latestTime = new Date(startTime.getTime() + (prices.length - 1) * intervalMinutes * 60 * 1000);
  
  return {
    timestamp: latestTime.toISOString(),
    price: latestPrice,
    region
  };
}

/**
 * Fetch historical day data from OpenNEM
 */
export async function fetchDayData(
  region: string, 
  date: string
): Promise<Array<{
  time: string;
  hour: number;
  minute: number;
  price: number;
  timestamp: string;
}>> {
  // OpenNEM uses date ranges
  const startDate = new Date(date);
  const endDate = new Date(date);
  endDate.setDate(endDate.getDate() + 1);
  
  const url = `${OPENNEM_BASE}/stats/price/NEM/${region}` +
    `?period=5m` +
    `&start=${startDate.toISOString().split('T')[0]}` +
    `&end=${endDate.toISOString().split('T')[0]}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenNEM API error: ${response.status}`);
  }
  
  const data: OpenNEMResponse = await response.json();
  
  if (!data.data || data.data.length === 0) {
    return [];
  }
  
  const series = data.data[0];
  const prices = series.history.data;
  const startTime = new Date(series.history.start);
  const intervalMinutes = 5;
  
  const intervals = [];
  
  for (let i = 0; i < prices.length; i++) {
    const time = new Date(startTime.getTime() + i * intervalMinutes * 60 * 1000);
    const hour = time.getHours();
    const minute = time.getMinutes();
    
    // Skip if not on the requested date (due to timezone differences)
    if (time.toISOString().split('T')[0] !== date) {
      continue;
    }
    
    intervals.push({
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      hour,
      minute,
      price: prices[i],
      timestamp: time.toISOString()
    });
  }
  
  return intervals;
}

/**
 * Fetch price range from OpenNEM
 */
export async function fetchPriceRange(
  region: string,
  startDate: string,
  endDate: string
): Promise<Array<{
  timestamp: string;
  price: number;
}>> {
  const url = `${OPENNEM_BASE}/stats/price/NEM/${region}` +
    `?period=5m` +
    `&start=${startDate}` +
    `&end=${endDate}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenNEM API error: ${response.status}`);
  }
  
  const data: OpenNEMResponse = await response.json();
  
  if (!data.data || data.data.length === 0) {
    return [];
  }
  
  const series = data.data[0];
  const prices = series.history.data;
  const startTime = new Date(series.history.start);
  const intervalMinutes = 5;
  
  return prices.map((price, i) => ({
    timestamp: new Date(startTime.getTime() + i * intervalMinutes * 60 * 1000).toISOString(),
    price
  }));
}

/**
 * Get all regions data for a specific time
 */
export async function fetchAllRegions(): Promise<Map<string, number>> {
  const regions = ['NSW1', 'QLD1', 'SA1', 'TAS1', 'VIC1'];
  const results = new Map<string, number>();
  
  await Promise.all(
    regions.map(async region => {
      try {
        const data = await fetchLatestPrice(region);
        results.set(region, data.price);
      } catch (error) {
        console.error(`Failed to fetch ${region}:`, error);
        results.set(region, 0);
      }
    })
  );
  
  return results;
}
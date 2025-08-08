/**
 * Cloudflare Worker for Lé Tool - OpenNEM Proxy
 * Mimics the local Flask proxy server functionality
 */

export default {
  async fetch(request) {
    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    
    // Test endpoint
    if (url.pathname === '/api/test') {
      return new Response(JSON.stringify({
        success: true,
        message: 'Proxy server running on Cloudflare Worker',
        timestamp: new Date().toISOString()
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        }
      });
    }
    
    // Price endpoint - matches Flask proxy format
    if (url.pathname.startsWith('/api/price/')) {
      const pathParts = url.pathname.split('/');
      const region = pathParts[3] || 'VIC1';
      const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
      
      // Generate realistic data matching the format your Flask proxy would return
      const data = generateNEMData(region, date);
      
      return new Response(JSON.stringify({
        success: true,
        data: data,
        source: 'simulation', // Change to 'opennem' when API works
        region: region,
        date: date
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        }
      });
    }
    
    // Multi-day endpoint
    if (url.pathname === '/api/price/multi') {
      const region = url.searchParams.get('region') || 'VIC1';
      const startDate = url.searchParams.get('start');
      const endDate = url.searchParams.get('end');
      
      const days = {};
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        days[dateStr] = generateNEMData(region, dateStr);
      }
      
      return new Response(JSON.stringify({
        success: true,
        days: days,
        source: 'simulation'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        }
      });
    }
    
    return new Response('Lé Tool OpenNEM Proxy', {
      headers: corsHeaders
    });
  }
};

// Generate NEM-style data matching your Flask proxy format
function generateNEMData(region, date) {
  const intervals = [];
  const dateObj = new Date(date);
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
  
  // Regional profiles based on actual NEM characteristics
  const profiles = {
    'NSW1': { base: 85, solar: 1.0, peak: 1.4 },
    'QLD1': { base: 80, solar: 1.2, peak: 1.3 },
    'SA1': { base: 90, solar: 1.3, peak: 1.6 },
    'TAS1': { base: 70, solar: 0.7, peak: 1.2 },
    'VIC1': { base: 88, solar: 0.9, peak: 1.5 }
  };
  
  const profile = profiles[region] || profiles['VIC1'];
  
  // Generate 5-minute intervals (288 per day)
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      const time = hour + minute / 60;
      let price = profile.base;
      
      // NEM duck curve pattern
      if (time >= 0 && time < 5) {
        // Night trough
        price = profile.base * 0.5;
      } else if (time >= 5 && time < 7) {
        // Morning ramp
        price = profile.base * (0.5 + (time - 5) * 0.35);
      } else if (time >= 7 && time < 9) {
        // Morning peak
        price = profile.base * profile.peak;
      } else if (time >= 9 && time < 11) {
        // Post-morning
        price = profile.base * 1.1;
      } else if (time >= 11 && time < 15) {
        // Solar minimum (duck belly)
        price = profile.base * (0.3 / profile.solar);
      } else if (time >= 15 && time < 17) {
        // Afternoon ramp (duck neck)
        price = profile.base * (0.4 + (time - 15) * 0.4);
      } else if (time >= 17 && time < 20) {
        // Evening peak (duck head)
        price = profile.base * profile.peak * 1.1;
      } else if (time >= 20 && time < 22) {
        // Evening decline
        price = profile.base * 0.9;
      } else {
        // Late night
        price = profile.base * 0.6;
      }
      
      // Weekend adjustment
      if (isWeekend) {
        price *= 0.75;
      }
      
      // Add volatility
      price += (Math.random() - 0.5) * 20;
      
      // Occasional spikes
      if (Math.random() < 0.02) {
        price *= 2 + Math.random() * 2;
      }
      
      // Bounds
      price = Math.max(-50, Math.min(500, price));
      
      intervals.push({
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        hour: hour,
        minute: minute,
        price: price,
        timestamp: new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), hour, minute).toISOString()
      });
    }
  }
  
  return intervals;
}
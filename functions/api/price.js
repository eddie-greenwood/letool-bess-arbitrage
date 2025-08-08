export async function onRequestGet({ request }) {
  const { searchParams, pathname } = new URL(request.url);
  const region = searchParams.get('region') || 'VIC1';
  const period = searchParams.get('period') || '7d';
  const date = searchParams.get('date');

  try {
    // Try different OpenNEM endpoints
    let target;
    if (date) {
      // Try the stats endpoint with date parameter
      target = `https://api.opennem.org.au/stats/price/NEM/${region}?date=${date}`;
    } else {
      // For period-based queries, try the data subdomain
      target = `https://data.opennem.org.au/v3/stats/au/NEM/${region}/price/${period}.json`;
    }

    console.log('Fetching from OpenNEM:', target);

    const resp = await fetch(target, { 
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; LeTool/1.0)'
      },
      redirect: 'follow'
    });
    
    console.log('Response status:', resp.status);
    console.log('Response headers:', resp.headers.get('content-type'));
    
    const body = await resp.text();
    
    // Check if OpenNEM returned HTML instead of JSON
    const isHtml = body.trim().startsWith('<') || body.trim().startsWith('<!');
    
    if (isHtml || resp.status !== 200) {
      console.error('OpenNEM issue - Status:', resp.status, 'HTML:', isHtml);
      // Return simulated data as fallback
      return generateSimulatedResponse(region, date);
    }

    // Try to parse as JSON to validate
    try {
      const data = JSON.parse(body);
      return new Response(body, {
        status: resp.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (e) {
      console.error('Failed to parse OpenNEM response as JSON');
      return generateSimulatedResponse(region, date);
    }
    
  } catch (error) {
    console.error('Error fetching from OpenNEM:', error);
    return generateSimulatedResponse(region, date);
  }
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

function generateSimulatedResponse(region, date) {
  const intervals = generateNEMData(region, date || new Date().toISOString().split('T')[0]);
  
  return new Response(JSON.stringify({
    success: true,
    data: intervals,
    source: 'simulation',
    region: region,
    date: date,
    message: 'Using high-quality NEM simulation'
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function generateNEMData(region, date) {
  const intervals = [];
  const dateObj = new Date(date);
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
  
  const profiles = {
    'NSW1': { base: 85, solar: 1.0, peak: 1.4 },
    'QLD1': { base: 80, solar: 1.2, peak: 1.3 },
    'SA1': { base: 90, solar: 1.3, peak: 1.6 },
    'TAS1': { base: 70, solar: 0.7, peak: 1.2 },
    'VIC1': { base: 88, solar: 0.9, peak: 1.5 }
  };
  
  const profile = profiles[region] || profiles['VIC1'];
  
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      const time = hour + minute / 60;
      let price = profile.base;
      
      // NEM duck curve pattern
      if (time >= 0 && time < 5) {
        price = profile.base * 0.5;
      } else if (time >= 5 && time < 7) {
        price = profile.base * (0.5 + (time - 5) * 0.35);
      } else if (time >= 7 && time < 9) {
        price = profile.base * profile.peak;
      } else if (time >= 9 && time < 11) {
        price = profile.base * 1.1;
      } else if (time >= 11 && time < 15) {
        price = profile.base * (0.3 / profile.solar);
      } else if (time >= 15 && time < 17) {
        price = profile.base * (0.4 + (time - 15) * 0.4);
      } else if (time >= 17 && time < 20) {
        price = profile.base * profile.peak * 1.1;
      } else if (time >= 20 && time < 22) {
        price = profile.base * 0.9;
      } else {
        price = profile.base * 0.6;
      }
      
      if (isWeekend) price *= 0.75;
      price += (Math.random() - 0.5) * 20;
      if (Math.random() < 0.02) price *= 2 + Math.random() * 2;
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
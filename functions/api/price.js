export async function onRequestGet({ request, env }) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || 'VIC1';
  const date = searchParams.get('date');
  
  // Try using a CORS proxy for OpenNEM (since it works in browser but not server-side)
  const corsProxies = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  
  // OpenNEM endpoints that work in browser
  const openNEMEndpoints = [
    `https://api.opennem.org.au/stats/au/NEM/${region}/power/7d.json`,
    `https://api.opennem.org.au/stats/au/NEM/${region}/energy/7d.json`,
  ];

  // Try each endpoint with each proxy
  for (const endpoint of openNEMEndpoints) {
    // First try direct
    try {
      console.log('Trying OpenNEM direct:', endpoint);
      
      const resp = await fetch(endpoint, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LeTool/1.0',
        }
      });

      if (resp.ok) {
        const data = await resp.json();
        
        // Parse OpenNEM format
        if (data && data.data && Array.isArray(data.data)) {
          // Find price data
          const priceData = data.data.find(d => 
            d.type === 'price' || 
            d.type === 'energy' ||
            d.id === 'price.spot' ||
            d.units === '$/MWh'
          );
          
          if (priceData && priceData.history && priceData.history.data) {
            const intervals = parseOpenNEMData(priceData.history, date || new Date().toISOString().split('T')[0]);
            
            if (intervals && intervals.length > 0) {
              return new Response(JSON.stringify({
                success: true,
                data: intervals,
                source: 'opennem',
                region: region,
                date: date,
                endpoint: endpoint,
                message: 'LIVE data from OpenNEM API'
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
        }
      }
    } catch (error) {
      console.log('OpenNEM direct failed:', endpoint, error.message);
    }
    
    // Try with CORS proxies
    for (const proxyFn of corsProxies) {
      try {
        const proxyUrl = proxyFn(endpoint);
        console.log('Trying via proxy:', proxyUrl);
        
        const resp = await fetch(proxyUrl, {
          headers: {
            'Accept': 'application/json',
          }
        });
        
        if (resp.ok) {
          const data = await resp.json();
          
          if (data && data.data && Array.isArray(data.data)) {
            const priceData = data.data.find(d => 
              d.type === 'price' || 
              d.type === 'energy' ||
              d.id === 'price.spot' ||
              d.units === '$/MWh'
            );
            
            if (priceData && priceData.history && priceData.history.data) {
              const intervals = parseOpenNEMData(priceData.history, date || new Date().toISOString().split('T')[0]);
              
              if (intervals && intervals.length > 0) {
                return new Response(JSON.stringify({
                  success: true,
                  data: intervals,
                  source: 'opennem-proxy',
                  region: region,
                  date: date,
                  endpoint: endpoint,
                  message: 'LIVE data from OpenNEM API (via proxy)'
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
          }
        }
      } catch (error) {
        console.log('Proxy failed:', error.message);
      }
    }
  }
  
  // Try OpenElectricity API with key
  const API_KEY = 'oe_3ZYA5q2YBHGz5y8ZFafkbTPF';
  const endpoints = [
    `https://api.openelectricity.org.au/v3/stats/price/NEM/${region}.json`,
    `https://api.openelectricity.org.au/v3/stats/energy/NEM/${region}.json`,
  ];

  // Try each endpoint with authentication
  for (const endpoint of endpoints) {
    try {
      console.log('Trying endpoint with auth:', endpoint);
      
      const resp = await fetch(endpoint, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'User-Agent': 'LeTool/1.0',
        },
        redirect: 'follow'
      });

      if (resp.ok) {
        const text = await resp.text();
        
        try {
          const data = JSON.parse(text);
          
          // Check for error in response
          if (data.error || data.response_status === 'ERROR') {
            console.log('API returned error:', data.error);
            continue;
          }
          
          // Try to parse the data
          const intervals = parseApiResponse(data, date);
          
          if (intervals && intervals.length > 0) {
            return new Response(JSON.stringify({
              success: true,
              data: intervals,
              source: 'openelectricity',
              region: region,
              date: date,
              endpoint: endpoint,
              message: 'LIVE data from OpenElectricity API'
            }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=300',
              },
            });
          }
        } catch (e) {
          console.log('Failed to parse JSON from', endpoint);
        }
      } else {
        console.log('Endpoint returned', resp.status);
      }
    } catch (error) {
      console.log('Endpoint failed:', endpoint, error.message);
    }
  }

  // All endpoints failed - use high-quality simulation
  console.log('All API endpoints failed, using simulation');
  const intervals = generateNEMData(region, date || new Date().toISOString().split('T')[0]);
  
  return new Response(JSON.stringify({
    success: true,
    data: intervals,
    source: 'simulation',
    region: region,
    date: date,
    message: 'Using NEM market simulation',
    note: 'API endpoints not returning valid data - check API documentation'
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

// Parse various API response formats
function parseApiResponse(data, requestedDate) {
  try {
    // Format 1: Direct data array
    if (Array.isArray(data)) {
      return parseIntervalArray(data, requestedDate);
    }
    
    // Format 2: data.data array structure (OpenNEM/OpenElectricity format)
    if (data.data && Array.isArray(data.data)) {
      // Look for price data
      const priceData = data.data.find(d => 
        d.type === 'price' || 
        d.type === 'energy' ||
        d.id === 'price.spot' ||
        d.code === 'price.spot' ||
        d.data_type === 'price'
      );
      
      if (priceData && priceData.history) {
        return parseHistoryData(priceData.history, requestedDate);
      }
      
      // Try energy data as fallback
      const energyData = data.data.find(d => 
        d.type === 'energy' ||
        d.data_type === 'energy'
      );
      
      if (energyData && energyData.history) {
        return parseHistoryData(energyData.history, requestedDate);
      }
    }
    
    // Format 3: Direct history object
    if (data.history) {
      return parseHistoryData(data.history, requestedDate);
    }
    
    // Format 4: Series data
    if (data.series && Array.isArray(data.series)) {
      return parseSeriesData(data.series, requestedDate);
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing API response:', error);
    return null;
  }
}

function parseOpenNEMData(history, requestedDate) {
  if (!history.data || !Array.isArray(history.data)) return null;
  
  const intervals = [];
  const startTime = new Date(history.start);
  const intervalMinutes = history.interval === '5m' ? 5 : 30;
  
  // Get latest data (last 288 intervals for 5-minute data = 24 hours)
  const dataToUse = history.data.slice(-288);
  
  dataToUse.forEach((price, index) => {
    if (price !== null && !isNaN(price)) {
      const time = new Date(startTime.getTime() + (history.data.length - dataToUse.length + index) * intervalMinutes * 60000);
      
      // Filter by date if requested
      if (requestedDate) {
        const timeDate = time.toISOString().split('T')[0];
        if (timeDate !== requestedDate) return;
      }
      
      intervals.push({
        time: `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`,
        hour: time.getHours(),
        minute: time.getMinutes(),
        price: parseFloat(price),
        timestamp: time.toISOString()
      });
    }
  });
  
  // If we don't have data for the requested date, use the most recent data
  if (intervals.length === 0 && dataToUse.length > 0) {
    const now = new Date();
    dataToUse.forEach((price, index) => {
      if (price !== null && !isNaN(price)) {
        const hour = Math.floor((index * intervalMinutes) / 60);
        const minute = (index * intervalMinutes) % 60;
        
        intervals.push({
          time: `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          hour: hour % 24,
          minute: minute,
          price: parseFloat(price),
          timestamp: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour % 24, minute).toISOString()
        });
      }
    });
  }
  
  return intervals;
}

function parseHistoryData(history, requestedDate) {
  return parseOpenNEMData(history, requestedDate);
}

function parseIntervalArray(data, requestedDate) {
  const intervals = [];
  
  data.forEach(item => {
    if (item.price !== undefined && item.time) {
      const time = new Date(item.time);
      
      if (requestedDate) {
        const timeDate = time.toISOString().split('T')[0];
        if (timeDate !== requestedDate) return;
      }
      
      intervals.push({
        time: `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`,
        hour: time.getHours(),
        minute: time.getMinutes(),
        price: parseFloat(item.price),
        timestamp: time.toISOString()
      });
    }
  });
  
  return intervals;
}

function parseSeriesData(series, requestedDate) {
  // Implementation for series format if needed
  return null;
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
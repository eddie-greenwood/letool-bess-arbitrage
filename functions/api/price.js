export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || 'VIC1';
  const date = searchParams.get('date');

  try {
    // Use the OpenNEM API endpoint that works
    const target = `https://api.opennem.org.au/stats/price/energy/NEM/${region}.json`;
    
    console.log('Fetching from OpenNEM:', target);

    const resp = await fetch(target, { 
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; LeTool/1.0)'
      }
    });
    
    if (!resp.ok) {
      throw new Error(`OpenNEM returned ${resp.status}`);
    }
    
    const data = await resp.json();
    
    // Parse OpenNEM format to our format
    if (data && data.data && Array.isArray(data.data)) {
      const priceData = data.data.find(d => 
        d.type === 'energy' || 
        d.type === 'price' || 
        d.id === 'price.spot' ||
        d.code === 'price.spot'
      );
      
      if (priceData && priceData.history && priceData.history.data) {
        // Convert to our interval format
        const intervals = [];
        const prices = priceData.history.data;
        const startTime = new Date(priceData.history.start);
        const intervalMinutes = priceData.history.interval === '5m' ? 5 : 30;
        
        // If a specific date is requested, filter for that date
        const requestedDate = date ? new Date(date) : null;
        
        prices.forEach((price, index) => {
          if (price !== null && !isNaN(price)) {
            const time = new Date(startTime.getTime() + index * intervalMinutes * 60000);
            
            // Filter by date if requested
            if (requestedDate) {
              const timeDate = new Date(time.getFullYear(), time.getMonth(), time.getDate());
              const reqDate = new Date(requestedDate.getFullYear(), requestedDate.getMonth(), requestedDate.getDate());
              if (timeDate.getTime() !== reqDate.getTime()) return;
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
        
        // Return live data
        return new Response(JSON.stringify({
          success: true,
          data: intervals,
          source: 'opennem',
          region: region,
          date: date,
          message: 'Live data from OpenNEM'
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
    
    throw new Error('Invalid data structure from OpenNEM');
    
  } catch (error) {
    console.error('OpenNEM fetch error:', error);
    
    // Only fallback to simulation if absolutely necessary
    // Try alternative endpoint
    try {
      const altTarget = `https://data.opennem.org.au/v3/stats/au/NEM/${region}/energy/5m.json`;
      const altResp = await fetch(altTarget);
      
      if (altResp.ok) {
        const altData = await altResp.json();
        
        // Process alternative format
        if (altData && altData.data) {
          const intervals = [];
          // Process the alternative data format
          // ... parsing logic for alternative format ...
          
          if (intervals.length > 0) {
            return new Response(JSON.stringify({
              success: true,
              data: intervals,
              source: 'opennem-alt',
              region: region,
              date: date
            }), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
        }
      }
    } catch (altError) {
      console.error('Alternative endpoint also failed:', altError);
    }
    
    // Last resort - return error to force client to handle it
    return new Response(JSON.stringify({
      success: false,
      error: 'Unable to fetch live data from OpenNEM',
      message: error.message
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
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
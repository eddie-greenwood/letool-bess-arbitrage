export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const region = (url.searchParams.get('region') || 'VIC1').toUpperCase();
  const requestedDate = url.searchParams.get('date'); // optional YYYY-MM-DD
  
  // Use nem-harvester as primary data source
  const harvesterUrl = new URL('https://nem-harvester.eddie-37d.workers.dev/api/price');
  harvesterUrl.searchParams.set('region', region);
  
  // For single date or today
  const targetDate = requestedDate || new Date().toISOString().split('T')[0];
  harvesterUrl.searchParams.set('date', targetDate);
  
  // Add live=true for today's date to prefer OpenNEM when available
  const today = new Date().toISOString().split('T')[0];
  if (targetDate === today) {
    harvesterUrl.searchParams.set('live', 'true');
  }
  
  console.log(`Fetching from nem-harvester: ${harvesterUrl.toString()}`);
  
  try {
    // Fetch from nem-harvester
    const response = await fetch(harvesterUrl.toString(), {
      headers: {
        'User-Agent': 'LeTool/1.0'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.success && data.data && data.data.length > 0) {
        console.log(`Retrieved ${data.data.length} intervals from nem-harvester (source: ${data.source})`);
        
        // Pass through the harvester response with LeTool formatting
        return new Response(JSON.stringify({
          success: true,
          data: data.data,
          source: data.source || 'nem-harvester',
          region: region,
          date: requestedDate || 'today',
          message: data.message || 'Data from NEM Harvester',
          dataPoints: data.data.length
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
    
    // If harvester fails or returns no data, throw to trigger fallback
    throw new Error(`Harvester returned no data: ${response.status}`);
    
  } catch (error) {
    console.error('NEM Harvester fetch failed:', error);
    
    // NO SIMULATION - Return error if harvester unavailable
    return new Response(JSON.stringify({
      success: false,
      data: [],
      source: 'error',
      region: region,
      date: requestedDate || 'today',
      message: 'No data available - harvester temporarily unavailable',
      error: error.message
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
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

// NO SIMULATION - Removed all fake data generation
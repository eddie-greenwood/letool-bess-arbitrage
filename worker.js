/**
 * Cloudflare Worker for Lé Tool - OpenNEM API Proxy
 * This worker handles CORS and proxies requests to OpenNEM API
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    
    // Handle different API endpoints
    if (url.pathname === '/api/price') {
      return await handlePriceRequest(url);
    } else if (url.pathname === '/api/test') {
      return await handleTestRequest();
    } else if (url.pathname === '/') {
      return new Response('Lé Tool API Proxy - Greenwood Energy', {
        headers: { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response('Not Found', { 
      status: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
  },
};

async function handlePriceRequest(url) {
  try {
    const region = url.searchParams.get('region') || 'VIC1';
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    // Construct OpenNEM API URL - using the correct endpoint format
    // OpenNEM uses /stats/price/energy for actual price data
    const openNEMUrl = `https://api.opennem.org.au/stats/price/energy/NEM/${region}.json?` + 
                       `period=5m&start=${date}&end=${date}`;
    
    console.log('Fetching from OpenNEM:', openNEMUrl);
    
    // Fetch from OpenNEM with proper headers and redirect handling
    const response = await fetch(openNEMUrl, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; LeTool/1.0)',
      },
      redirect: 'manual', // Don't follow redirects automatically
    });

    // Log response details for debugging
    const contentType = response.headers.get('content-type');
    console.log('Response status:', response.status);
    console.log('Response content-type:', contentType);

    // Check if response is HTML (error page)
    if (contentType && contentType.includes('text/html')) {
      console.error('Received HTML instead of JSON - likely an error page');
      throw new Error('OpenNEM returned HTML instead of JSON');
    }

    if (!response.ok) {
      throw new Error(`OpenNEM API returned ${response.status}`);
    }

    // Get response text first to check what we received
    const responseText = await response.text();
    console.log('Response preview:', responseText.substring(0, 200));

    // Try to parse as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse response as JSON:', parseError);
      console.error('Response was:', responseText.substring(0, 500));
      throw new Error('Invalid JSON response from OpenNEM');
    }
    
    // Return with CORS headers
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('Error fetching price data:', error);
    
    // Try alternative endpoint format
    try {
      const region = url.searchParams.get('region') || 'VIC1';
      const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
      
      // Try simpler endpoint
      const altUrl = `https://api.opennem.org.au/stats/au/NEM/${region}/energy/market_value.json`;
      console.log('Trying alternative URL:', altUrl);
      
      const altResponse = await fetch(altUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (altResponse.ok) {
        const contentType = altResponse.headers.get('content-type');
        if (contentType && !contentType.includes('html')) {
          const altData = await altResponse.json();
          return new Response(JSON.stringify(altData), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }
    } catch (altError) {
      console.error('Alternative endpoint also failed:', altError);
    }
    
    // Return error with CORS headers
    return new Response(
      JSON.stringify({ 
        error: error.message,
        fallback: true,
        message: 'Using simulated data - OpenNEM API format may have changed',
        debug: {
          attempted_url: `https://api.opennem.org.au/stats/price/energy/NEM/${url.searchParams.get('region')}.json`,
          error_detail: error.toString()
        }
      }),
      {
        status: 200, // Return 200 so frontend can handle gracefully
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

async function handleTestRequest() {
  const results = {
    worker_status: 'online',
    timestamp: new Date().toISOString(),
    tests: []
  };

  // Test 1: Basic connectivity
  try {
    const testUrl = 'https://api.opennem.org.au/';
    const response = await fetch(testUrl);
    results.tests.push({
      name: 'OpenNEM Root',
      url: testUrl,
      status: response.status,
      ok: response.ok,
      content_type: response.headers.get('content-type')
    });
  } catch (error) {
    results.tests.push({
      name: 'OpenNEM Root',
      error: error.message
    });
  }

  // Test 2: Try to get regions
  try {
    const testUrl = 'https://api.opennem.org.au/stats/au/NEM/regions.json';
    const response = await fetch(testUrl);
    const contentType = response.headers.get('content-type');
    
    results.tests.push({
      name: 'Regions Endpoint',
      url: testUrl,
      status: response.status,
      ok: response.ok,
      content_type: contentType,
      is_json: contentType && contentType.includes('json')
    });

    if (response.ok && contentType && contentType.includes('json')) {
      const data = await response.json();
      results.tests.push({
        name: 'Regions Data',
        has_data: !!data,
        sample: Object.keys(data).slice(0, 3)
      });
    }
  } catch (error) {
    results.tests.push({
      name: 'Regions Endpoint',
      error: error.message
    });
  }

  // Test 3: Try price endpoint with different formats
  const priceEndpoints = [
    'https://api.opennem.org.au/stats/au/NEM/VIC1/energy/market_value.json',
    'https://api.opennem.org.au/stats/price/energy/NEM/VIC1.json',
    'https://api.opennem.org.au/stats/au/NEM/VIC1/power/market_value.json'
  ];

  for (const endpoint of priceEndpoints) {
    try {
      const response = await fetch(endpoint);
      const contentType = response.headers.get('content-type');
      
      results.tests.push({
        name: 'Price Endpoint Test',
        url: endpoint,
        status: response.status,
        ok: response.ok,
        content_type: contentType,
        is_json: contentType && contentType.includes('json')
      });

      if (response.ok && contentType && contentType.includes('json')) {
        results.opennem_reachable = true;
        break;
      }
    } catch (error) {
      results.tests.push({
        name: 'Price Endpoint Test',
        url: endpoint,
        error: error.message
      });
    }
  }

  return new Response(
    JSON.stringify(results),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
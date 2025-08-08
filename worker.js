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
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handlePriceRequest(url) {
  try {
    const region = url.searchParams.get('region') || 'VIC1';
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    // Construct OpenNEM API URL
    const openNEMUrl = `https://api.opennem.org.au/stats/price/NEM/${region}?date=${date}`;
    
    console.log('Fetching from OpenNEM:', openNEMUrl);
    
    // Fetch from OpenNEM
    const response = await fetch(openNEMUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'LeTool/1.0 (Greenwood Energy BESS Dashboard)',
      },
    });

    if (!response.ok) {
      throw new Error(`OpenNEM API returned ${response.status}`);
    }

    const data = await response.json();
    
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
    
    // Return error with CORS headers
    return new Response(
      JSON.stringify({ 
        error: error.message,
        fallback: true,
        message: 'Using simulated data due to API error'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

async function handleTestRequest() {
  try {
    const testUrl = 'https://api.opennem.org.au/networks';
    const response = await fetch(testUrl);
    
    const status = response.ok ? 'success' : 'failed';
    const data = response.ok ? await response.json() : null;
    
    return new Response(
      JSON.stringify({
        status,
        opennem_reachable: response.ok,
        status_code: response.status,
        data: data ? 'Data received' : 'No data',
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
/**
 * Cloudflare Worker for Lé Tool - Fixed OpenNEM Proxy
 * Properly handles OpenNEM API v3 endpoints
 */

export default {
  async fetch(request) {
    // Add CORS headers to all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    
    // Handle price data requests
    if (url.pathname === '/api/price') {
      const region = url.searchParams.get('region') || 'VIC1';
      const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
      
      // OpenNEM v3 API endpoint for price data
      // Format: /stats/au/NEM/{region}/power
      const opennemUrl = `https://api.opennem.org.au/stats/au/NEM/${region}/power`;
      
      console.log('Fetching from:', opennemUrl);
      
      try {
        const response = await fetch(opennemUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'LeTool/1.0',
          },
        });
        
        const contentType = response.headers.get('content-type');
        console.log('Response content-type:', contentType);
        
        if (!response.ok) {
          throw new Error(`OpenNEM returned ${response.status}`);
        }
        
        const data = await response.json();
        
        // Return the data with CORS headers
        return new Response(JSON.stringify(data), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
          },
        });
        
      } catch (error) {
        console.error('Error fetching from OpenNEM:', error);
        
        // Try alternative endpoint - energy instead of power
        try {
          const altUrl = `https://api.opennem.org.au/stats/au/NEM/${region}/energy`;
          console.log('Trying alternative:', altUrl);
          
          const altResponse = await fetch(altUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'LeTool/1.0',
            },
          });
          
          if (altResponse.ok) {
            const altData = await altResponse.json();
            return new Response(JSON.stringify(altData), {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
              },
            });
          }
        } catch (altError) {
          console.error('Alternative also failed:', altError);
        }
        
        // Return fallback response
        return new Response(
          JSON.stringify({
            error: 'OpenNEM API unavailable',
            message: 'The OpenNEM API is currently not returning data. Using simulation.',
            fallback: true,
            debug: {
              attempted_url: opennemUrl,
              error: error.message,
            }
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }
    }
    
    // Handle test endpoint
    if (url.pathname === '/api/test') {
      const results = {
        worker_status: 'online',
        timestamp: new Date().toISOString(),
        tests: []
      };
      
      // Test OpenNEM endpoints
      const endpoints = [
        'https://api.opennem.org.au/stats/au/NEM/VIC1/power',
        'https://api.opennem.org.au/stats/au/NEM/VIC1/energy',
      ];
      
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            headers: {
              'Accept': 'application/json',
            },
          });
          
          results.tests.push({
            url: endpoint,
            status: response.status,
            ok: response.ok,
            contentType: response.headers.get('content-type'),
          });
          
          if (response.ok) {
            try {
              const data = await response.json();
              results.tests.push({
                url: endpoint + ' (data)',
                hasData: !!data,
                keys: data ? Object.keys(data).slice(0, 5) : [],
              });
            } catch (e) {
              results.tests.push({
                url: endpoint + ' (parse)',
                error: 'Failed to parse JSON',
              });
            }
          }
        } catch (error) {
          results.tests.push({
            url: endpoint,
            error: error.message,
          });
        }
      }
      
      return new Response(JSON.stringify(results), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
    
    // Default response
    return new Response('Lé Tool API Proxy - Greenwood Energy', {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain',
      },
    });
  },
};
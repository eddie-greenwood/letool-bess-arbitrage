/**
 * Cloudflare Worker for Lé Tool - Simplified OpenNEM Proxy
 * Handles CORS for OpenNEM API access
 */

export default {
  async fetch(request) {
    // Add CORS headers to all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    
    // Simple proxy - just forward the path to OpenNEM
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.replace('/api/', '');
      const query = url.search;
      
      // Build OpenNEM URL - use HTTPS directly
      const opennemUrl = `https://api.opennem.org.au/${path}${query}`;
      
      try {
        // Make the request to OpenNEM
        const response = await fetch(opennemUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });
        
        // Get the response body
        const data = await response.text();
        
        // Return with CORS headers
        return new Response(data, {
          status: response.status,
          headers: {
            ...corsHeaders,
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
          },
        });
      } catch (error) {
        // Return error as JSON
        return new Response(
          JSON.stringify({
            error: 'Failed to fetch from OpenNEM',
            message: error.message,
            fallback: true,
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        );
      }
    }
    
    // Default response
    return new Response('Lé Tool API Proxy', {
      headers: corsHeaders,
    });
  },
};
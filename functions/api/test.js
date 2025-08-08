export async function onRequestGet({ request }) {
  return new Response(JSON.stringify({
    success: true,
    message: 'Pages Functions API is working',
    timestamp: new Date().toISOString(),
    type: 'Cloudflare Pages Function'
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
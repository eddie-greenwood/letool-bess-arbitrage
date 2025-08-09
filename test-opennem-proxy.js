/**
 * Local proxy server to test OpenNEM API
 * This proves the API works from server-side
 */

const http = require('http');
const https = require('https');

// Create a simple proxy server
const server = http.createServer(async (req, res) => {
    // Enable CORS for browser
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Parse the region from URL
    const match = req.url.match(/\/api\/price\/(\w+)/);
    if (!match) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Invalid endpoint' }));
        return;
    }
    
    const region = match[1];
    console.log(`Fetching ${region} from OpenNEM...`);
    
    // Fetch from OpenNEM
    const opennemUrl = `https://api.opennem.org.au/stats/price/NEM/${region}?period=5m&last=1h`;
    
    https.get(opennemUrl, (opennemRes) => {
        let data = '';
        
        opennemRes.on('data', chunk => {
            data += chunk;
        });
        
        opennemRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                
                // Extract the important bits
                if (parsed.data && parsed.data[0]) {
                    const series = parsed.data[0];
                    const prices = series.history.data;
                    const latest = prices[prices.length - 1];
                    
                    const response = {
                        success: true,
                        region: region,
                        latest_price: latest,
                        prices: prices.slice(-10), // Last 10 prices
                        timestamp: series.history.last,
                        data_points: prices.length
                    };
                    
                    console.log(`✓ ${region}: $${latest}/MWh`);
                    res.writeHead(200);
                    res.end(JSON.stringify(response));
                } else {
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: false, error: 'No data' }));
                }
            } catch (error) {
                console.error(`Error parsing response:`, error);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    }).on('error', (error) => {
        console.error(`Error fetching from OpenNEM:`, error);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
    });
});

const PORT = 3333;
server.listen(PORT, () => {
    console.log(`\n🚀 OpenNEM Proxy Server Running\n`);
    console.log(`   Local URL: http://localhost:${PORT}/api/price/VIC1`);
    console.log(`   Regions: NSW1, QLD1, SA1, TAS1, VIC1\n`);
    console.log(`This proxy adds CORS headers so browser can access OpenNEM data.\n`);
    console.log(`Press Ctrl+C to stop\n`);
});
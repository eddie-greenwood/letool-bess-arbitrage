/**
 * Test OpenNEM API for all NEM regions
 * This verifies we can get price data reliably
 */

const https = require('https');

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ 
                json: () => Promise.resolve(JSON.parse(data)),
                ok: res.statusCode === 200,
                status: res.statusCode
            }));
        }).on('error', reject);
    });
}

async function testRegion(region) {
    const url = `https://api.opennem.org.au/stats/price/NEM/${region}?period=5m&last=1h`;
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && data.data && data.data[0]) {
            const series = data.data[0];
            const prices = series.history.data;
            
            // Get latest price
            const latestPrice = prices[prices.length - 1];
            const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            
            return {
                success: true,
                region,
                latestPrice,
                avgPrice,
                minPrice,
                maxPrice,
                dataPoints: prices.length
            };
        }
        
        return {
            success: false,
            region,
            error: 'No data in response'
        };
        
    } catch (error) {
        return {
            success: false,
            region,
            error: error.message
        };
    }
}

async function testAllRegions() {
    console.log('🔍 Testing OpenNEM API for all NEM regions\n');
    console.log('═══════════════════════════════════════════\n');
    
    const regions = ['NSW1', 'QLD1', 'SA1', 'TAS1', 'VIC1'];
    const results = [];
    
    for (const region of regions) {
        console.log(`Testing ${region}...`);
        const result = await testRegion(region);
        results.push(result);
        
        if (result.success) {
            console.log(`✅ ${region}:`);
            console.log(`   Latest: $${result.latestPrice.toFixed(2)}/MWh`);
            console.log(`   Average: $${result.avgPrice.toFixed(2)}/MWh`);
            console.log(`   Range: $${result.minPrice.toFixed(2)} - $${result.maxPrice.toFixed(2)}/MWh`);
            console.log(`   Data points: ${result.dataPoints}\n`);
        } else {
            console.log(`❌ ${region}: ${result.error}\n`);
        }
    }
    
    // Test fetching a specific day
    console.log('Testing historical data fetch...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    
    const histUrl = `https://api.opennem.org.au/stats/price/NEM/VIC1?period=5m&start=${dateStr}&end=${dateStr}`;
    
    try {
        const response = await fetch(histUrl);
        const data = await response.json();
        
        if (data && data.data && data.data[0]) {
            const points = data.data[0].history.data.length;
            console.log(`✅ Historical data: ${points} intervals for ${dateStr}\n`);
        }
    } catch (error) {
        console.log(`❌ Historical fetch failed: ${error.message}\n`);
    }
    
    // Summary
    console.log('═══════════════════════════════════════════\n');
    console.log('Summary:');
    const successful = results.filter(r => r.success).length;
    console.log(`✅ ${successful}/${regions.length} regions working`);
    
    if (successful === regions.length) {
        console.log('\n🎉 All regions working! OpenNEM is a reliable data source.');
        console.log('\nNext steps:');
        console.log('1. Deploy the harvester with OpenNEM integration');
        console.log('2. It will pull live prices every 2 minutes');
        console.log('3. Historical backfill will use OpenNEM API');
    } else {
        console.log('\n⚠️ Some regions failed. Check the errors above.');
    }
    
    // Show current time for reference
    const now = new Date();
    console.log(`\nCurrent time: ${now.toISOString()}`);
    console.log(`AEST: ${new Date(now.getTime() + 10 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)} AEST`);
}

testAllRegions().catch(console.error);
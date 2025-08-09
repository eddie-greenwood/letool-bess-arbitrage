/**
 * Test AEMO ZIP file handling
 * The current format uses PUBLIC_DISPATCHIS ZIP files
 */

const https = require('https');
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

// Fetch helper
function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ 
                buffer: () => Promise.resolve(Buffer.concat(chunks)),
                text: () => Promise.resolve(Buffer.concat(chunks).toString()),
                ok: res.statusCode === 200,
                status: res.statusCode
            }));
        }).on('error', reject);
    });
}

// Simple ZIP extraction (finds and extracts first CSV)
async function extractCSVFromZip(buffer) {
    // This is a simplified approach - in production use a proper ZIP library
    // For now, let's just detect if it's a ZIP file
    const signature = buffer.slice(0, 4).toString('hex');
    if (signature !== '504b0304') {
        throw new Error('Not a valid ZIP file');
    }
    
    // For testing, we'll note that we need a ZIP library
    console.log('✓ Valid ZIP file detected');
    console.log('  Note: Full ZIP extraction requires a library like node-stream-zip or unzipper');
    return null;
}

async function testDispatchZip() {
    const BASE_CURRENT = "https://www.nemweb.com.au/Reports/Current/DispatchIS_Reports/";
    
    console.log('=== Testing AEMO PUBLIC_DISPATCHIS ZIP Files ===\n');
    
    try {
        // Step 1: Get directory listing
        console.log(`Fetching: ${BASE_CURRENT}`);
        const response = await fetch(BASE_CURRENT);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const html = await response.text();
        console.log(`✓ Directory fetched (${html.length} bytes)\n`);
        
        // Step 2: Find PUBLIC_DISPATCHIS files
        const zipFiles = Array.from(
            html.matchAll(/href="(PUBLIC_DISPATCHIS_\d+_\d+\.zip)"/gi)
        ).map(m => m[1]);
        
        console.log(`Found ${zipFiles.length} PUBLIC_DISPATCHIS ZIP files\n`);
        
        if (zipFiles.length > 0) {
            // Show sample files
            console.log('Latest files:');
            zipFiles.slice(-5).forEach(f => console.log(`  - ${f}`));
            console.log();
            
            // Parse the filename to extract timestamp
            const latest = zipFiles[zipFiles.length - 1];
            const match = latest.match(/PUBLIC_DISPATCHIS_(\d{8})(\d{4})/);
            if (match) {
                const date = match[1];
                const time = match[2];
                console.log(`Latest dispatch:`);
                console.log(`  Date: ${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`);
                console.log(`  Time: ${time.slice(0,2)}:${time.slice(2,4)}`);
            }
            
            // Try to download the latest file
            const fileUrl = BASE_CURRENT + latest;
            console.log(`\nDownloading: ${fileUrl}`);
            
            const zipResponse = await fetch(fileUrl);
            if (!zipResponse.ok) {
                throw new Error(`Failed to download ZIP: HTTP ${zipResponse.status}`);
            }
            
            const buffer = await zipResponse.buffer();
            console.log(`✓ Downloaded ${buffer.length} bytes`);
            
            // Check if it's a valid ZIP
            await extractCSVFromZip(buffer);
            
            console.log('\n✅ AEMO is providing data in ZIP format');
            console.log('   The harvester needs to be updated to handle ZIP extraction');
            
            return true;
        } else {
            console.log('❌ No PUBLIC_DISPATCHIS files found');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return false;
    }
}

// Alternative: Try the public prices endpoint
async function testPublicPrices() {
    console.log('\n=== Testing Alternative: Public Prices ===\n');
    
    const PRICE_URL = "https://www.nemweb.com.au/Reports/Current/Public_Prices/";
    
    try {
        console.log(`Fetching: ${PRICE_URL}`);
        const response = await fetch(PRICE_URL);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const html = await response.text();
        
        // Look for price files
        const priceFiles = Array.from(
            html.matchAll(/href="(PUBLIC_PRICES_\d+\.zip)"/gi)
        ).map(m => m[1]);
        
        console.log(`Found ${priceFiles.length} PUBLIC_PRICES files`);
        
        if (priceFiles.length > 0) {
            console.log('\nLatest price files:');
            priceFiles.slice(-3).forEach(f => console.log(`  - ${f}`));
            
            console.log('\n✅ Public price data is available');
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return false;
    }
}

// Test OpenNEM API as alternative
async function testOpenNEM() {
    console.log('\n=== Testing Alternative: OpenNEM API ===\n');
    
    const url = 'https://api.opennem.org.au/stats/price/NEM/VIC1?period=5m&last=1d';
    
    try {
        console.log(`Testing: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const text = await response.text();
        const data = JSON.parse(text);
        
        if (data && data.data && data.data.length > 0) {
            const series = data.data[0];
            console.log(`✓ Region: ${series.region}`);
            console.log(`✓ Data points: ${series.history?.data?.length || 0}`);
            
            if (series.history?.data?.length > 0) {
                const latest = series.history.data[series.history.data.length - 1];
                console.log(`✓ Latest price: $${latest}/MWh`);
            }
            
            console.log('\n✅ OpenNEM API is working and could be used as alternative');
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('❌ OpenNEM test failed:', error.message);
        return false;
    }
}

// Run all tests
async function runTests() {
    console.log('🔍 AEMO Data Source Testing\n');
    
    const zipOk = await testDispatchZip();
    const pricesOk = await testPublicPrices();
    const opennemOk = await testOpenNEM();
    
    console.log('\n=== Summary ===');
    console.log(`AEMO ZIP files: ${zipOk ? '✅ Available (needs ZIP handling)' : '❌ Not found'}`);
    console.log(`Public Prices: ${pricesOk ? '✅ Available' : '❌ Not found'}`);
    console.log(`OpenNEM API: ${opennemOk ? '✅ Working (alternative source)' : '❌ Failed'}`);
    
    if (zipOk || opennemOk) {
        console.log('\n✅ Data sources are available!');
        console.log('\nRecommendations:');
        if (zipOk) {
            console.log('1. Update harvester to handle ZIP files using unzipper library');
        }
        if (opennemOk) {
            console.log('2. Consider OpenNEM as immediate alternative (simpler, no ZIP handling)');
        }
    }
}

runTests().catch(console.error);
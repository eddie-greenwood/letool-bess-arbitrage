/**
 * Local test script for AEMO data fetching
 * Run with: node test-local.js
 */

const https = require('https');

// Test configuration
const BASE_CURRENT = "https://www.nemweb.com.au/Reports/Current/DispatchIS_Reports/";
const REGIONS = ['NSW1', 'QLD1', 'SA1', 'TAS1', 'VIC1'];

// Fetch helper
function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ 
                text: () => Promise.resolve(data),
                ok: res.statusCode === 200,
                status: res.statusCode
            }));
        }).on('error', reject);
    });
}

// Parse DISPATCHREGIONSUM CSV
function parseDispatchRegionSum(csv) {
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const rows = [];
    
    // Find header line
    let headerLine;
    let headerIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('SETTLEMENTDATE') && line.includes('REGIONID') && line.includes('RRP')) {
            headerLine = line;
            headerIndex = i;
            break;
        }
    }
    
    if (!headerLine) {
        console.log('No header found, using fixed positions');
        // Use fixed positions
        for (const line of lines) {
            if (line.startsWith('D,') && line.includes('DISPATCH')) {
                const cols = line.split(',');
                if (cols.length > 11) {
                    const settlementDate = cols[4]?.trim();
                    const region = cols[6]?.trim();
                    const rrp = parseFloat(cols[11]);
                    
                    if (settlementDate && region && !isNaN(rrp)) {
                        rows.push({
                            timestamp: settlementDate,
                            region,
                            price: rrp
                        });
                    }
                }
            }
        }
        return rows;
    }
    
    // Parse with dynamic columns
    const headers = headerLine.replace(/^[DIC],/, '').split(',').map(h => h.trim());
    const dateIdx = headers.findIndex(h => /SETTLEMENTDATE/i.test(h));
    const regionIdx = headers.findIndex(h => /REGIONID/i.test(h));
    const rrpIdx = headers.findIndex(h => /^RRP$/i.test(h));
    
    console.log(`Header indices - Date: ${dateIdx}, Region: ${regionIdx}, RRP: ${rrpIdx}`);
    
    // Parse data rows
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^[IC],/.test(line)) continue;
        
        const cols = line.replace(/^D,/, '').split(',');
        
        if (cols.length > Math.max(dateIdx, regionIdx, rrpIdx)) {
            const settlementDate = cols[dateIdx]?.trim();
            const region = cols[regionIdx]?.trim().toUpperCase();
            const rrp = parseFloat(cols[rrpIdx]);
            
            if (settlementDate && region && !isNaN(rrp)) {
                rows.push({
                    timestamp: settlementDate,
                    region,
                    price: rrp
                });
            }
        }
    }
    
    return rows;
}

async function testCurrentDirectory() {
    console.log('=== Testing AEMO Current Directory ===\n');
    
    try {
        // Step 1: Fetch directory listing
        console.log(`Fetching: ${BASE_CURRENT}`);
        const response = await fetch(BASE_CURRENT);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} from AEMO`);
        }
        
        const html = await response.text();
        console.log(`✓ Directory listing fetched (${html.length} bytes)\n`);
        
        // Step 2: Find dispatch files (they're now in ZIP format)
        let fileMatches = Array.from(
            html.matchAll(/href="(PUBLIC_DISPATCHIS_\d{12,}_\d+\.zip)"/gi)
        );
        
        console.log(`Found ${fileMatches.length} PUBLIC_DISPATCHIS ZIP files`);
        
        if (fileMatches.length === 0) {
            // Try to find individual CSV files (older format)
            fileMatches = Array.from(
                html.matchAll(/href="(DISPATCHREGIONSUM_\d{12,14}\.CSV)"/gi)
            );
            console.log(`Found ${fileMatches.length} DISPATCHREGIONSUM CSV files`);
        }
        
        if (fileMatches.length === 0) {
            console.log('\nDirectory HTML sample:');
            console.log(html.substring(0, 1000));
            throw new Error('No DISPATCHREGIONSUM files found');
        }
        
        // Get the latest file
        const files = fileMatches.map(m => m[1]).sort();
        const latestFile = files[files.length - 1];
        console.log(`Latest file: ${latestFile}\n`);
        
        // Step 3: Download and parse the latest file
        const fileUrl = BASE_CURRENT + latestFile;
        console.log(`Downloading: ${fileUrl}`);
        
        const csvResponse = await fetch(fileUrl);
        if (!csvResponse.ok) {
            throw new Error(`HTTP ${csvResponse.status} downloading CSV`);
        }
        
        const csvText = await csvResponse.text();
        console.log(`✓ CSV downloaded (${csvText.length} bytes)\n`);
        
        // Step 4: Parse the CSV
        console.log('Parsing CSV...');
        const rows = parseDispatchRegionSum(csvText);
        console.log(`✓ Parsed ${rows.length} rows\n`);
        
        // Step 5: Show sample data
        console.log('=== Sample Data by Region ===\n');
        
        for (const region of REGIONS) {
            const regionRows = rows.filter(r => r.region === region);
            if (regionRows.length > 0) {
                const latest = regionRows[regionRows.length - 1];
                console.log(`${region}:`);
                console.log(`  Timestamp: ${latest.timestamp}`);
                console.log(`  Price: $${latest.price.toFixed(2)}/MWh`);
                console.log(`  Data points: ${regionRows.length}\n`);
            } else {
                console.log(`${region}: No data found\n`);
            }
        }
        
        // Step 6: Test data quality
        console.log('=== Data Quality Checks ===\n');
        
        const uniqueTimestamps = new Set(rows.map(r => r.timestamp));
        console.log(`✓ Unique timestamps: ${uniqueTimestamps.size}`);
        
        const prices = rows.map(r => r.price).filter(p => !isNaN(p));
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        
        console.log(`✓ Price range: $${minPrice.toFixed(2)} to $${maxPrice.toFixed(2)}/MWh`);
        console.log(`✓ Average price: $${avgPrice.toFixed(2)}/MWh`);
        
        // Check for recent data
        const timestamps = Array.from(uniqueTimestamps).sort();
        const latestTimestamp = timestamps[timestamps.length - 1];
        const now = new Date();
        const latestDate = new Date(latestTimestamp.replace(/\//g, '-') + '+10:00');
        const ageMinutes = (now - latestDate) / (1000 * 60);
        
        console.log(`✓ Latest data: ${latestTimestamp}`);
        console.log(`✓ Data age: ${ageMinutes.toFixed(0)} minutes\n`);
        
        if (ageMinutes > 15) {
            console.log('⚠️  Warning: Data is more than 15 minutes old');
        }
        
        console.log('=== Test Complete ===');
        console.log('✅ AEMO data fetching is working correctly!\n');
        
        return true;
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('\nTroubleshooting:');
        console.error('1. Check if AEMO website is accessible');
        console.error('2. Check internet connection');
        console.error('3. Try accessing URL in browser:', BASE_CURRENT);
        return false;
    }
}

async function testArchiveDirectory() {
    console.log('\n=== Testing AEMO Archive Directory ===\n');
    
    const BASE_ARCHIVE = "https://www.nemweb.com.au/Reports/Archive/DispatchIS_Reports/";
    const year = "2025";
    const month = "Aug";
    
    try {
        const archiveUrl = `${BASE_ARCHIVE}${year}/${month}/`;
        console.log(`Testing archive: ${archiveUrl}`);
        
        const response = await fetch(archiveUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} from archive`);
        }
        
        const html = await response.text();
        const files = Array.from(
            html.matchAll(/(DISPATCHREGIONSUM_\d{12,14}\.CSV)/gi)
        ).map(m => m[1]);
        
        console.log(`✓ Found ${files.length} files in ${month} ${year} archive`);
        
        if (files.length > 0) {
            console.log(`  First file: ${files[0]}`);
            console.log(`  Last file: ${files[files.length - 1]}`);
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ Archive test failed:', error.message);
        return false;
    }
}

// Run tests
async function runAllTests() {
    console.log('🔍 AEMO Data Fetching Test Suite\n');
    console.log('Testing connection to AEMO NEMWeb...\n');
    
    const currentOk = await testCurrentDirectory();
    const archiveOk = await testArchiveDirectory();
    
    console.log('\n=== Summary ===');
    console.log(`Current directory: ${currentOk ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Archive directory: ${archiveOk ? '✅ PASS' : '❌ FAIL'}`);
    
    if (currentOk && archiveOk) {
        console.log('\n🎉 All tests passed! Ready to deploy harvester.');
    } else {
        console.log('\n⚠️  Some tests failed. Check the errors above.');
    }
}

// Run the tests
runAllTests().catch(console.error);
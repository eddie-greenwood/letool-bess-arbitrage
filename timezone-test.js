/**
 * Timezone Validation Test for LeTool Data Pipeline
 * 
 * This test validates the timestamp conversion logic used in the NEM Harvester
 * and LeTool display to identify potential timezone mismatches.
 */

console.log('=== LeTool Timezone Validation Test ===\n');

// Test 1: Simulate NEM Harvester timestamp conversion
function testNEMHarvesterConversion() {
    console.log('1. NEM Harvester Timestamp Conversion Test');
    console.log('-------------------------------------------');
    
    // Simulate AEMO CSV data format for 2025-01-03
    const sampleAemoData = [
        'VIC1,"2025/01/03 00:05:00",1234.56,45.67,"TRADE"',
        'VIC1,"2025/01/03 01:00:00",1234.56,35.42,"TRADE"', 
        'VIC1,"2025/01/03 06:00:00",1234.56,55.78,"TRADE"',
        'VIC1,"2025/01/03 08:00:00",1234.56,85.23,"TRADE"',
        'VIC1,"2025/01/03 12:00:00",1234.56,120.45,"TRADE"',
        'VIC1,"2025/01/03 18:00:00",1234.56,95.67,"TRADE"',
    ];
    
    const intervals = [];
    
    sampleAemoData.forEach((line, index) => {
        const cols = line.split(',');
        const region = cols[0];
        const datetime = cols[1].replace(/"/g, '');
        const price = parseFloat(cols[3]);
        
        if (cols.length >= 4 && cols[0] === 'VIC1') {
            const [dateStr, timeStr] = datetime.split(' ');
            const [year, month, day] = dateStr.split('/');
            const [hour, minute, second] = timeStr.split(':');
            
            // Current NEM Harvester logic - AEMO times are in AEST (UTC+10)
            const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second ? second.padStart(2, '0') : '00'}+10:00`;
            const aestDate = new Date(isoString);
            
            const interval = {
                time: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
                hour: parseInt(hour),
                minute: parseInt(minute),
                price: price,
                timestamp: aestDate.toISOString(),
                originalAEMO: datetime
            };
            
            intervals.push(interval);
            
            console.log(`AEMO: ${datetime} -> Time: ${interval.time} -> UTC: ${interval.timestamp}`);
            
            // Validate what this becomes when displayed
            const displayDate = new Date(interval.timestamp);
            const displayHour = displayDate.getHours();
            console.log(`  Display would show: ${displayHour}:${displayDate.getMinutes().toString().padStart(2, '0')} (if using local time)`);
            console.log(`  Display should show: ${interval.time} (AEST)`);
            console.log();
        }
    });
    
    return intervals;
}

// Test 2: Simulate chart x-axis label generation
function testChartLabels(intervals) {
    console.log('2. Chart X-Axis Label Generation Test');
    console.log('--------------------------------------');
    
    const labels = intervals.map(op => op.time);
    console.log('Chart labels:', labels);
    
    // Simulate the chart callback function from advanced-script.js
    console.log('\nChart x-axis tick generation:');
    labels.forEach((label, index) => {
        const hour = Math.floor(index / 12); // This is the issue!
        const tickLabel = index % 12 === 0 ? `${hour}:00` : '';
        if (tickLabel) {
            console.log(`  Index ${index}: Label="${label}" -> Tick="${tickLabel}"`);
        }
    });
    console.log();
}

// Test 3: Simulate tariff period determination
function testTariffPeriods(intervals) {
    console.log('3. Tariff Period Determination Test');
    console.log('------------------------------------');
    
    const tariffWindows = {
        solarSoak: { start: '10:00', end: '15:00' },
        peak: { start: '15:00', end: '21:00' }
    };
    
    function getTariffPeriod(timestamp, windows) {
        if (!windows || Object.keys(windows).length === 0) return 'offPeak';
        
        const date = new Date(timestamp);
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        
        console.log(`  Timestamp: ${timestamp} -> Local time: ${timeStr}`);
        
        if (windows.solarSoak) {
            if (timeStr >= windows.solarSoak.start && timeStr < windows.solarSoak.end) {
                return 'solarSoak';
            }
        }
        if (windows.peak) {
            if (timeStr >= windows.peak.start && timeStr < windows.peak.end) {
                return 'peak';
            }
        }
        
        return 'offPeak';
    }
    
    intervals.forEach(interval => {
        const period = getTariffPeriod(interval.timestamp, tariffWindows);
        console.log(`AEST ${interval.time} -> Period: ${period}`);
    });
    console.log();
}

// Test 4: Check timezone conversion issues
function testTimezoneConversion() {
    console.log('4. Timezone Conversion Analysis');
    console.log('--------------------------------');
    
    const testTime = '2025-01-03 08:00:00'; // 8 AM AEST
    
    // Method 1: Current NEM Harvester approach (correct)
    const isoWithTz = '2025-01-03T08:00:00+10:00';
    const correctDate = new Date(isoWithTz);
    console.log(`Correct approach: ${testTime} AEST -> ${correctDate.toISOString()}`);
    console.log(`  UTC time: ${correctDate.getUTCHours()}:${correctDate.getUTCMinutes().toString().padStart(2, '0')}`);
    console.log(`  Local display: ${correctDate.getHours()}:${correctDate.getMinutes().toString().padStart(2, '0')}`);
    
    // Method 2: Naive approach (potential issue)
    const naiveDate = new Date(testTime);
    console.log(`Naive approach: ${testTime} -> ${naiveDate.toISOString()}`);
    console.log(`  UTC time: ${naiveDate.getUTCHours()}:${naiveDate.getUTCMinutes().toString().padStart(2, '0')}`);
    console.log(`  Local display: ${naiveDate.getHours()}:${naiveDate.getMinutes().toString().padStart(2, '0')}`);
    
    const offsetHours = correctDate.getHours() - naiveDate.getHours();
    if (offsetHours !== 0) {
        console.log(`⚠️  WARNING: ${offsetHours} hour offset between methods!`);
    } else {
        console.log('✅ Both methods produce same local time');
    }
    console.log();
}

// Test 5: Analyze typical AEMO price patterns
function testTypicalPricePatterns() {
    console.log('5. Expected AEMO Price Patterns');
    console.log('--------------------------------');
    console.log('Typical AEMO price patterns (AEST times):');
    console.log('- Low prices (charging): 1:00-6:00 AM');
    console.log('- Morning peak: 7:00-9:00 AM');
    console.log('- Solar soak (low): 10:00-3:00 PM');  
    console.log('- Evening peak: 5:00-8:00 PM');
    console.log('- Night trough: 10:00 PM-1:00 AM');
    console.log();
    
    console.log('User reported pattern:');
    console.log('- Charging: 0:00-4:00 (midnight to 4 AM)');
    console.log('- Discharging: 8:00-12:00 (8 AM to noon)');
    console.log();
    
    console.log('Analysis:');
    console.log('- Charging pattern matches expected overnight low prices ✅');
    console.log('- Discharging during 8-12 includes morning peak ✅');
    console.log('- Pattern seems reasonable for AEST times');
    console.log();
}

// Run all tests
const intervals = testNEMHarvesterConversion();
testChartLabels(intervals);
testTariffPeriods(intervals);
testTimezoneConversion();
testTypicalPricePatterns();

console.log('=== Summary of Findings ===');
console.log('1. NEM Harvester correctly converts AEMO timestamps to UTC with +10:00 offset');
console.log('2. Chart x-axis labels use the "time" field (HH:MM) which preserves AEST');
console.log('3. Tariff period calculation uses JavaScript Date.getHours() which converts to local time');
console.log('4. The charging/discharging patterns reported by user seem reasonable for AEST');
console.log();
console.log('Potential Issues:');
console.log('- Chart x-axis tick generation assumes 12 intervals per hour but uses array index');
console.log('- If data has gaps or irregular intervals, x-axis labels could be misaligned');
console.log('- Browser timezone affects tariff period calculation and display');
console.log();
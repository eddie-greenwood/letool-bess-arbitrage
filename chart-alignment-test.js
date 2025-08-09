/**
 * Chart X-Axis Alignment Test
 * 
 * Tests whether the x-axis labels align properly with the actual data points
 * This is where the "shifted" appearance might come from.
 */

console.log('=== CHART X-AXIS ALIGNMENT TEST ===\n');

// Simulate a full day of 5-minute interval data (288 intervals)
function generateFullDayData() {
    const intervals = [];
    
    // Generate 288 intervals (24 hours * 12 intervals per hour)
    for (let hour = 0; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute += 5) {
            intervals.push({
                time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
                hour: hour,
                minute: minute,
                price: 50 + Math.random() * 100 // Random price
            });
        }
    }
    
    return intervals;
}

// Test the current x-axis tick generation logic
function testXAxisTicks(intervals) {
    console.log('1. Current X-Axis Tick Generation (from advanced-script.js)');
    console.log('--------------------------------------------------------');
    
    const labels = intervals.map(op => op.time);
    
    // Current logic from advanced-script.js:
    // callback: function(val, index) {
    //     const hour = Math.floor(index / 12);
    //     return index % 12 === 0 ? `${hour}:00` : '';
    // }
    
    console.log('Sample tick generation:');
    console.log('Index | Data Time | Tick Label | Correct?');
    console.log('------|-----------|------------|----------');
    
    for (let i = 0; i < Math.min(36, intervals.length); i++) {
        const dataTime = labels[i];
        const hour = Math.floor(i / 12);
        const tickLabel = i % 12 === 0 ? `${hour}:00` : '';
        const isCorrect = tickLabel === '' || tickLabel === `${intervals[i].hour}:00`;
        
        if (i % 6 === 0) { // Show every 6th entry for clarity
            console.log(`${String(i).padStart(5)} | ${dataTime.padStart(9)} | ${tickLabel.padStart(10)} | ${isCorrect ? '✅' : '❌'}`);
        }
    }
    
    console.log('\nIssue Analysis:');
    console.log('- The tick generation assumes data starts at 00:00 and has no gaps');
    console.log('- If data starts at 00:05 or has gaps, ticks will be misaligned');
    console.log('- Index 0 shows "0:00" but data might actually be "00:05"');
    console.log();
}

// Test with realistic AEMO data that might have gaps
function testWithGaps() {
    console.log('2. Test With Missing Data (Common in Real AEMO Data)');
    console.log('---------------------------------------------------');
    
    // Simulate data starting at 00:05 (first interval at 5 minutes past midnight)
    const gappedData = [];
    
    // Start at 00:05 instead of 00:00
    for (let hour = 0; hour < 4; hour++) {
        for (let minute = 5; minute < 60; minute += 5) {
            gappedData.push({
                time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
                hour: hour,
                minute: minute
            });
        }
    }
    
    console.log('Data starts at:', gappedData[0].time);
    console.log('First few intervals:', gappedData.slice(0, 5).map(d => d.time).join(', '));
    console.log();
    
    console.log('X-axis tick generation with this data:');
    console.log('Index | Data Time | Tick Label | Problem');
    console.log('------|-----------|------------|----------');
    
    for (let i = 0; i < Math.min(15, gappedData.length); i++) {
        const dataTime = gappedData[i].time;
        const hour = Math.floor(i / 12);
        const tickLabel = i % 12 === 0 ? `${hour}:00` : '';
        
        if (tickLabel) {
            const problem = tickLabel !== `${gappedData[i].hour}:00` ? 'MISALIGNED' : 'OK';
            console.log(`${String(i).padStart(5)} | ${dataTime.padStart(9)} | ${tickLabel.padStart(10)} | ${problem}`);
        }
    }
    
    console.log('\n❌ Problem: Tick shows "0:00" but data is actually "00:05"');
    console.log('This creates the appearance of a time shift!\n');
}

// Show the fix
function showSolution() {
    console.log('3. Proposed Solution');
    console.log('--------------------');
    
    console.log('Instead of using array index, use the actual data times:');
    console.log('');
    console.log('CURRENT (broken):');
    console.log('callback: function(val, index) {');
    console.log('    const hour = Math.floor(index / 12);');
    console.log('    return index % 12 === 0 ? `${hour}:00` : "";');
    console.log('}');
    console.log('');
    console.log('FIXED:');
    console.log('callback: function(val, index, values) {');
    console.log('    const dataTime = labels[index];');
    console.log('    const [hour, minute] = dataTime.split(":");');
    console.log('    return minute === "00" ? `${hour}:00` : "";');
    console.log('}');
    console.log('');
    console.log('This ensures x-axis labels match the actual data timestamps!');
}

// Run all tests
const fullDayData = generateFullDayData();
testXAxisTicks(fullDayData);
testWithGaps();
showSolution();
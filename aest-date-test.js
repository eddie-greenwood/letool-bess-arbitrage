/**
 * Test the todayAEST() function from NEM Harvester
 * to check if it correctly handles AEST dates
 */

console.log('=== todayAEST() Function Analysis ===\n');

// Current implementation from NEM Harvester
function todayAEST() {
  const now = new Date();
  now.setHours(now.getHours() + 10);
  return now.toISOString().split('T')[0];
}

// Better implementation that respects AEST timezone
function todayAESTFixed() {
  // AEST is UTC+10, no daylight saving according to AEMO documentation
  const now = new Date();
  const aestTime = new Date(now.getTime() + (10 * 60 * 60 * 1000)); // Add 10 hours in milliseconds
  return aestTime.toISOString().split('T')[0];
}

// Even better - use proper timezone handling
function todayAESTBest() {
  const now = new Date();
  // Create a date in AEST timezone
  const aestDate = new Date(now.toLocaleString("en-AU", {timeZone: "Australia/Brisbane"}));
  const year = aestDate.getFullYear();
  const month = String(aestDate.getMonth() + 1).padStart(2, '0');
  const day = String(aestDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

console.log('Current time (UTC):', new Date().toISOString());
console.log('Current local time:', new Date().toString());
console.log();

console.log('todayAEST() (current):', todayAEST());
console.log('todayAESTFixed():', todayAESTFixed()); 
console.log('todayAESTBest():', todayAESTBest());
console.log();

// Test edge cases - what happens around midnight?
console.log('=== Edge Case Testing ===');

function testEdgeCase(testDate) {
  const original = Date.now;
  Date.now = () => testDate.getTime();
  
  console.log(`Test time: ${testDate.toISOString()}`);
  console.log(`  Current impl: ${todayAEST()}`);
  console.log(`  Fixed impl: ${todayAESTFixed()}`);
  console.log(`  Best impl: ${todayAESTBest()}`);
  console.log();
  
  Date.now = original;
}

// Test around midnight UTC (should affect AEST date)
testEdgeCase(new Date('2025-01-03T13:30:00Z')); // 11:30 PM AEST Jan 3
testEdgeCase(new Date('2025-01-03T14:30:00Z')); // 12:30 AM AEST Jan 4

console.log('=== Analysis ===');
console.log('The current todayAEST() function may have issues:');
console.log('1. setHours() modifies the original Date object');
console.log('2. May not handle edge cases around midnight correctly');
console.log('3. Could be affected by local system timezone');
console.log();
console.log('However, for determining the current date in AEST, it should generally work');
console.log('The bigger issue is likely the chart x-axis alignment we already fixed.');
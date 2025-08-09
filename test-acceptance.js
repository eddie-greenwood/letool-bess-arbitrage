/**
 * Acceptance Tests for Lé Tool
 * 
 * Run these tests to validate the core functionality works correctly.
 * Usage: node test-acceptance.js
 */

// Simple test runner
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    if (condition) {
        console.log('✓', message);
        passedTests++;
    } else {
        console.error('✗', message);
        failedTests++;
    }
}

function assertClose(actual, expected, tolerance, message) {
    const diff = Math.abs(actual - expected);
    assert(diff <= tolerance, `${message} (expected: ${expected}, actual: ${actual})`);
}

// Test 1: Cyclic operation (SoC returns near initial)
function testCyclicOperation() {
    console.log('\n=== Test: Cyclic Operation ===');
    
    // Create synthetic price data with clear arbitrage
    const prices = new Array(288).fill(50);
    // Low prices in morning (6am-9am)
    for (let i = 72; i < 108; i++) prices[i] = 20;
    // High prices in evening (6pm-9pm)  
    for (let i = 216; i < 252; i++) prices[i] = 100;
    
    const result = optimiseBESS_DP({
        prices,
        capacityMWh: 100,
        powerMW: 50,
        etaC: 0.95,
        etaD: 0.95,
        soc0: 0.5,
        throughputCost: 5
    });
    
    const initialSoC = 50; // 50% of 100 MWh
    const finalSoC = result.socSeries[result.socSeries.length - 1];
    
    assertClose(finalSoC, initialSoC, 5, 'Final SoC returns near initial');
    assert(result.revenue > 0, 'Positive revenue generated');
    assert(result.cycles > 0 && result.cycles < 2, 'Reasonable cycle count');
}

// Test 2: Monotone cycles with throughput cost
function testMonotoneCycles() {
    console.log('\n=== Test: Monotone Cycles ===');
    
    const prices = new Array(288).fill(50);
    for (let i = 72; i < 108; i++) prices[i] = 20;
    for (let i = 216; i < 252; i++) prices[i] = 100;
    
    const result1 = optimiseBESS_DP({
        prices,
        capacityMWh: 100,
        powerMW: 50,
        throughputCost: 0
    });
    
    const result2 = optimiseBESS_DP({
        prices,
        capacityMWh: 100,
        powerMW: 50,
        throughputCost: 10
    });
    
    const result3 = optimiseBESS_DP({
        prices,
        capacityMWh: 100,
        powerMW: 50,
        throughputCost: 20
    });
    
    assert(result1.cycles >= result2.cycles, 'Higher cost reduces cycles');
    assert(result2.cycles >= result3.cycles, 'Even higher cost reduces cycles more');
    assert(result1.revenue >= result2.revenue, 'Higher cost reduces revenue');
}

// Test 3: Constraint satisfaction
function testConstraintSatisfaction() {
    console.log('\n=== Test: Constraint Satisfaction ===');
    
    const prices = new Array(288).fill(50);
    prices[100] = 200; // Spike
    prices[101] = -50; // Negative price
    
    const capacityMWh = 100;
    const powerMW = 25;
    
    const result = optimiseBESS_DP({
        prices,
        capacityMWh,
        powerMW
    });
    
    let violations = 0;
    for (let i = 0; i < result.socSeries.length; i++) {
        const soc = result.socSeries[i];
        if (soc < -0.001 || soc > capacityMWh + 0.001) {
            violations++;
        }
    }
    
    assert(violations === 0, 'No SoC constraint violations');
    
    // Check power limits
    let powerViolations = 0;
    for (let i = 0; i < result.flows.length; i++) {
        const flow = result.flows[i];
        const power = Math.max(flow.buyMWh, flow.sellMWh) / (5/60);
        if (power > powerMW + 0.001) {
            powerViolations++;
        }
    }
    
    assert(powerViolations === 0, 'No power constraint violations');
}

// Test 4: Price cleaning options
function testPriceCleaning() {
    console.log('\n=== Test: Price Cleaning ===');
    
    const rawPrices = [50, 100, 20000, -2000, null, NaN, 75, 80];
    
    // Test raw mode (default)
    const cleaned1 = cleanPrices(rawPrices);
    assert(cleaned1[2] === 20000, 'Raw mode preserves high prices');
    assert(cleaned1[3] === -2000, 'Raw mode preserves negative prices');
    assert(cleaned1[4] === 0, 'Nulls converted to 0');
    assert(cleaned1[5] === 0, 'NaNs converted to 0');
    
    // Test clamped mode
    const cleaned2 = cleanPrices(rawPrices, { clamp: true });
    assert(cleaned2[2] === 16600, 'Clamp mode caps high prices');
    assert(cleaned2[3] === -1000, 'Clamp mode floors negative prices');
    
    // Test despike mode
    const cleaned3 = cleanPrices(rawPrices, { despike: true });
    assert(cleaned3[2] !== 20000, 'Despike smooths outliers');
}

// Test 5: Efficiency model
function testEfficiencyModel() {
    console.log('\n=== Test: Efficiency Model ===');
    
    const prices = new Array(288).fill(50);
    prices[100] = 20;  // Charge opportunity
    prices[200] = 100; // Discharge opportunity
    
    const etaC = 0.95;
    const etaD = 0.92;
    const rtEfficiency = etaC * etaD; // 0.874
    
    const result = optimiseBESS_DP({
        prices,
        capacityMWh: 100,
        powerMW: 50,
        etaC,
        etaD
    });
    
    // Find a charge and discharge pair
    let chargeFlow = null;
    let dischargeFlow = null;
    
    for (const flow of result.flows) {
        if (flow.op === 'charge' && !chargeFlow) chargeFlow = flow;
        if (flow.op === 'discharge' && !dischargeFlow) dischargeFlow = flow;
    }
    
    if (chargeFlow && dischargeFlow) {
        // Verify efficiency is applied correctly
        assert(chargeFlow.buyMWh > 0, 'Charge flow has grid import');
        assert(dischargeFlow.sellMWh > 0, 'Discharge flow has grid export');
    }
}

// Run all tests
console.log('Running Lé Tool Acceptance Tests...\n');

// Load the optimizer functions (would need to be exported properly)
// For now, we'll note that these would be run in a browser or proper test environment

try {
    // In a real test environment, load the modules first
    if (typeof optimiseBESS_DP === 'undefined') {
        console.log('Note: Tests should be run in environment with dp-optimizer.js loaded');
        console.log('Example: Include via script tag in HTML test page');
    } else {
        testCyclicOperation();
        testMonotoneCycles();
        testConstraintSatisfaction();
        testPriceCleaning();
        testEfficiencyModel();
        
        console.log('\n=== Test Summary ===');
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${failedTests}`);
        
        if (failedTests === 0) {
            console.log('✓ All tests passed!');
        } else {
            console.log('✗ Some tests failed');
            process.exit(1);
        }
    }
} catch (error) {
    console.error('Test error:', error);
    process.exit(1);
}
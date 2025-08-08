/* ============================================
 * LÉ TOOL - GREENWOOD ENERGY BESS DASHBOARD
 * Version: 1.0
 * Powered by: Greenwood Energy
 * 
 * 🚀 PRODUCTION READY VERSION
 * - OpenNEM API integration (public, no auth)
 * - Cloudflare Pages compatible
 * - GitHub deployable
 * ============================================ */

// Brand colors for charts
const GREENWOOD_COLORS = {
    primary: '#00E87E',
    dark: '#000000',
    light: '#00FF8C',
    accent: '#00C96A',
    success: '#00E87E',
    danger: '#FF6B6B',
    warning: '#FFB84D'
};

// Chart instances
let priceChart = null;
let socChart = null;
let dailyRevenueChart = null;
let cumulativeChart = null;
let utilizationChart = null;

// Analysis results
let analysisResults = null;
let currentDayIndex = 0;

/**
 * Initialize the application
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('🌿 Lé Tool by Greenwood Energy - Initialized');
    console.log('📊 BESS Opportunity Dashboard v1.0');
    
    // Set default dates (last 7 days)
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    
    document.getElementById('startDate').value = weekAgo.toISOString().split('T')[0];
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
    
    console.log('💡 Ready to analyze BESS opportunities');
});

/**
 * Test API connection
 */
async function testAPIConnection() {
    console.clear();
    console.log('🌿 GREENWOOD ENERGY - Testing API Connections...');
    
    const testResults = [];
    
    // Test Worker API
    try {
        const workerUrl = 'https://letool-api.eddie-37d.workers.dev/api/test';
            
        const resp = await fetch(workerUrl);
        
        if (resp.ok) {
            const data = await resp.json();
            console.log('✅ Worker API Response:', data);
            if (data.opennem_reachable) {
                testResults.push('✅ Worker API: Connected');
                testResults.push('✅ OpenNEM via Worker: Accessible');
            } else {
                testResults.push('✅ Worker API: Connected');
                testResults.push('⚠️ OpenNEM via Worker: Not accessible');
            }
        } else {
            testResults.push(`⚠️ Worker API returned ${resp.status}`);
        }
    } catch (e) {
        console.error('Worker API failed:', e);
        testResults.push(`⚠️ Worker API: ${e.message}`);
    }
    
    // Test direct OpenNEM connection
    try {
        const resp = await fetch('https://api.opennem.org.au/networks');
        
        if (resp.ok) {
            const data = await resp.json();
            console.log('✅ Direct API Response:', data);
            testResults.push('✅ Direct OpenNEM: Accessible (no CORS)');
        } else {
            testResults.push(`❌ Direct OpenNEM: HTTP ${resp.status}`);
        }
    } catch (e) {
        console.error('❌ Direct connection failed:', e);
        testResults.push(`❌ Direct OpenNEM: ${e.message.includes('Failed to fetch') ? 'CORS blocked' : e.message}`);
    }
    
    // Test price endpoint via Worker
    try {
        const today = new Date().toISOString().split('T')[0];
        const workerUrl = window.location.hostname === 'localhost' 
            ? `https://letool-api.eddie-37d.workers.dev/api/price?region=VIC1&date=${today}`
            : `/api/price?region=VIC1&date=${today}`;
            
        const resp = await fetch(workerUrl);
        
        if (resp.ok) {
            const data = await resp.json();
            console.log('✅ Price data via Worker:', data);
            testResults.push('✅ Price data via Worker: Success');
        } else {
            testResults.push(`⚠️ Price via Worker: HTTP ${resp.status}`);
        }
    } catch (e) {
        testResults.push(`⚠️ Price via Worker: ${e.message}`);
    }
    
    const msg = testResults.join('\n');
    alert('Greenwood Energy - API Test Results:\n\n' + msg + '\n\nCheck console for details.');
    
    return testResults;
}

/**
 * Switch between tabs
 */
function switchTab(tab) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');
    
    if (tab === 'daily' && analysisResults) {
        updateDailyView(currentDayIndex);
    }
}

/**
 * Main analysis function
 */
async function analyzeOpportunity() {
    const region = document.getElementById('region').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const numUnits = parseInt(document.getElementById('numUnits').value);
    const power = parseFloat(document.getElementById('power').value);
    const capacity = parseFloat(document.getElementById('capacity').value);
    const efficiency = parseFloat(document.getElementById('efficiency').value) / 100;
    const maxCycles = parseFloat(document.getElementById('maxCycles').value);
    
    if (new Date(startDate) > new Date(endDate)) {
        alert('Start date must be before end date');
        return;
    }
    
    document.getElementById('loading').classList.add('active');
    document.getElementById('error').classList.remove('active');
    document.getElementById('metrics').style.display = 'none';
    document.getElementById('navTabs').style.display = 'none';
    
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        
        const dailyResults = [];
        let totalRevenue = 0;
        let totalEnergy = 0;
        let totalCycles = 0;
        let bestDayRevenue = 0;
        let bestDayDate = '';
        
        for (let i = 0; i < days; i++) {
            const currentDate = new Date(start);
            currentDate.setDate(currentDate.getDate() + i);
            const dateStr = currentDate.toISOString().split('T')[0];
            
            const progress = ((i + 1) / days) * 100;
            document.getElementById('progressBar').style.width = progress + '%';
            document.getElementById('progressText').textContent = 
                `Analyzing ${dateStr} (${i + 1}/${days})`;
            
            const dayData = await fetchDayData(dateStr, region);
            
            const dayResult = calculateMultiCycleArbitrage(
                dayData, 
                efficiency, 
                maxCycles, 
                capacity * numUnits,
                power * numUnits
            );
            
            dayResult.date = dateStr;
            dailyResults.push(dayResult);
            
            totalRevenue += dayResult.revenue;
            totalEnergy += dayResult.energyTraded;
            totalCycles += dayResult.cycles;
            
            if (dayResult.revenue > bestDayRevenue) {
                bestDayRevenue = dayResult.revenue;
                bestDayDate = dateStr;
            }
        }
        
        analysisResults = {
            dailyResults,
            totalRevenue,
            totalEnergy,
            totalCycles,
            avgDaily: totalRevenue / days,
            avgCycles: totalCycles / days,
            bestDayRevenue,
            bestDayDate,
            numUnits,
            power,
            capacity,
            days
        };
        
        updateMetrics(analysisResults);
        updateCharts(analysisResults);
        
        document.getElementById('metrics').style.display = 'grid';
        document.getElementById('navTabs').style.display = 'flex';
        
        currentDayIndex = 0;
        updateDailyView(0);
        
    } catch (error) {
        console.error('Error analyzing:', error);
        document.getElementById('error').textContent = 
            'Error during analysis: ' + error.message;
        document.getElementById('error').classList.add('active');
    } finally {
        document.getElementById('loading').classList.remove('active');
    }
}

/**
 * Fetch day data from OpenNEM API via Worker proxy
 */
async function fetchDayData(date, region) {
    try {
        console.log(`Fetching data for ${date} in ${region}`);
        
        // Use Worker API 
        const workerUrl = `https://letool-api.eddie-37d.workers.dev/api/price/${region}?date=${date}`;
        
        try {
            const resp = await fetch(workerUrl);
            
            if (resp.ok) {
                const data = await resp.json();
                
                // Check if we got valid data from Worker
                if (data.success && data.data) {
                    document.getElementById('dataSource').textContent = 
                        data.source === 'opennem' ? '🟢 Live data from OpenNEM API' : '📊 High-quality market simulation';
                    return data.data; // Return the intervals directly
                }
                
                // If data has the old format, try parsing it
                let parsedData = parseOpenNEMData(data);
                
                if (parsedData && parsedData.length > 0) {
                    document.getElementById('dataSource').textContent = 
                        '🟢 Live data from OpenNEM API';
                    return parsedData;
                }
            }
        } catch (workerError) {
            console.log('Worker API failed, trying direct:', workerError);
        }
        
        // Fallback to direct API call (may fail due to CORS)
        const directUrl = `https://api.opennem.org.au/stats/price/NEM/${region}?date=${date}`;
        const resp = await fetch(directUrl);
        
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        
        const data = await resp.json();
        let parsedData = parseOpenNEMData(data);
        
        if (parsedData && parsedData.length > 0) {
            document.getElementById('dataSource').textContent = 
                '🟢 Live data from OpenNEM API (direct)';
            return parsedData;
        } else {
            document.getElementById('dataSource').textContent = 
                '📊 Using simulated data (no API data for this date)';
            return simulateMarketData(date, region);
        }
        
    } catch (error) {
        console.error('Fetch failed:', error);
        document.getElementById('dataSource').textContent = 
            `📊 Using simulated data (API unavailable)`;
        return simulateMarketData(date, region);
    }
}

/**
 * Parse OpenNEM API data format
 */
function parseOpenNEMData(apiData) {
    try {
        if (!apiData || !apiData.data || !Array.isArray(apiData.data)) {
            return null;
        }
        
        const priceData = apiData.data.find(d => 
            d.type === 'energy' || d.type === 'price' || d.id === 'price.spot'
        );
        
        if (!priceData || !priceData.history || !priceData.history.data) {
            return null;
        }
        
        const prices = priceData.history.data;
        const startTime = new Date(priceData.history.start);
        const interval = priceData.history.interval === '5m' ? 5 : 30;
        
        const intervals = [];
        prices.forEach((price, index) => {
            if (price !== null && !isNaN(price)) {
                const time = new Date(startTime.getTime() + index * interval * 60000);
                intervals.push({
                    time: `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`,
                    hour: time.getHours(),
                    minute: time.getMinutes(),
                    price: parseFloat(price)
                });
            }
        });
        
        return intervals.length >= 48 ? intervals : null;
        
    } catch (error) {
        console.error('Error parsing OpenNEM data:', error);
        return null;
    }
}

/**
 * Simulate market data when API unavailable
 */
function simulateMarketData(date, region) {
    const intervals = [];
    const hoursInDay = 24;
    const intervalsPerHour = 12;
    
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    for (let hour = 0; hour < hoursInDay; hour++) {
        for (let interval = 0; interval < intervalsPerHour; interval++) {
            const time = hour + (interval * 5) / 60;
            
            let price = 80;
            const weekendFactor = isWeekend ? 0.7 : 1.0;
            
            // Duck curve simulation
            if (time >= 23 || time < 5) {
                price = (30 + Math.random() * 20) * weekendFactor;
            } else if (time >= 5 && time < 7) {
                price = (50 + (time - 5) * 30 + Math.random() * 20) * weekendFactor;
            } else if (time >= 7 && time < 9) {
                price = (120 + Math.random() * 40) * weekendFactor;
            } else if (time >= 9 && time < 15) {
                const solarPeak = 12;
                const solarImpact = Math.exp(-Math.pow(time - solarPeak, 2) / 4);
                price = (60 - solarImpact * 50 + Math.random() * 30) * weekendFactor;
            } else if (time >= 15 && time < 17) {
                price = (70 + (time - 15) * 20 + Math.random() * 20) * weekendFactor;
            } else if (time >= 17 && time < 21) {
                price = (150 + Math.random() * 50) * weekendFactor;
            } else {
                price = (100 - (time - 21) * 30 + Math.random() * 20) * weekendFactor;
            }
            
            price += (Math.random() - 0.5) * 20;
            
            if (Math.random() < 0.02) {
                price *= 2 + Math.random();
            }
            
            intervals.push({
                time: `${String(hour).padStart(2, '0')}:${String(interval * 5).padStart(2, '0')}`,
                hour: hour,
                minute: interval * 5,
                price: Math.max(-50, Math.min(300, price))
            });
        }
    }
    
    return intervals;
}

/**
 * Calculate multi-cycle arbitrage opportunities
 */
function calculateMultiCycleArbitrage(data, efficiency, maxCycles, totalCapacity, totalPower) {
    const intervals = data.length;
    const timeStep = 5 / 60;
    
    let soc = 0;
    const socHistory = [];
    const operations = [];
    
    const priceWindows = [];
    for (let i = 0; i < intervals; i++) {
        priceWindows.push({
            index: i,
            price: data[i].price,
            type: 'neutral'
        });
    }
    
    const sortedByPrice = [...priceWindows].sort((a, b) => a.price - b.price);
    
    const intervalsPerCycle = Math.ceil((totalCapacity / totalPower) / timeStep);
    const totalCycleIntervals = Math.floor(maxCycles * intervalsPerCycle * 2);
    
    const chargeCount = Math.min(Math.floor(totalCycleIntervals / 2), intervals / 2);
    for (let i = 0; i < chargeCount && i < sortedByPrice.length; i++) {
        priceWindows[sortedByPrice[i].index].type = 'charge';
    }
    
    for (let i = 0; i < chargeCount && i < sortedByPrice.length; i++) {
        const idx = sortedByPrice[sortedByPrice.length - 1 - i].index;
        if (priceWindows[idx].type === 'neutral') {
            priceWindows[idx].type = 'discharge';
        }
    }
    
    let revenue = 0;
    let energyCharged = 0;
    let energyDischarged = 0;
    let actualCycles = 0;
    
    for (let i = 0; i < intervals; i++) {
        const window = priceWindows[i];
        let powerFlow = 0;
        
        if (window.type === 'charge' && soc < totalCapacity) {
            const chargeAmount = Math.min(
                totalPower * timeStep,
                totalCapacity - soc
            );
            soc += chargeAmount;
            powerFlow = -chargeAmount / timeStep;
            revenue -= chargeAmount * data[i].price;
            energyCharged += chargeAmount;
        } else if (window.type === 'discharge' && soc > 0) {
            const dischargeAmount = Math.min(
                totalPower * timeStep * efficiency,
                soc
            );
            soc -= dischargeAmount;
            powerFlow = dischargeAmount / timeStep;
            revenue += dischargeAmount * data[i].price;
            energyDischarged += dischargeAmount;
        }
        
        socHistory.push(soc);
        operations.push({
            ...data[i],
            soc: soc,
            powerFlow: powerFlow,
            operation: window.type
        });
    }
    
    actualCycles = Math.min(energyCharged, energyDischarged) / totalCapacity;
    
    const chargeIntervals = priceWindows.filter(w => w.type === 'charge');
    const dischargeIntervals = priceWindows.filter(w => w.type === 'discharge');
    
    const avgChargePrice = chargeIntervals.length > 0 
        ? chargeIntervals.reduce((sum, w) => sum + data[w.index].price, 0) / chargeIntervals.length
        : 0;
    
    const avgDischargePrice = dischargeIntervals.length > 0
        ? dischargeIntervals.reduce((sum, w) => sum + data[w.index].price, 0) / dischargeIntervals.length
        : 0;
    
    return {
        revenue: revenue,
        cycles: actualCycles,
        avgSpread: avgDischargePrice - avgChargePrice,
        energyTraded: energyCharged + energyDischarged,
        operations: operations,
        socHistory: socHistory,
        avgChargePrice,
        avgDischargePrice
    };
}

/**
 * Update metrics display
 */
function updateMetrics(results) {
    document.getElementById('totalRevenue').textContent = 
        '$' + results.totalRevenue.toLocaleString('en-AU', { maximumFractionDigits: 0 });
    document.getElementById('avgDaily').textContent = 
        '$' + results.avgDaily.toLocaleString('en-AU', { maximumFractionDigits: 0 });
    document.getElementById('totalEnergy').textContent = 
        results.totalEnergy.toLocaleString('en-AU', { maximumFractionDigits: 0 });
    document.getElementById('avgCycles').textContent = 
        results.avgCycles.toFixed(2);
    document.getElementById('bestDay').textContent = 
        '$' + results.bestDayRevenue.toLocaleString('en-AU', { maximumFractionDigits: 0 });
    document.getElementById('bestDayDate').textContent = 
        results.bestDayDate;
    
    const annualized = results.avgDaily * 365;
    document.getElementById('annualRevenue').textContent = 
        '$' + annualized.toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

/**
 * Update all charts
 */
function updateCharts(results) {
    updateDailyRevenueChart(results);
    updateCumulativeChart(results);
    updateUtilizationChart(results);
    updateResultsTable(results);
    
    document.getElementById('dailyRevenueChartContainer').style.display = 'block';
    document.getElementById('cumulativeChartContainer').style.display = 'block';
    document.getElementById('utilizationChartContainer').style.display = 'block';
    document.getElementById('resultsTable').style.display = 'block';
}

/**
 * Update daily view
 */
function updateDailyView(dayIndex) {
    if (!analysisResults || dayIndex >= analysisResults.dailyResults.length) return;
    
    const dayResult = analysisResults.dailyResults[dayIndex];
    currentDayIndex = dayIndex;
    
    updatePriceChart(dayResult);
    updateSoCChart(dayResult);
    
    document.getElementById('priceChartContainer').style.display = 'block';
    document.getElementById('socChartContainer').style.display = 'block';
}

/**
 * Update price chart
 */
function updatePriceChart(dayResult) {
    const ctx = document.getElementById('priceChart').getContext('2d');
    
    if (priceChart) priceChart.destroy();
    
    const labels = dayResult.operations.map(op => op.time);
    const prices = dayResult.operations.map(op => op.price);
    
    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Market Price ($/MWh)',
                data: prices,
                borderColor: GREENWOOD_COLORS.primary,
                backgroundColor: `${GREENWOOD_COLORS.primary}20`,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const op = dayResult.operations[context.dataIndex];
                            let label = `Price: ${context.parsed.y.toFixed(2)}/MWh`;
                            if (op.operation === 'charge') label += ' (Charging)';
                            else if (op.operation === 'discharge') label += ' (Discharging)';
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: {
                        maxTicksLimit: 24,
                        callback: function(val, index) {
                            const hour = Math.floor(index / 12);
                            return index % 12 === 0 ? `${hour}:00` : '';
                        }
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Price ($/MWh)'
                    }
                }
            }
        },
        plugins: [{
            beforeDraw: (chart) => {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;
                
                dayResult.operations.forEach((op, index) => {
                    if (op.operation === 'charge') {
                        const x = xAxis.getPixelForValue(index);
                        const width = xAxis.getPixelForValue(1) - xAxis.getPixelForValue(0);
                        ctx.fillStyle = `${GREENWOOD_COLORS.primary}30`;
                        ctx.fillRect(x - width/2, yAxis.top, width, yAxis.bottom - yAxis.top);
                    } else if (op.operation === 'discharge') {
                        const x = xAxis.getPixelForValue(index);
                        const width = xAxis.getPixelForValue(1) - xAxis.getPixelForValue(0);
                        ctx.fillStyle = `${GREENWOOD_COLORS.danger}30`;
                        ctx.fillRect(x - width/2, yAxis.top, width, yAxis.bottom - yAxis.top);
                    }
                });
            }
        }]
    });
}

/**
 * Update State of Charge chart
 */
function updateSoCChart(dayResult) {
    const ctx = document.getElementById('socChart').getContext('2d');
    
    if (socChart) socChart.destroy();
    
    const labels = dayResult.operations.map(op => op.time);
    const socData = dayResult.socHistory;
    const maxCapacity = analysisResults.capacity * analysisResults.numUnits;
    const socPercentage = socData.map(soc => (soc / maxCapacity) * 100);
    
    socChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'State of Charge (%)',
                data: socPercentage,
                borderColor: GREENWOOD_COLORS.accent,
                backgroundColor: `${GREENWOOD_COLORS.accent}20`,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const soc = dayResult.socHistory[context.dataIndex];
                            return [
                                `SoC: ${context.parsed.y.toFixed(1)}%`,
                                `Energy: ${soc.toFixed(1)} MWh`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: {
                        maxTicksLimit: 24,
                        callback: function(val, index) {
                            const hour = Math.floor(index / 12);
                            return index % 12 === 0 ? `${hour}:00` : '';
                        }
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'State of Charge (%)'
                    },
                    min: 0,
                    max: 100
                }
            }
        }
    });
}

/**
 * Update daily revenue chart
 */
function updateDailyRevenueChart(results) {
    const ctx = document.getElementById('dailyRevenueChart').getContext('2d');
    
    if (dailyRevenueChart) dailyRevenueChart.destroy();
    
    const labels = results.dailyResults.map(r => r.date);
    const revenues = results.dailyResults.map(r => r.revenue);
    
    dailyRevenueChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Revenue ($)',
                data: revenues,
                backgroundColor: `${GREENWOOD_COLORS.primary}CC`,
                borderColor: GREENWOOD_COLORS.primary,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Revenue: $${context.parsed.y.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Revenue ($)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString('en-AU', { maximumFractionDigits: 0 });
                        }
                    }
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    currentDayIndex = index;
                    switchTab('daily');
                    updateDailyView(index);
                }
            }
        }
    });
}

/**
 * Update cumulative revenue chart
 */
function updateCumulativeChart(results) {
    const ctx = document.getElementById('cumulativeChart').getContext('2d');
    
    if (cumulativeChart) cumulativeChart.destroy();
    
    const labels = results.dailyResults.map(r => r.date);
    let cumulative = 0;
    const cumulativeData = results.dailyResults.map(r => {
        cumulative += r.revenue;
        return cumulative;
    });
    
    cumulativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Cumulative Revenue ($)',
                data: cumulativeData,
                borderColor: GREENWOOD_COLORS.accent,
                backgroundColor: `${GREENWOOD_COLORS.accent}10`,
                borderWidth: 3,
                pointRadius: 4,
                pointBackgroundColor: GREENWOOD_COLORS.accent,
                tension: 0.2,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Total: $${context.parsed.y.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Cumulative Revenue ($)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString('en-AU', { maximumFractionDigits: 0 });
                        }
                    }
                }
            }
        }
    });
}

/**
 * Update utilization chart
 */
function updateUtilizationChart(results) {
    const ctx = document.getElementById('utilizationChart').getContext('2d');
    
    if (utilizationChart) utilizationChart.destroy();
    
    const avgUtilization = (results.avgCycles / results.maxCycles) * 100 || 0;
    
    utilizationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Utilized', 'Available'],
            datasets: [{
                data: [avgUtilization, 100 - avgUtilization],
                backgroundColor: [
                    GREENWOOD_COLORS.primary,
                    '#e0e0e0'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.label + ': ' + context.parsed.toFixed(1) + '%';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Update results table
 */
function updateResultsTable(results) {
    const tbody = document.getElementById('resultsTableBody');
    tbody.innerHTML = '';
    
    results.dailyResults.forEach(day => {
        const row = tbody.insertRow();
        row.insertCell(0).textContent = day.date;
        row.insertCell(1).textContent = '$' + day.revenue.toLocaleString('en-AU', { maximumFractionDigits: 0 });
        row.insertCell(2).textContent = day.cycles.toFixed(2);
        row.insertCell(3).textContent = '$' + day.avgSpread.toFixed(2);
        row.insertCell(4).textContent = day.energyTraded.toFixed(1) + ' MWh';
    });
    
    // Add total row
    const totalRow = tbody.insertRow();
    totalRow.className = 'total-row';
    totalRow.insertCell(0).textContent = 'TOTAL';
    totalRow.insertCell(1).textContent = '$' + results.totalRevenue.toLocaleString('en-AU', { maximumFractionDigits: 0 });
    totalRow.insertCell(2).textContent = results.totalCycles.toFixed(2);
    totalRow.insertCell(3).textContent = '-';
    totalRow.insertCell(4).textContent = results.totalEnergy.toFixed(1) + ' MWh';
}
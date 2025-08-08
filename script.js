// Initialize date input with today's date
document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('date');
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
    dateInput.max = today;
});

// Chart instances
let priceChart = null;
let operationChart = null;

// Calculate button event listener
document.getElementById('calculate').addEventListener('click', async () => {
    const region = document.getElementById('region').value;
    const capacity = parseFloat(document.getElementById('capacity').value);
    const power = parseFloat(document.getElementById('power').value);
    const efficiency = parseFloat(document.getElementById('efficiency').value) / 100;
    const date = document.getElementById('date').value;

    // Show loading, hide results
    document.getElementById('loading').style.display = 'block';
    document.getElementById('results').style.display = 'none';

    try {
        // Fetch price data from OpenNEM
        const priceData = await fetchPriceData(region, date);
        
        // Calculate arbitrage opportunities
        const arbitrage = calculateArbitrage(priceData, capacity, power, efficiency);
        
        // Display results
        displayResults(arbitrage, priceData);
        
        // Hide loading, show results
        document.getElementById('loading').style.display = 'none';
        document.getElementById('results').style.display = 'block';
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to fetch data or calculate arbitrage. Please try again.');
        document.getElementById('loading').style.display = 'none';
    }
});

async function fetchPriceData(region, date) {
    // OpenNEM API endpoint for price data
    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    
    // Using OpenNEM's public API
    const url = `https://api.opennem.org.au/stats/price/energy/${region}?period=5m&start=${startStr}&end=${endStr}`;
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            // If OpenNEM API fails, use mock data for demonstration
            console.warn('OpenNEM API not available, using mock data');
            return generateMockData();
        }
        
        const data = await response.json();
        return processPriceData(data);
    } catch (error) {
        console.warn('Failed to fetch from OpenNEM, using mock data:', error);
        return generateMockData();
    }
}

function processPriceData(apiData) {
    // Process OpenNEM API response
    if (apiData && apiData.data && apiData.data.length > 0) {
        const priceData = apiData.data[0];
        const prices = [];
        
        if (priceData.history && priceData.history.data) {
            priceData.history.data.forEach((value, index) => {
                if (value !== null) {
                    prices.push({
                        time: priceData.history.start + (index * 5 * 60 * 1000), // 5-minute intervals
                        price: value
                    });
                }
            });
        }
        
        return prices;
    }
    
    // Fallback to mock data if API structure is unexpected
    return generateMockData();
}

function generateMockData() {
    // Generate realistic mock price data for demonstration
    const prices = [];
    const basePrice = 80;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 288; i++) { // 288 5-minute intervals in a day
        const hour = Math.floor(i * 5 / 60);
        const time = new Date(now.getTime() + i * 5 * 60 * 1000);
        
        // Simulate typical daily price pattern
        let price = basePrice;
        
        // Low prices at night (midnight to 6am)
        if (hour >= 0 && hour < 6) {
            price = basePrice - 30 + Math.random() * 20;
        }
        // Morning peak (6am to 9am)
        else if (hour >= 6 && hour < 9) {
            price = basePrice + 40 + Math.random() * 30;
        }
        // Midday with solar (9am to 3pm)
        else if (hour >= 9 && hour < 15) {
            price = basePrice - 20 + Math.random() * 15;
        }
        // Evening peak (5pm to 9pm)
        else if (hour >= 17 && hour < 21) {
            price = basePrice + 60 + Math.random() * 40;
        }
        // Evening/night
        else {
            price = basePrice + Math.random() * 20;
        }
        
        prices.push({
            time: time.getTime(),
            price: Math.max(0, price)
        });
    }
    
    return prices;
}

function calculateArbitrage(priceData, capacity, power, efficiency) {
    // Sort prices to find best charge and discharge windows
    const sortedPrices = [...priceData].sort((a, b) => a.price - b.price);
    
    // Determine how many intervals needed for full charge/discharge
    const intervalsPerHour = 12; // 5-minute intervals
    const hoursToCharge = capacity / power;
    const intervalsToCharge = Math.ceil(hoursToCharge * intervalsPerHour);
    
    // Find cheapest periods to charge
    const chargePeriods = sortedPrices.slice(0, intervalsToCharge);
    
    // Find most expensive periods to discharge
    const dischargePeriods = sortedPrices.slice(-intervalsToCharge);
    
    // Calculate revenue
    let chargeEnergy = 0;
    let chargeCost = 0;
    let dischargeEnergy = 0;
    let dischargeRevenue = 0;
    
    chargePeriods.forEach(period => {
        const energy = Math.min(power / intervalsPerHour, capacity - chargeEnergy);
        chargeEnergy += energy;
        chargeCost += energy * period.price;
    });
    
    dischargePeriods.forEach(period => {
        const energy = Math.min(power / intervalsPerHour, chargeEnergy * efficiency - dischargeEnergy);
        dischargeEnergy += energy;
        dischargeRevenue += energy * period.price;
    });
    
    const netRevenue = dischargeRevenue - chargeCost;
    const avgSpread = (dischargeRevenue / dischargeEnergy) - (chargeCost / chargeEnergy);
    
    // Create operation schedule
    const operations = new Array(priceData.length).fill(0);
    
    priceData.forEach((period, index) => {
        if (chargePeriods.find(p => p.time === period.time)) {
            operations[index] = -1; // Charging
        } else if (dischargePeriods.find(p => p.time === period.time)) {
            operations[index] = 1; // Discharging
        }
    });
    
    return {
        revenue: netRevenue,
        chargeCost: chargeCost,
        dischargeRevenue: dischargeRevenue,
        chargeHours: chargePeriods.map(p => new Date(p.time).getHours()).filter((v, i, a) => a.indexOf(v) === i),
        dischargeHours: dischargePeriods.map(p => new Date(p.time).getHours()).filter((v, i, a) => a.indexOf(v) === i),
        avgSpread: avgSpread,
        operations: operations
    };
}

function displayResults(arbitrage, priceData) {
    // Update metrics
    document.getElementById('daily-revenue').textContent = `$${arbitrage.revenue.toFixed(2)}`;
    document.getElementById('charge-hours').textContent = arbitrage.chargeHours.sort((a, b) => a - b).join(', ') + 'h';
    document.getElementById('discharge-hours').textContent = arbitrage.dischargeHours.sort((a, b) => a - b).join(', ') + 'h';
    document.getElementById('avg-spread').textContent = `$${arbitrage.avgSpread.toFixed(2)}/MWh`;
    
    // Prepare chart data
    const labels = priceData.map(p => {
        const date = new Date(p.time);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    });
    
    // Show every 12th label (hourly)
    const displayLabels = labels.map((label, index) => index % 12 === 0 ? label : '');
    
    // Update price chart
    if (priceChart) {
        priceChart.destroy();
    }
    
    const priceCtx = document.getElementById('priceChart').getContext('2d');
    priceChart = new Chart(priceCtx, {
        type: 'line',
        data: {
            labels: displayLabels,
            datasets: [{
                label: 'Energy Price ($/MWh)',
                data: priceData.map(p => p.price),
                borderColor: 'rgb(102, 126, 234)',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.1,
                pointRadius: 0,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Energy Prices Throughout the Day'
                },
                legend: {
                    display: true
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Price ($/MWh)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Time'
                    }
                }
            }
        }
    });
    
    // Update operation chart
    if (operationChart) {
        operationChart.destroy();
    }
    
    const operationCtx = document.getElementById('operationChart').getContext('2d');
    operationChart = new Chart(operationCtx, {
        type: 'bar',
        data: {
            labels: displayLabels,
            datasets: [{
                label: 'Battery Operation',
                data: arbitrage.operations.map(op => op * 50), // Scale for visibility
                backgroundColor: arbitrage.operations.map(op => 
                    op < 0 ? 'rgba(76, 175, 80, 0.6)' : // Green for charging
                    op > 0 ? 'rgba(244, 67, 54, 0.6)' : // Red for discharging
                    'rgba(158, 158, 158, 0.2)' // Gray for idle
                ),
                borderColor: arbitrage.operations.map(op => 
                    op < 0 ? 'rgb(76, 175, 80)' :
                    op > 0 ? 'rgb(244, 67, 54)' :
                    'rgb(158, 158, 158)'
                ),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Battery Charge/Discharge Schedule'
                },
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw / 50;
                            if (value < 0) return 'Charging';
                            if (value > 0) return 'Discharging';
                            return 'Idle';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Operation'
                    },
                    ticks: {
                        callback: function(value) {
                            if (value > 0) return 'Discharge';
                            if (value < 0) return 'Charge';
                            return 'Idle';
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Time'
                    }
                }
            }
        }
    });
}
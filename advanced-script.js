/* ============================================
 * LÉ TOOL - GREENWOOD ENERGY BESS DASHBOARD
 * Version: 2.0
 * Powered by: Greenwood Energy
 * 
 * PRODUCTION VERSION
 * - AEMO NEMWeb data integration via Cloudflare Pages Functions
 * - Dynamic Programming (DP) and Heuristic optimization algorithms
 * - Network tariff support (AusNet BESS trial tariffs)
 * - Real-time market analysis and revenue optimization
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

// ============================================
// NETWORK TARIFF DEFINITIONS
// ============================================
// AusNet 2024-25 Battery Storage Trial Tariffs
// Units: c/kWh converted to $/MWh (1 c/kWh = $10/MWh)
// Time windows in AEST/AEDT (Victoria time)

const TARIFFS = {
    NONE: {
        label: 'No Network Charges',
        standing_per_year: 0,
        windows: {},
        energy_c_per_kwh: {
            import: { solarSoak: 0, peak: 0, offPeak: 0 },
            export: { solarSoak: 0, peak: 0, offPeak: 0 }
        },
        demand_per_kva_month: {
            import: { solarSoak: 0, peak: 0, offPeak: 0 },
            export: { solarSoak: 0, peak: 0, offPeak: 0 }
        }
    },
    AUSNET_UESH01T: {
        label: 'AusNet UESH01T (HV) - Utility ESS',
        standing_per_year: 4999.72,   // $/year standing charge
        windows: {
            solarSoak: { start: '10:00', end: '15:00' },  // 10am-3pm solar soak
            peak:      { start: '15:00', end: '21:00' },  // 3pm-9pm peak (includes evening)
            // off-peak = everything else (9pm-10am)
        },
        // c/kWh; positive = cost, negative = credit
        energy_c_per_kwh: {
            import:  { solarSoak: 0.00, peak: 2.05,  offPeak: 0.59 },
            export:  { solarSoak: -1.10, peak: -2.50, offPeak: 0.00 }  // Credits shown as negative
        },
        // $/kVA/month demand charges (HV has none)
        demand_per_kva_month: {
            import:  { solarSoak: 0.00, peak: 0.00, offPeak: 0.00 },
            export:  { solarSoak: 0.00, peak: 0.00, offPeak: 0.00 }
        }
    },
    AUSNET_UESS01T: {
        label: 'AusNet UESS01T (Sub-Tx) - Utility ESS',
        standing_per_year: 17930.61,  // Higher standing charge for Sub-Tx
        windows: {
            solarSoak: { start: '10:00', end: '15:00' },  // 10am-3pm
            peak:      { start: '15:00', end: '21:00' },  // 3pm-9pm
        },
        energy_c_per_kwh: {
            import:  { solarSoak: 0.00, peak: 1.20,  offPeak: 0.32 },
            export:  { solarSoak: -1.10, peak: -1.80, offPeak: 0.00 }
        },
        // Sub-Tx has demand charges ($/kVA/month)
        demand_per_kva_month: {
            import:  { solarSoak: 0.65, peak: 1.20, offPeak: 0.00 },
            export:  { solarSoak: 0.00, peak: 0.00, offPeak: 0.00 }
        }
    },
    CUSTOM: {
        label: 'Custom Tariff',
        standing_per_year: 0,
        windows: {
            solarSoak: { start: '10:00', end: '15:00' },
            peak:      { start: '15:00', end: '21:00' },
        },
        energy_c_per_kwh: {
            import:  { solarSoak: 0, peak: 0, offPeak: 0 },
            export:  { solarSoak: 0, peak: 0, offPeak: 0 }
        },
        demand_per_kva_month: {
            import:  { solarSoak: 0, peak: 0, offPeak: 0 },
            export:  { solarSoak: 0, peak: 0, offPeak: 0 }
        }
    }
};

// Helper: Convert c/kWh to $/MWh
function cPerKwhToDollarPerMWh(cents) {
    return (cents || 0) * 10;
}

// Helper: Determine time-of-use period for a given time or timestamp
// FIXED: Now accepts either a time string (HH:MM) or timestamp, with time string preferred
function getTariffPeriod(timeOrTimestamp, windows, timeField = null) {
    if (!windows || Object.keys(windows).length === 0) return 'offPeak';
    
    let timeStr;
    
    // If we have a separate time field (AEST time), use that directly
    if (timeField && typeof timeField === 'string') {
        timeStr = timeField;
    }
    // If timeOrTimestamp is already a time string (HH:MM format)
    else if (typeof timeOrTimestamp === 'string' && timeOrTimestamp.match(/^\d{2}:\d{2}$/)) {
        timeStr = timeOrTimestamp;
    }
    // Otherwise, extract time from timestamp (fallback, less reliable due to timezone issues)
    else {
        const date = new Date(timeOrTimestamp);
        const hours = date.getHours();
        const minutes = date.getMinutes();
        timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    
    // Check each window
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

// Chart instances
let priceChart = null;
// SoC chart removed - now integrated into price chart
let dailyRevenueChart = null;
let cumulativeChart = null;
let utilizationChart = null;

// Analysis results
let analysisResults = null;
let currentDayIndex = 0;

// Live Price Ticker functionality
let priceHistory = {};
let cryptoPrices = null;

async function fetchCryptoPrices() {
    try {
        const response = await fetch('https://nem-harvester.eddie-37d.workers.dev/api/crypto-prices');
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
                cryptoPrices = data.data;
            }
        }
    } catch (error) {
        console.log('Crypto prices unavailable');
    }
}

async function fetchLivePrices() {
    const tickerInner = document.getElementById('tickerInner');
    const lastUpdateEl = document.getElementById('lastUpdate');
    
    try {
        // Show loading state
        if (!tickerInner.innerHTML || tickerInner.innerHTML.includes('Loading')) {
            tickerInner.innerHTML = '<div class="ticker-item"><span style="color: #00E87E;">Loading prices...</span></div>';
        }
        
        // Fetch AEMO prices and crypto prices in parallel
        const [aemoResponse] = await Promise.all([
            fetch('https://nem-harvester.eddie-37d.workers.dev/api/live-prices'),
            fetchCryptoPrices() // Fetch crypto but don't block on it
        ]);
        
        if (!aemoResponse.ok) {
            throw new Error(`HTTP ${aemoResponse.status}`);
        }
        
        const data = await aemoResponse.json();
        console.log('Live prices data:', data); // Debug log
        
        if (data.success && data.data && Object.keys(data.data).length > 0) {
            const regions = Object.keys(data.data).sort(); // Sort regions for consistent order
            const validResults = regions.map(region => ({
                region: region,
                price: data.data[region].price || 0,
                prevPrice: data.data[region].prevPrice || 0,
                change: data.data[region].change || 0,
                changePercent: data.data[region].changePercent || 0,
                source: data.data[region].source || 'unknown',
                isCrypto: false
            })).filter(r => r.price !== undefined); // Filter out invalid entries
        
            // Add crypto prices if available (easter egg)
            if (cryptoPrices) {
                // Add BTC
                if (cryptoPrices.BTC) {
                    validResults.push({
                        region: '₿ BTC',
                        price: cryptoPrices.BTC.price,
                        prevPrice: cryptoPrices.BTC.price / (1 + cryptoPrices.BTC.change24h / 100),
                        change: cryptoPrices.BTC.price * (cryptoPrices.BTC.change24h / 100),
                        changePercent: cryptoPrices.BTC.change24h,
                        isCrypto: true
                    });
                }
                // Add LTC
                if (cryptoPrices.LTC) {
                    validResults.push({
                        region: 'Ł LTC',
                        price: cryptoPrices.LTC.price,
                        prevPrice: cryptoPrices.LTC.price / (1 + cryptoPrices.LTC.change24h / 100),
                        change: cryptoPrices.LTC.price * (cryptoPrices.LTC.change24h / 100),
                        changePercent: cryptoPrices.LTC.change24h,
                        isCrypto: true
                    });
                }
            }
            
            if (validResults.length > 0) {
                // Clear and rebuild ticker
                let tickerHTML = '';
                
                // Create 3 copies for continuous scrolling
                for (let copy = 0; copy < 3; copy++) {
                    validResults.forEach(result => {
                        if (result.isCrypto) {
                            // Crypto styling
                            const changeClass = result.change >= 0 ? 'up' : 'down';
                            const arrow = result.change >= 0 ? '↑' : '↓';
                            const priceStr = result.price > 1000 ? 
                                `$${(result.price/1000).toFixed(1)}k` : 
                                `$${result.price.toFixed(2)}`;
                            
                            tickerHTML += `
                                <span class="ticker-item ticker-crypto">
                                    <span class="ticker-region" style="color: #ffd700;">${result.region}</span>
                                    <span class="ticker-price" style="color: #ffd700;">${priceStr}</span>
                                    <span class="ticker-change ${changeClass}">
                                        ${arrow} ${Math.abs(result.changePercent).toFixed(1)}%
                                    </span>
                                </span>
                            `;
                        } else {
                            // AEMO styling
                            const priceClass = result.price > 100 ? 'positive' : result.price < 0 ? 'negative' : 'neutral';
                            const changeClass = result.change >= 0 ? 'up' : 'down';
                            const arrow = result.change >= 0 ? '↑' : '↓';
                            
                            tickerHTML += `
                                <span class="ticker-item">
                                    <span class="ticker-region">${result.region}</span>
                                    <span class="ticker-price ${priceClass}">$${result.price.toFixed(2)}</span>
                                    <span class="ticker-change ${changeClass}">
                                        ${arrow} ${Math.abs(result.changePercent).toFixed(1)}%
                                    </span>
                                </span>
                            `;
                        }
                    });
                }
                
                tickerInner.innerHTML = tickerHTML;
                
                // Update last update time
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-AU', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    timeZone: 'Australia/Sydney'
                });
                lastUpdateEl.textContent = `Updated ${timeStr} AEST`;
            } else {
                // No valid results
                tickerInner.innerHTML = '<div class="ticker-item"><span style="color: #ffc107;">No price data available</span></div>';
                lastUpdateEl.textContent = 'No data';
            }
        } else {
            // No data received
            tickerInner.innerHTML = '<div class="ticker-item"><span style="color: #ffc107;">Waiting for data...</span></div>';
            lastUpdateEl.textContent = 'Waiting...';
        }
        
    } catch (error) {
        console.error('Error fetching live prices:', error);
        // Show error but keep any existing data
        if (!tickerInner.innerHTML || tickerInner.innerHTML.includes('Loading')) {
            tickerInner.innerHTML = '<div class="ticker-item"><span style="color: #ff6b6b;">Connection error - retrying...</span></div>';
        }
        lastUpdateEl.textContent = 'Retry in 60s';
    }
}

// Initialize ticker
function initializeTicker() {
    // Show loading immediately
    const tickerInner = document.getElementById('tickerInner');
    if (tickerInner) {
        tickerInner.innerHTML = '<span class="ticker-item"><span style="color: #00E87E;">Loading live prices...</span></span>';
    }
    
    // Fetch immediately
    fetchLivePrices();
    
    // Update every 30 seconds for fresher data
    setInterval(fetchLivePrices, 30000);
}

/**
 * Initialize the application
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('Lé Tool by Greenwood Energy - Initialized');
    console.log('BESS Opportunity Dashboard v1.0');
    
    // Initialize live price ticker
    initializeTicker();
    
    // Initialize site mode handlers
    initializeSiteModeHandlers();
    
    // Set default dates (last 7 days)
    setTimePeriod('7d');
    
    // Add listeners for manual date changes
    document.getElementById('startDate').addEventListener('change', updatePeriodButtons);
    document.getElementById('endDate').addEventListener('change', updatePeriodButtons);
    
    // Check API status quietly
    checkAPIStatus();
    
    console.log('Ready to analyze BESS opportunities');
});

/**
 * Set time period for analysis
 */
function setTimePeriod(period, evt) {
    const endDate = new Date();
    let startDate = new Date();
    
    // Remove active class from all buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to appropriate button
    if (evt && evt.target) {
        evt.target.classList.add('active');
    } else {
        // Find and activate the appropriate button
        document.querySelectorAll('.period-btn').forEach(btn => {
            if (btn.getAttribute('onclick')?.includes(period)) {
                btn.classList.add('active');
            }
        });
    }
    
    switch(period) {
        case 'yesterday':
            // Set both start and end to yesterday
            startDate.setDate(endDate.getDate() - 1);
            endDate.setDate(endDate.getDate() - 1);
            break;
        case '7d':
            startDate.setDate(endDate.getDate() - 6);
            break;
        case '14d':
            startDate.setDate(endDate.getDate() - 13);
            break;
        case '30d':
            startDate.setDate(endDate.getDate() - 29);
            break;
        case '90d':
            startDate.setDate(endDate.getDate() - 89);
            break;
        default:
            startDate.setDate(endDate.getDate() - 6);
    }
    
    // Set the date inputs
    document.getElementById('startDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('endDate').value = endDate.toISOString().split('T')[0];
}

// Make function globally available
window.setTimePeriod = setTimePeriod;

/**
 * Update period buttons based on current date selection
 */
function updatePeriodButtons() {
    const startDate = new Date(document.getElementById('startDate').value);
    const endDate = new Date(document.getElementById('endDate').value);
    
    if (isNaN(startDate) || isNaN(endDate)) return;
    
    const daysDiff = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    
    // Remove active class from all buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Check if it matches any preset period
    if (daysDiff === 1) {
        // Check if it's actually yesterday
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (startDate.toDateString() === yesterday.toDateString()) {
            document.querySelector('.period-btn[onclick*="yesterday"]')?.classList.add('active');
        }
    } else if (daysDiff === 7) {
        document.querySelector('.period-btn[onclick*="7d"]')?.classList.add('active');
    } else if (daysDiff === 14) {
        document.querySelector('.period-btn[onclick*="14d"]')?.classList.add('active');
    } else if (daysDiff === 30) {
        document.querySelector('.period-btn[onclick*="30d"]')?.classList.add('active');
    } else if (daysDiff === 90) {
        document.querySelector('.period-btn[onclick*="90d"]')?.classList.add('active');
    }
}

/**
 * Check API status and update indicator
 */
async function checkAPIStatus() {
    const statusLight = document.getElementById('statusLight');
    const statusText = document.getElementById('statusText');
    
    try {
        const response = await fetch('/api/test');
        if (response.ok) {
            const data = await response.json();
            // API is working - show simple ready state
            statusLight.style.background = '#00E87E';
            statusLight.style.animation = 'none';
            statusText.textContent = 'Ready';
            statusText.style.color = '#00E87E';
            console.log('API connection verified');
        } else {
            // API returned an error - but don't alarm the user
            statusLight.style.background = '#ffc107';
            statusLight.style.animation = 'none';
            statusText.textContent = 'Ready (Offline Mode)';
            statusText.style.color = '#ffc107';
        }
    } catch (error) {
        // Connection failed - will use simulated data
        statusLight.style.background = '#ffc107';
        statusLight.style.animation = 'none';
        statusText.textContent = 'Ready (Offline Mode)';
        statusText.style.color = '#ffc107';
        console.log('Will use simulated data if API unavailable');
    }
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
    // Reset the real data flag for new analysis
    hasRealDataInPeriod = false;
    
    const region = document.getElementById('region').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const numUnits = parseInt(document.getElementById('numUnits').value);
    const power = parseFloat(document.getElementById('power').value);
    const capacity = parseFloat(document.getElementById('capacity').value);
    const efficiency = parseFloat(document.getElementById('efficiency').value) / 100;
    const maxCycles = parseFloat(document.getElementById('maxCycles').value);
    const dataInterval = parseInt(document.getElementById('dataInterval').value);
    
    // Note: dataInterval is captured but not yet implemented in API calls
    // Future enhancement: Use 30-min data when dataInterval === 30
    
    if (new Date(startDate) > new Date(endDate)) {
        alert('Start date must be before end date');
        return;
    }
    
    document.getElementById('loading').classList.add('active');
    document.getElementById('error').classList.remove('active');
    document.getElementById('metrics').style.display = 'none';
    document.getElementById('navTabs').style.display = 'none';
    
    // Hide algorithm explainer during loading
    const explainer = document.getElementById('algorithmExplainer');
    if (explainer) {
        explainer.style.display = 'none';
    }
    
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
            
            let dayData;
            try {
                dayData = await fetchDayData(dateStr, region);
            } catch (fetchError) {
                console.error(`No data for ${dateStr}:`, fetchError);
                // Skip this day if no data available
                continue;
            }
            
            if (!dayData || dayData.length === 0) {
                console.error(`Empty data for ${dateStr}`);
                continue;
            }
            
            const optimizationMode = document.getElementById('optimizationMode').value;
            const throughputCost = parseFloat(document.getElementById('throughputCost').value) || 0;
            const siteMode = document.getElementById('siteMode').value;
            const tariffId = siteMode === 'BtM' ? document.getElementById('tariff').value : 'NONE';
            const tariff = TARIFFS[tariffId];
            
            let dayResult;
            if (optimizationMode === 'dp') {
                // Use Dynamic Programming optimizer
                dayResult = calculateDPArbitrage(
                    dayData,
                    efficiency,
                    maxCycles,
                    capacity * numUnits,
                    power * numUnits,
                    throughputCost,
                    tariff
                );
            } else {
                // Use heuristic method
                dayResult = calculateMultiCycleArbitrage(
                    dayData, 
                    efficiency, 
                    maxCycles, 
                    capacity * numUnits,
                    power * numUnits,
                    tariff
                );
            }
            
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
        
        // Show algorithm explainer after results with correct mode
        const explainer = document.getElementById('algorithmExplainer');
        if (explainer) {
            explainer.style.display = 'block';
            
            // Show the correct explanation based on optimization mode
            const optimizationMode = document.getElementById('optimizationMode').value;
            const dpExplanation = document.getElementById('dpExplanation');
            const heuristicExplanation = document.getElementById('heuristicExplanation');
            
            if (dpExplanation && heuristicExplanation) {
                if (optimizationMode === 'dp') {
                    dpExplanation.style.display = 'block';
                    heuristicExplanation.style.display = 'none';
                } else {
                    dpExplanation.style.display = 'none';
                    heuristicExplanation.style.display = 'block';
                }
            }
        }
        
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

// Track whether we've gotten real data for the analysis period
let hasRealDataInPeriod = false;

/**
 * Fetch day data from AEMO NEMWeb via Pages Functions
 */
async function fetchDayData(date, region) {
    try {
        console.log(`Fetching data for ${date} in ${region}`);
        
        // Use Pages Functions API endpoint
        const apiUrl = `/api/price?region=${region}&date=${date}`;
        
        try {
            const resp = await fetch(apiUrl);
            
            if (resp.ok) {
                const data = await resp.json();
                
                // Check if we got valid data from Worker
                if (data.success && data.data && data.data.length > 0) {
                    // Mark that we got real data if it's not simulation
                    if (data.source !== 'simulation') {
                        hasRealDataInPeriod = true;
                        
                        // Update the data source display with the real source
                        document.getElementById('dataSource').textContent = 
                            data.source === 'aemo-stored' ? '🟢 LIVE data from NEM Harvester (R2 Storage)' :
                            data.source === 'aemo-fresh' ? '🟢 Fresh data from NEM Harvester' :
                            data.source === 'opennem-live' ? '🟢 LIVE data from OpenNEM via Harvester' :
                            data.source === 'nem-harvester' ? '🟢 Data from NEM Harvester' :
                            data.source === 'aemo-nemweb' ? '🟢 LIVE data from AEMO NEMWeb' :
                            '🟢 Data from NEM Harvester';
                        document.getElementById('dataSource').style.display = 'block';
                    } else if (!hasRealDataInPeriod) {
                        // No simulation - show error if no real data
                        document.getElementById('dataSource').textContent = 
                            '❌ No data available';
                        document.getElementById('dataSource').style.display = 'block';
                        throw new Error('No real data available');
                    }
                    return data.data; // Return the intervals directly
                } else if (!data.success) {
                    console.error('API error:', data.error);
                    throw new Error(data.error || 'API failed');
                }
            }
        } catch (workerError) {
            console.log('Worker API failed:', workerError);
        }
        
    } catch (error) {
        console.error('Fetch failed:', error);
        // NO SIMULATION - throw error if no data
        if (!hasRealDataInPeriod) {
            document.getElementById('dataSource').textContent = 
                '❌ No data available - check harvester status';
        }
        throw new Error('No data available for ' + date);
    }
}

// NO SIMULATION - All fake data generation removed

/**
 * Calculate arbitrage using Dynamic Programming optimizer
 */
function calculateDPArbitrage(data, efficiency, maxCycles, totalCapacity, totalPower, throughputCost = 0, tariff = null) {
    // Track original prices and calculate network adjustments
    const originalPrices = data.map(d => d.price);
    let prices = [...originalPrices];
    
    // Calculate network charges for each interval
    const networkData = data.map((d, i) => {
        // FIXED: Use the stored time field (AEST) instead of timestamp conversion
        const period = tariff ? getTariffPeriod(d.timestamp || new Date(), tariff.windows, d.time) : 'offPeak';
        const importAdj = tariff ? cPerKwhToDollarPerMWh(tariff.energy_c_per_kwh.import[period]) : 0;
        const exportAdj = tariff ? cPerKwhToDollarPerMWh(tariff.energy_c_per_kwh.export[period]) : 0;
        
        return {
            period,
            importAdj,  // Cost added when charging (positive = cost)
            exportAdj   // Value adjustment when discharging (negative = credit)
        };
    });
    
    // Split efficiency into charge and discharge components
    // For round-trip efficiency η, we use √η for both charge and discharge
    const etaSingle = Math.sqrt(efficiency);
    
    // Calculate an implicit throughput cost to enforce max cycles
    // The throughput cost acts as a penalty on cycling
    let effectiveThroughputCost = throughputCost;
    
    // If user specified max cycles and no explicit throughput cost, 
    // we need to find the right throughput cost to achieve that cycle limit
    if (maxCycles > 0 && maxCycles < 4 && throughputCost === 0) {
        // Estimate the average price spread to scale the throughput cost
        const sortedPrices = [...prices].sort((a, b) => a - b);
        const lowQuartile = sortedPrices[Math.floor(prices.length * 0.25)];
        const highQuartile = sortedPrices[Math.floor(prices.length * 0.75)];
        const typicalSpread = (highQuartile - lowQuartile) * efficiency;
        
        // Set throughput cost to reduce cycling
        // Higher cost = fewer cycles
        // This formula is empirical - adjust based on testing
        effectiveThroughputCost = typicalSpread * (0.1 / maxCycles);
    }
    
    // Run DP optimizer
    const result = optimiseBESS_DP({
        prices,
        dtHours: 5/60,
        capacityMWh: totalCapacity,
        powerMW: totalPower,
        etaC: etaSingle,
        etaD: etaSingle,
        soc0: 0,  // Start empty
        socT: 0,  // End empty (can be adjusted)
        socSteps: 201,
        throughputCost: effectiveThroughputCost,
        maxCycles: maxCycles
    });
    
    // Convert flows to operations format expected by UI
    const operations = [];
    const socHistory = [];
    
    // Calculate revenue breakdown with network charges
    let wholesaleRevenue = 0;
    let networkCharges = 0;
    let standingCharge = 0;
    let demandCharges = 0;
    
    // Track peak demand in each period for demand charges
    const peakDemand = { solarSoak: 0, peak: 0, offPeak: 0 };
    
    result.flows.forEach((flow, idx) => {
        const interval = data[idx];
        const network = networkData[idx];
        let operation = 'neutral';
        let powerFlow = 0;
        
        if (flow.op === 'charge') {
            operation = 'charge';
            powerFlow = -flow.buyMWh / (5/60);  // Convert to MW
            wholesaleRevenue -= flow.buyMWh * originalPrices[idx];  // Wholesale cost
            networkCharges += flow.buyMWh * network.importAdj;  // Network import cost
            
            // Track peak demand for this period
            const powerMW = Math.abs(powerFlow);
            if (powerMW > peakDemand[network.period]) {
                peakDemand[network.period] = powerMW;
            }
        } else if (flow.op === 'discharge') {
            operation = 'discharge';
            powerFlow = flow.sellMWh / (5/60);  // Convert to MW
            wholesaleRevenue += flow.sellMWh * originalPrices[idx];  // Wholesale revenue
            networkCharges += flow.sellMWh * network.exportAdj;  // Network export (usually negative = credit)
        }
        
        operations.push({
            ...interval,
            soc: flow.socMWh,
            powerFlow: powerFlow,
            operation: operation,
            reservationCharge: result.reservation.charge[idx],
            reservationDischarge: result.reservation.discharge[idx],
            tariffPeriod: network.period
        });
        
        socHistory.push(flow.socMWh);
    });
    
    // Calculate standing charge (pro-rated per day)
    if (tariff && tariff.standing_per_year > 0) {
        standingCharge = tariff.standing_per_year / 365;
    }
    
    // Calculate demand charges ($/kVA/month)
    // NOTE: Demand charges are based on monthly peak, not daily
    // For single-day analysis, we show the monthly charge impact
    // In reality, this peak may be set by other days in the month
    if (tariff && tariff.demand_per_kva_month) {
        const powerFactor = 0.95;  // Assumed power factor
        Object.keys(peakDemand).forEach(period => {
            const peakKVA = (peakDemand[period] * 1000) / powerFactor;  // Convert MW to kVA
            const monthlyCharge = peakKVA * (tariff.demand_per_kva_month.import[period] || 0);
            // Show as indicative daily impact (1/30th) but note this is not how billing works
            demandCharges += monthlyCharge / 30;  // Indicative daily allocation
        });
    }
    
    // Check if we exceeded max cycles and need to recalculate
    if (result.cycles > maxCycles && throughputCost === 0) {
        // Increase throughput cost and recalculate
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const newThroughputCost = avgPrice * 0.05 * (result.cycles - maxCycles);
        
        // Recursively call with higher throughput cost
        return calculateDPArbitrage(data, efficiency, maxCycles, totalCapacity, totalPower, newThroughputCost);
    }
    
    // Report actual cycles, not the target
    const reportedCycles = result.cycles;
    
    // Calculate total revenue including all charges
    const totalRevenue = wholesaleRevenue - networkCharges - standingCharge - demandCharges;
    
    return {
        revenue: totalRevenue,  // Net revenue after all charges
        wholesaleRevenue: wholesaleRevenue,  // Wholesale only
        networkCharges: networkCharges,  // Network energy charges
        standingCharge: standingCharge,  // Daily standing charge
        demandCharges: demandCharges,  // Demand-based charges
        breakdown: {
            wholesale: wholesaleRevenue,
            network: -networkCharges,  // Negative because charges reduce revenue
            standing: -standingCharge,
            demand: -demandCharges,
            total: totalRevenue
        },
        cycles: reportedCycles,
        targetCycles: maxCycles,  // What we aimed for
        actualCycles: result.cycles,  // What we actually got
        avgSpread: result.avgSpread,
        avgChargePrice: result.avgChargePrice,
        avgDischargePrice: result.avgDischargePrice,
        energyTraded: result.energyTraded,
        operations: operations,
        socHistory: socHistory,
        efficiency: efficiency,
        reservation: result.reservation,
        dpOptimal: true,
        actualCycles: result.cycles,
        maxCyclesConstraint: maxCycles,
        tariff: tariff ? tariff.label : 'None'
    };
}

/**
 * Calculate multi-cycle arbitrage opportunities with improved algorithm
 */
function calculateMultiCycleArbitrage(data, efficiency, maxCycles, totalCapacity, totalPower, tariff = null) {
    const intervals = data.length;
    const timeStep = 5 / 60; // 5 minutes in hours
    
    // Initialize state
    let soc = 0;
    const socHistory = [];
    const operations = [];
    
    // Find and sort opportunities by profitability
    const opportunities = findBestArbitrageOpportunities(data, efficiency, maxCycles, totalCapacity, totalPower);
    
    // TODO: Validate feasibility of selected opportunities
    // Currently assumes opportunities don't overlap, but should verify:
    // - SoC constraints are satisfied throughout
    // - Power limits are respected
    // - Selected opportunities are mutually feasible
    
    // Execute the trading strategy
    let revenue = 0;
    let energyCharged = 0;
    let energyDischarged = 0;
    let totalCostOfCharging = 0;
    let totalRevenueFromDischarging = 0;
    
    // Track revenue breakdown for tariffs
    let wholesaleRevenue = 0;
    let networkCharges = 0;
    let standingCharge = 0;
    let demandCharges = 0;
    const peakDemand = { solarSoak: 0, peak: 0, offPeak: 0 };
    
    // Create operation schedule
    const schedule = new Array(intervals).fill('idle');
    for (const opp of opportunities) {
        for (let i = opp.chargeStart; i <= opp.chargeEnd; i++) {
            if (i < intervals) schedule[i] = 'charge';
        }
        for (let i = opp.dischargeStart; i <= opp.dischargeEnd; i++) {
            if (i < intervals) schedule[i] = 'discharge';
        }
    }
    
    // Simulate battery operation with FIXED efficiency accounting
    const etaSingle = Math.sqrt(efficiency);  // Split efficiency between charge and discharge
    
    for (let i = 0; i < intervals; i++) {
        let powerFlow = 0;
        const operation = schedule[i];
        
        // Get tariff period and network charges
        // FIXED: Use the stored time field (AEST) instead of timestamp conversion
        const period = tariff ? getTariffPeriod(data[i].timestamp || new Date(), tariff.windows, data[i].time) : 'offPeak';
        const importAdj = tariff ? cPerKwhToDollarPerMWh(tariff.energy_c_per_kwh.import[period]) : 0;
        const exportAdj = tariff ? cPerKwhToDollarPerMWh(tariff.energy_c_per_kwh.export[period]) : 0;
        
        if (operation === 'charge' && soc < totalCapacity) {
            // FIX: Charge with efficiency loss
            // Grid provides energy, battery receives less due to charge efficiency
            const maxChargeToBattery = totalPower * etaSingle * timeStep;
            const chargeAmount = Math.min(maxChargeToBattery, totalCapacity - soc);
            
            if (chargeAmount > 0.001) {
                soc += chargeAmount;
                const gridEnergy = chargeAmount / etaSingle;  // Energy from grid
                powerFlow = -totalPower;
                
                // Cost of charging (based on grid energy)
                const chargeCost = gridEnergy * data[i].price;
                revenue -= chargeCost;
                totalCostOfCharging += chargeCost;
                energyCharged += gridEnergy;  // Track grid-side energy
                
                // Track wholesale and network charges
                wholesaleRevenue -= chargeCost;  // Wholesale cost
                networkCharges += gridEnergy * importAdj;  // Network import cost
                
                // Track peak demand for this period
                const powerMW = Math.abs(powerFlow);
                if (powerMW > peakDemand[period]) {
                    peakDemand[period] = powerMW;
                }
            }
        } else if (operation === 'discharge' && soc > 0.001) {
            // FIX: Discharge with efficiency loss
            // Battery provides energy, grid receives less due to discharge efficiency
            const maxDischargeFromBattery = totalPower * timeStep;
            const dischargeAmount = Math.min(maxDischargeFromBattery, soc);
            
            if (dischargeAmount > 0.001) {
                soc -= dischargeAmount;
                const gridEnergy = dischargeAmount * etaSingle;  // Energy to grid
                powerFlow = totalPower;
                
                // Revenue from discharging (based on grid energy)
                const dischargeRevenue = gridEnergy * data[i].price;
                revenue += dischargeRevenue;
                totalRevenueFromDischarging += dischargeRevenue;
                energyDischarged += gridEnergy;  // Track grid-side energy
                
                // Track wholesale and network charges
                wholesaleRevenue += dischargeRevenue;  // Wholesale revenue
                networkCharges += gridEnergy * exportAdj;  // Network export (usually negative = credit)
            }
        }
        
        socHistory.push(soc);
        operations.push({
            ...data[i],
            soc: soc,
            powerFlow: powerFlow,
            operation: operation === 'idle' ? 'neutral' : operation,
            tariffPeriod: period
        });
    }
    
    // Calculate actual cycles (based on energy throughput)
    const actualCycles = energyCharged > 0 ? energyCharged / totalCapacity : 0;
    
    // Calculate weighted average prices
    let weightedChargePrice = 0;
    let weightedDischargePrice = 0;
    let totalChargeEnergy = 0;
    let totalDischargeEnergy = 0;
    
    for (let i = 0; i < operations.length; i++) {
        if (operations[i].operation === 'charge' && operations[i].powerFlow < 0) {
            // FIX: Track grid-side energy correctly
            const energy = Math.abs(operations[i].powerFlow) * timeStep;
            weightedChargePrice += operations[i].price * energy;
            totalChargeEnergy += energy;
        } else if (operations[i].operation === 'discharge' && operations[i].powerFlow > 0) {
            // FIX: Already accounts for efficiency in powerFlow
            const energy = operations[i].powerFlow * timeStep;
            weightedDischargePrice += operations[i].price * energy;
            totalDischargeEnergy += energy;
        }
    }
    
    const avgChargePrice = totalChargeEnergy > 0 ? weightedChargePrice / totalChargeEnergy : 0;
    const avgDischargePrice = totalDischargeEnergy > 0 ? weightedDischargePrice / totalDischargeEnergy : 0;
    
    // Calculate the effective spread (energy-weighted average)
    // This is the average selling price minus average buying price
    const effectiveSpread = avgDischargePrice - avgChargePrice;
    
    // Calculate standing charge (pro-rated per day)
    if (tariff && tariff.standing_per_year > 0) {
        standingCharge = tariff.standing_per_year / 365;
    }
    
    // Calculate demand charges ($/kVA/month)
    // NOTE: Demand charges are based on monthly peak, not daily
    // For single-day analysis, we show the monthly charge impact
    // In reality, this peak may be set by other days in the month
    if (tariff && tariff.demand_per_kva_month) {
        const powerFactor = 0.95;  // Assumed power factor
        Object.keys(peakDemand).forEach(period => {
            const peakKVA = (peakDemand[period] * 1000) / powerFactor;  // Convert MW to kVA
            const monthlyCharge = peakKVA * (tariff.demand_per_kva_month.import[period] || 0);
            // Show as indicative daily impact (1/30th) but note this is not how billing works
            demandCharges += monthlyCharge / 30;  // Indicative daily allocation
        });
    }
    
    // Calculate total revenue including all charges
    const totalRevenue = wholesaleRevenue - networkCharges - standingCharge - demandCharges;
    
    return {
        revenue: totalRevenue,  // Net revenue after all charges
        wholesaleRevenue: wholesaleRevenue,  // Wholesale only
        networkCharges: networkCharges,  // Network energy charges
        standingCharge: standingCharge,  // Daily standing charge
        demandCharges: demandCharges,  // Demand-based charges
        breakdown: {
            wholesale: wholesaleRevenue,
            network: -networkCharges,  // Negative because charges reduce revenue
            standing: -standingCharge,
            demand: -demandCharges,
            total: totalRevenue
        },
        cycles: actualCycles,
        avgSpread: effectiveSpread,  // This is the true profit margin per MWh
        avgChargePrice: avgChargePrice,
        avgDischargePrice: avgDischargePrice,
        energyTraded: energyCharged + energyDischarged,
        operations: operations,
        socHistory: socHistory,
        efficiency: efficiency,
        tariff: tariff ? tariff.label : 'None'
    };
}

/**
 * Find the best arbitrage opportunities for the day
 */
function findBestArbitrageOpportunities(data, efficiency, maxCycles, totalCapacity, totalPower) {
    const timeStep = 5 / 60;
    const intervalsNeeded = Math.ceil((totalCapacity / totalPower) / timeStep);
    const opportunities = [];
    
    // Find all potential charge/discharge windows
    const potentialOpportunities = [];
    
    // Look for good spread opportunities
    for (let chargeStart = 0; chargeStart < data.length - intervalsNeeded * 2; chargeStart++) {
        // Calculate average charge price for this window
        let chargeSum = 0;
        for (let i = 0; i < intervalsNeeded && chargeStart + i < data.length; i++) {
            chargeSum += data[chargeStart + i].price;
        }
        const avgChargePrice = chargeSum / intervalsNeeded;
        
        // Look for discharge window after charge completes
        const earliestDischarge = chargeStart + intervalsNeeded;
        
        for (let dischargeStart = earliestDischarge; dischargeStart < data.length - intervalsNeeded + 1; dischargeStart++) {
            // Calculate average discharge price for this window
            let dischargeSum = 0;
            for (let i = 0; i < intervalsNeeded && dischargeStart + i < data.length; i++) {
                dischargeSum += data[dischargeStart + i].price;
            }
            const avgDischargePrice = dischargeSum / intervalsNeeded;
            
            // Calculate profit accounting for efficiency
            const energyIn = totalCapacity;
            const energyOut = totalCapacity * efficiency;
            const cost = energyIn * avgChargePrice;
            const revenue = energyOut * avgDischargePrice;
            const profit = revenue - cost;
            const profitPerMWh = profit / totalCapacity;
            
            if (profit > 0) {
                potentialOpportunities.push({
                    chargeStart,
                    chargeEnd: chargeStart + intervalsNeeded - 1,
                    dischargeStart,
                    dischargeEnd: dischargeStart + intervalsNeeded - 1,
                    avgChargePrice,
                    avgDischargePrice,
                    profit,
                    profitPerMWh,
                    effectiveSpread: avgDischargePrice - (avgChargePrice / efficiency)
                });
            }
        }
    }
    
    // Sort by profit
    potentialOpportunities.sort((a, b) => b.profit - a.profit);
    
    // Select non-overlapping opportunities up to maxCycles
    const usedIntervals = new Set();
    
    for (const opp of potentialOpportunities) {
        if (opportunities.length >= maxCycles) break;
        
        // Check if intervals are available
        let available = true;
        for (let i = opp.chargeStart; i <= opp.chargeEnd; i++) {
            if (usedIntervals.has(i)) {
                available = false;
                break;
            }
        }
        if (available) {
            for (let i = opp.dischargeStart; i <= opp.dischargeEnd; i++) {
                if (usedIntervals.has(i)) {
                    available = false;
                    break;
                }
            }
        }
        
        if (available) {
            opportunities.push(opp);
            // Mark intervals as used
            for (let i = opp.chargeStart; i <= opp.chargeEnd; i++) {
                usedIntervals.add(i);
            }
            for (let i = opp.dischargeStart; i <= opp.dischargeEnd; i++) {
                usedIntervals.add(i);
            }
        }
    }
    
    // Sort selected opportunities by time
    opportunities.sort((a, b) => a.chargeStart - b.chargeStart);
    
    return opportunities;
}

/**
 * Update metrics display
 */
function updateMetrics(results) {
    // Calculate aggregated breakdown across all days
    let totalWholesale = 0;
    let totalNetwork = 0;
    let totalStanding = 0;
    let totalDemand = 0;
    
    if (results.dailyResults && results.dailyResults.length > 0) {
        results.dailyResults.forEach(day => {
            if (day.wholesaleRevenue !== undefined) {
                totalWholesale += day.wholesaleRevenue;
                totalNetwork += day.networkCharges || 0;
                totalStanding += day.standingCharge || 0;
                totalDemand += day.demandCharges || 0;
            } else {
                // Fallback for days without breakdown (older format)
                totalWholesale += day.revenue;
            }
        });
    }
    
    // Update main revenue metrics
    document.getElementById('totalRevenue').textContent = 
        '$' + results.totalRevenue.toLocaleString('en-AU', { maximumFractionDigits: 0 });
    
    // Update revenue breakdown
    const wholesaleElem = document.getElementById('wholesaleRevenue');
    const networkElem = document.getElementById('networkCharges');
    const standingElem = document.getElementById('standingCharges');
    const demandElem = document.getElementById('demandCharges');
    
    if (wholesaleElem) {
        wholesaleElem.textContent = '$' + totalWholesale.toLocaleString('en-AU', { maximumFractionDigits: 0 });
        wholesaleElem.style.color = totalWholesale > 0 ? '#00E87E' : '#ff4444';
    }
    
    if (networkElem) {
        networkElem.textContent = '$' + totalNetwork.toLocaleString('en-AU', { maximumFractionDigits: 0 });
        networkElem.style.color = totalNetwork > 0 ? '#ff4444' : '#00E87E';  // Usually a cost
    }
    
    if (standingElem) {
        standingElem.textContent = '$' + totalStanding.toLocaleString('en-AU', { maximumFractionDigits: 0 });
        standingElem.style.color = totalStanding > 0 ? '#ff4444' : '#999';  // Always a cost
    }
    
    if (demandElem) {
        demandElem.textContent = '$' + totalDemand.toLocaleString('en-AU', { maximumFractionDigits: 0 });
        demandElem.style.color = totalDemand > 0 ? '#ff4444' : '#999';  // Always a cost
    }
    
    // Update other metrics
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
    
    // Update active tariff display
    const tariffElem = document.getElementById('activeTariff');
    if (tariffElem) {
        const tariffId = document.getElementById('tariff').value;
        const tariff = TARIFFS[tariffId];
        if (tariff) {
            tariffElem.textContent = tariff.label;
            tariffElem.style.color = tariffId === 'NONE' ? '#999' : '#00E87E';
        }
    }
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
    
    // Update chart titles with date information
    const chartDate = dayResult.date || `Day ${dayIndex + 1}`;
    const priceTitle = document.querySelector('#priceChartContainer .chart-title span');
    
    if (priceTitle) {
        priceTitle.textContent = `Price, Operations & State of Charge - ${chartDate}`;
    }
    
    // Add navigation if multiple days
    if (analysisResults.dailyResults.length > 1) {
        addDayNavigation(dayIndex);
    }
    
    // Add daily revenue breakdown if tariff is active
    if (dayResult.breakdown) {
        addDailyRevenueBreakdown(dayResult);
    }
    
    updatePriceChart(dayResult);
    // SoC is now included in the price chart
    
    document.getElementById('priceChartContainer').style.display = 'block';
    // SoC chart container has been removed
}

function addDailyRevenueBreakdown(dayResult) {
    const container = document.getElementById('priceChartContainer');
    let breakdown = document.getElementById('dailyRevenueBreakdown');
    
    if (!breakdown) {
        breakdown = document.createElement('div');
        breakdown.id = 'dailyRevenueBreakdown';
        breakdown.style.cssText = `
            background: linear-gradient(135deg, rgba(0, 232, 126, 0.05), rgba(0, 232, 126, 0.1));
            border: 2px solid var(--greenwood-primary);
            border-radius: 10px;
            padding: 15px;
            margin: 20px 0;
            color: white;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        `;
        // Insert after title but before chart
        const chartWrapper = container.querySelector('.chart-wrapper');
        container.insertBefore(breakdown, chartWrapper);
    }
    
    // Format breakdown display
    let html = '';
    
    if (dayResult.breakdown) {
        html = `
            <div style="text-align: center;">
                <div style="font-size: 0.9rem; color: #999; margin-bottom: 5px;">Wholesale</div>
                <div style="font-size: 1.2rem; font-weight: bold; color: ${dayResult.breakdown.wholesale > 0 ? '#00E87E' : '#ff4444'};">
                    $${dayResult.breakdown.wholesale.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 0.9rem; color: #999; margin-bottom: 5px;">Network</div>
                <div style="font-size: 1.2rem; font-weight: bold; color: ${dayResult.breakdown.network < 0 ? '#ff4444' : '#00E87E'};">
                    $${dayResult.breakdown.network.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 0.9rem; color: #999; margin-bottom: 5px;">Standing</div>
                <div style="font-size: 1.2rem; font-weight: bold; color: ${dayResult.breakdown.standing < 0 ? '#ff4444' : '#999'};">
                    $${dayResult.breakdown.standing.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 0.9rem; color: #999; margin-bottom: 5px;">Demand</div>
                <div style="font-size: 1.2rem; font-weight: bold; color: ${dayResult.breakdown.demand < 0 ? '#ff4444' : '#999'};">
                    $${dayResult.breakdown.demand.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </div>
            </div>
            <div style="text-align: center; border-left: 2px solid #333; padding-left: 15px;">
                <div style="font-size: 0.9rem; color: #999; margin-bottom: 5px;">Net Revenue</div>
                <div style="font-size: 1.4rem; font-weight: bold; color: ${dayResult.breakdown.total > 0 ? '#00E87E' : '#ff4444'};">
                    $${dayResult.breakdown.total.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </div>
            </div>
        `;
    } else {
        // Simple display for no tariff
        html = `
            <div style="text-align: center; grid-column: 1 / -1;">
                <div style="font-size: 0.9rem; color: #999; margin-bottom: 5px;">Day Revenue (Wholesale Only)</div>
                <div style="font-size: 1.4rem; font-weight: bold; color: #00E87E;">
                    $${dayResult.revenue.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </div>
            </div>
        `;
    }
    
    breakdown.innerHTML = html;
}

function addDayNavigation(currentIndex) {
    const container = document.getElementById('priceChartContainer');
    let nav = document.getElementById('dayNavigation');
    
    if (!nav) {
        nav = document.createElement('div');
        nav.id = 'dayNavigation';
        nav.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 20px; margin: 20px 0; color: white;';
        container.insertBefore(nav, container.firstChild);
    }
    
    const totalDays = analysisResults.dailyResults.length;
    nav.innerHTML = `
        <button onclick="navigateDay(-1)" ${currentIndex === 0 ? 'disabled' : ''} 
                style="background: #00E87E; color: black; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; ${currentIndex === 0 ? 'opacity: 0.5;' : ''}">
            ← Previous
        </button>
        <span style="font-weight: bold; min-width: 150px; text-align: center;">
            Day ${currentIndex + 1} of ${totalDays}
        </span>
        <button onclick="navigateDay(1)" ${currentIndex === totalDays - 1 ? 'disabled' : ''}
                style="background: #00E87E; color: black; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; ${currentIndex === totalDays - 1 ? 'opacity: 0.5;' : ''}">
            Next →
        </button>
    `;
}

function navigateDay(direction) {
    const newIndex = currentDayIndex + direction;
    if (newIndex >= 0 && newIndex < analysisResults.dailyResults.length) {
        updateDailyView(newIndex);
    }
}

// Make navigateDay globally available
window.navigateDay = navigateDay;


/**
 * Update price chart
 */
function updatePriceChart(dayResult) {
    const ctx = document.getElementById('priceChart').getContext('2d');
    
    if (priceChart) priceChart.destroy();
    
    // Use all operations for complete day view
    const labels = dayResult.operations.map(op => op.time);
    const prices = dayResult.operations.map(op => op.price);
    
    // Calculate SoC percentage for the white line
    const socData = dayResult.socHistory;
    const maxCapacity = analysisResults.capacity * analysisResults.numUnits;
    const socPercentage = socData.map(soc => (soc / maxCapacity) * 100);
    
    const datasets = [{
        label: 'Market Price ($/MWh)',
        data: prices,
        borderColor: GREENWOOD_COLORS.primary,
        backgroundColor: `${GREENWOOD_COLORS.primary}20`,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        order: 1,
        yAxisID: 'y'
    }, {
        label: 'State of Charge (%)',
        data: socPercentage,
        borderColor: 'rgba(255, 255, 255, 0.8)',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.2,
        fill: false,
        order: 0,
        yAxisID: 'y1',
        borderDash: [5, 3]
    }];
    
    // Add reservation price bands if using DP optimization
    if (dayResult.dpOptimal && dayResult.reservation) {
        // Filter out invalid reservation prices and clamp to reasonable range
        const chargeThresholds = dayResult.operations.map(op => {
            const val = op.reservationCharge;
            if (!val || !isNaN(val)) {
                // Clamp to reasonable market price range
                return Math.max(-100, Math.min(500, val));
            }
            return null;
        });
        
        const dischargeThresholds = dayResult.operations.map(op => {
            const val = op.reservationDischarge;
            if (!val || !isNaN(val)) {
                // Clamp to reasonable market price range
                return Math.max(-100, Math.min(500, val));
            }
            return null;
        });
        
        // Only add if we have mostly valid data
        const validCharge = chargeThresholds.filter(v => v !== null).length;
        const validDischarge = dischargeThresholds.filter(v => v !== null).length;
        
        if (validCharge > chargeThresholds.length * 0.5) {
            datasets.push({
                label: 'Buy Below',
                data: chargeThresholds,
                borderColor: '#4A90E2',  // Solid blue color
                backgroundColor: 'transparent',
                borderWidth: 2.5,  // Thicker line
                borderDash: [8, 4],  // Longer dashes for better visibility
                pointRadius: 0,
                tension: 0.3,
                order: 2,
                spanGaps: true
            });
        }
        
        if (validDischarge > dischargeThresholds.length * 0.5) {
            datasets.push({
                label: 'Sell Above',
                data: dischargeThresholds,
                borderColor: '#E94B3C',  // Solid red color
                backgroundColor: 'transparent',
                borderWidth: 2.5,  // Thicker line
                borderDash: [8, 4],  // Longer dashes for better visibility
                pointRadius: 0,
                tension: 0.3,
                order: 2,
                spanGaps: true
            });
        }
    }
    
    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
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
                        // FIXED: Use actual data times instead of assuming array index alignment
                        callback: function(val, index) {
                            // Get the actual time from the data
                            if (index < labels.length) {
                                const dataTime = labels[index];
                                const [hour, minute] = dataTime.split(':');
                                // Only show labels on the hour (minute === '00')
                                return minute === '00' ? `${parseInt(hour)}:00` : '';
                            }
                            return '';
                        }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Price ($/MWh)'
                    },
                    beginAtZero: false,
                    suggestedMin: 0,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toFixed(0);
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'SoC (%)'
                    },
                    min: 0,
                    max: 100,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            }
        },
        plugins: [{
            beforeDraw: (chart) => {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;
                
                // Save context state
                ctx.save();
                
                dayResult.operations.forEach((op, index) => {
                    if (op.operation === 'charge' || op.operation === 'discharge') {
                        const x = xAxis.getPixelForValue(index);
                        // Make bands wider for better visibility (3x width)
                        const width = Math.max(3, (xAxis.width / dayResult.operations.length) * 3);
                        
                        if (op.operation === 'charge') {
                            ctx.fillStyle = 'rgba(0, 232, 126, 0.3)';
                        } else {
                            ctx.fillStyle = 'rgba(255, 107, 107, 0.3)';
                        }
                        
                        // Draw from top to bottom of chart area
                        ctx.fillRect(x - width/2, yAxis.top, width, yAxis.bottom - yAxis.top);
                    }
                });
                
                // Restore context state
                ctx.restore();
            }
        }]
    });
}

/**
 * Update State of Charge chart - REMOVED
 * SoC is now displayed as a white line in the price chart
 */
// function updateSoCChart(dayResult) {
//     Removed - SoC is now integrated into price chart
// }

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

// Fetch crypto prices
async function fetchCryptoPrices() {
    try {
        const response = await fetch('https://nem-harvester.eddie-37d.workers.dev/api/crypto-prices');
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.data) {
                cryptoPrices = data.data;
                console.log('Crypto prices fetched:', cryptoPrices);
            }
        }
    } catch (error) {
        console.log('Crypto prices unavailable');
    }
}

// Fetch live AEMO prices
async function fetchLivePrices() {
    const tickerInner = document.getElementById('tickerInner');
    const lastUpdateEl = document.getElementById('lastUpdate');
    
    if (!tickerInner) return;
    
    try {
        // Show loading only on first load
        if (!tickerInner.innerHTML || tickerInner.innerHTML.includes('Loading')) {
            tickerInner.innerHTML = '<span style="color: #00E87E;">Loading prices...</span>';
        }
        
        // Fetch AEMO and crypto prices in parallel
        const [aemoResponse] = await Promise.all([
            fetch('https://nem-harvester.eddie-37d.workers.dev/api/live-prices'),
            fetchCryptoPrices()
        ]);
        
        if (!aemoResponse.ok) {
            throw new Error(`HTTP ${aemoResponse.status}`);
        }
        
        const data = await aemoResponse.json();
        console.log('Live prices:', data);
        
        if (data.success && data.data) {
            const regions = Object.keys(data.data).sort();
            let tickerHTML = '';
            
            // Build ticker items for each region
            regions.forEach(region => {
                const regionData = data.data[region];
                const price = regionData.price || 0;
                const change = regionData.change || 0;
                const changePercent = regionData.changePercent || 0;
                const changeClass = change >= 0 ? 'up' : 'down';
                const arrow = change >= 0 ? '↑' : '↓';
                
                tickerHTML += `
                    <span class="ticker-item">
                        <span class="ticker-region">${region}</span>
                        <span class="ticker-price">$${price.toFixed(2)}</span>
                        <span class="ticker-change ${changeClass}">
                            ${arrow} ${Math.abs(changePercent).toFixed(1)}%
                        </span>
                    </span>`;
            });
            
            // Add crypto prices if available
            if (cryptoPrices) {
                if (cryptoPrices.BTC) {
                    const btcChange = cryptoPrices.BTC.change24h || 0;
                    const btcClass = btcChange >= 0 ? 'up' : 'down';
                    const btcArrow = btcChange >= 0 ? '↑' : '↓';
                    const btcPrice = cryptoPrices.BTC.price || 0;
                    
                    tickerHTML += `
                        <span class="ticker-item ticker-crypto">
                            <span class="ticker-region" style="color: #ffd700;">₿ BTC</span>
                            <span class="ticker-price" style="color: #ffd700;">
                                $${btcPrice > 1000 ? (btcPrice/1000).toFixed(1) + 'k' : btcPrice.toFixed(2)}
                            </span>
                            <span class="ticker-change ${btcClass}">
                                ${btcArrow} ${Math.abs(btcChange).toFixed(1)}%
                            </span>
                        </span>`;
                }
                
                if (cryptoPrices.LTC) {
                    const ltcChange = cryptoPrices.LTC.change24h || 0;
                    const ltcClass = ltcChange >= 0 ? 'up' : 'down';
                    const ltcArrow = ltcChange >= 0 ? '↑' : '↓';
                    const ltcPrice = cryptoPrices.LTC.price || 0;
                    
                    tickerHTML += `
                        <span class="ticker-item ticker-crypto">
                            <span class="ticker-region" style="color: #c0c0c0;">Ł LTC</span>
                            <span class="ticker-price" style="color: #c0c0c0;">
                                $${ltcPrice.toFixed(2)}
                            </span>
                            <span class="ticker-change ${ltcClass}">
                                ${ltcArrow} ${Math.abs(ltcChange).toFixed(1)}%
                            </span>
                        </span>`;
                }
            }
            
            // Triple content for seamless scrolling (no gaps)
            const separator = '<span style="margin: 0 15px; color: #666;">•</span>';
            tickerInner.innerHTML = tickerHTML + separator + tickerHTML + separator + tickerHTML;
            
            // Update timestamp
            if (lastUpdateEl) {
                const now = new Date();
                lastUpdateEl.textContent = now.toLocaleTimeString('en-AU', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
            }
        }
    } catch (error) {
        console.error('Error fetching live prices:', error);
        if (!tickerInner.innerHTML || tickerInner.innerHTML.includes('Loading')) {
            tickerInner.innerHTML = '<span style="color: #ff6b6b;">Prices temporarily unavailable</span>';
        }
    }
}

// Initialize ticker
function initializeTicker() {
    // Start fetching immediately
    fetchLivePrices();
    
    // Update every 60 seconds
    setInterval(fetchLivePrices, 60000);
}

// Site mode change handler and optimization mode handler - moved to main DOMContentLoaded
function initializeSiteModeHandlers() {
    const siteModeSelect = document.getElementById('siteMode');
    const tariffSelect = document.getElementById('tariff');
    const optimizationMode = document.getElementById('optimizationMode');
    const maxCyclesInput = document.getElementById('maxCycles');
    const throughputCostInput = document.getElementById('throughputCost');
    
    if (siteModeSelect && tariffSelect) {
        siteModeSelect.addEventListener('change', function() {
            if (this.value === 'FoM') {
                // Front-of-meter: disable tariff and set to NONE
                tariffSelect.disabled = true;
                tariffSelect.value = 'NONE';
            } else {
                // Behind-the-meter: enable tariff selection
                tariffSelect.disabled = false;
            }
        });
    }
    
    if (optimizationMode && maxCyclesInput) {
        optimizationMode.addEventListener('change', function() {
            if (this.value === 'dp') {
                // DP mode: disable max cycles (it finds optimal automatically)
                maxCyclesInput.disabled = true;
                maxCyclesInput.title = 'Dynamic Programming finds optimal cycles automatically';
                // Show throughput cost as the way to influence cycles
                if (throughputCostInput) {
                    throughputCostInput.title = 'Use degradation cost to reduce cycling (higher cost = fewer cycles)';
                }
            } else {
                // Heuristic mode: enable max cycles constraint
                maxCyclesInput.disabled = false;
                maxCyclesInput.title = 'Maximum cycles per day constraint for heuristic optimizer';
                if (throughputCostInput) {
                    throughputCostInput.title = 'Cost per MWh of battery throughput to account for degradation';
                }
            }
        });
        
        // Trigger initial state
        optimizationMode.dispatchEvent(new Event('change'));
    }
}
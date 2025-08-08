/**
 * Improved BESS Arbitrage Calculation
 * This implements a more realistic arbitrage strategy
 */

function calculateImprovedArbitrage(data, efficiency, maxCycles, totalCapacity, totalPower) {
    const intervals = data.length;
    const timeStep = 5 / 60; // 5 minutes in hours
    
    // Initialize state
    let soc = 0;
    const socHistory = [];
    const operations = [];
    
    // Calculate how many intervals needed for a full charge/discharge
    const hoursForFullCharge = totalCapacity / totalPower;
    const intervalsForFullCharge = Math.ceil(hoursForFullCharge / timeStep);
    
    // Find profitable arbitrage opportunities
    const opportunities = findArbitrageOpportunities(data, efficiency, intervalsForFullCharge, maxCycles);
    
    // Execute the trading strategy
    let revenue = 0;
    let energyCharged = 0;
    let energyDischarged = 0;
    let totalCostOfCharging = 0;
    let totalRevenueFromDischarging = 0;
    
    for (let i = 0; i < intervals; i++) {
        let powerFlow = 0;
        let operation = 'idle';
        
        // Check if this interval is part of an opportunity
        const opp = opportunities.find(o => 
            (i >= o.chargeStart && i < o.chargeEnd) || 
            (i >= o.dischargeStart && i < o.dischargeEnd)
        );
        
        if (opp) {
            if (i >= opp.chargeStart && i < opp.chargeEnd) {
                // Charging
                const chargeAmount = Math.min(
                    totalPower * timeStep,
                    totalCapacity - soc
                );
                
                if (chargeAmount > 0) {
                    soc += chargeAmount;
                    powerFlow = -totalPower;
                    operation = 'charge';
                    
                    // Cost of charging
                    const chargeCost = chargeAmount * data[i].price;
                    revenue -= chargeCost;
                    totalCostOfCharging += chargeCost;
                    energyCharged += chargeAmount;
                }
            } else if (i >= opp.dischargeStart && i < opp.dischargeEnd) {
                // Discharging
                const maxDischarge = totalPower * timeStep;
                const availableEnergy = soc;
                const dischargeAmount = Math.min(maxDischarge, availableEnergy);
                
                if (dischargeAmount > 0) {
                    // Apply efficiency to the energy actually delivered
                    const deliveredEnergy = dischargeAmount * efficiency;
                    soc -= dischargeAmount;
                    powerFlow = totalPower;
                    operation = 'discharge';
                    
                    // Revenue from discharging (sell the delivered energy)
                    const dischargeRevenue = deliveredEnergy * data[i].price;
                    revenue += dischargeRevenue;
                    totalRevenueFromDischarging += dischargeRevenue;
                    energyDischarged += deliveredEnergy;
                }
            }
        }
        
        socHistory.push(soc);
        operations.push({
            ...data[i],
            soc: soc,
            powerFlow: powerFlow,
            operation: operation
        });
    }
    
    // Calculate actual cycles (based on energy throughput)
    const actualCycles = Math.min(energyCharged, energyDischarged / efficiency) / totalCapacity;
    
    // Calculate weighted average prices
    let weightedChargePrice = 0;
    let weightedDischargePrice = 0;
    let totalChargeEnergy = 0;
    let totalDischargeEnergy = 0;
    
    for (let i = 0; i < operations.length; i++) {
        if (operations[i].operation === 'charge') {
            const energy = Math.abs(operations[i].powerFlow) * timeStep;
            weightedChargePrice += operations[i].price * energy;
            totalChargeEnergy += energy;
        } else if (operations[i].operation === 'discharge') {
            const energy = operations[i].powerFlow * timeStep * efficiency;
            weightedDischargePrice += operations[i].price * energy;
            totalDischargeEnergy += energy;
        }
    }
    
    const avgChargePrice = totalChargeEnergy > 0 ? weightedChargePrice / totalChargeEnergy : 0;
    const avgDischargePrice = totalDischargeEnergy > 0 ? weightedDischargePrice / totalDischargeEnergy : 0;
    
    // Calculate the effective spread (accounting for efficiency)
    const effectiveSpread = avgDischargePrice - (avgChargePrice / efficiency);
    
    return {
        revenue: revenue,
        cycles: actualCycles,
        avgSpread: effectiveSpread,
        avgChargePrice: avgChargePrice,
        avgDischargePrice: avgDischargePrice,
        energyTraded: energyCharged + energyDischarged,
        operations: operations,
        socHistory: socHistory,
        totalCostOfCharging: totalCostOfCharging,
        totalRevenueFromDischarging: totalRevenueFromDischarging,
        efficiency: efficiency,
        profitMargin: revenue > 0 ? (revenue / Math.abs(totalCostOfCharging)) * 100 : 0
    };
}

/**
 * Find profitable arbitrage opportunities using a peak/trough detection algorithm
 */
function findArbitrageOpportunities(data, efficiency, intervalsNeeded, maxCycles) {
    const opportunities = [];
    
    // Find price troughs (for charging) and peaks (for discharging)
    const priceTroughs = [];
    const pricePeaks = [];
    
    for (let i = 1; i < data.length - 1; i++) {
        const prev = data[i - 1].price;
        const curr = data[i].price;
        const next = data[i + 1].price;
        
        // Local minimum (trough)
        if (curr <= prev && curr <= next) {
            priceTroughs.push({ index: i, price: curr });
        }
        
        // Local maximum (peak)
        if (curr >= prev && curr >= next) {
            pricePeaks.push({ index: i, price: curr });
        }
    }
    
    // Sort troughs by price (ascending) and peaks by price (descending)
    priceTroughs.sort((a, b) => a.price - b.price);
    pricePeaks.sort((a, b) => b.price - a.price);
    
    // Create opportunities by pairing troughs with subsequent peaks
    let cyclesCreated = 0;
    const usedIntervals = new Set();
    
    for (const trough of priceTroughs) {
        if (cyclesCreated >= maxCycles) break;
        
        // Find the best peak after this trough
        for (const peak of pricePeaks) {
            if (peak.index > trough.index + intervalsNeeded) {
                // Check if the spread is profitable after efficiency
                const grossSpread = peak.price - trough.price;
                const netSpread = peak.price * efficiency - trough.price;
                
                if (netSpread > 0) {
                    // Check if intervals are available
                    const chargeStart = trough.index;
                    const chargeEnd = Math.min(trough.index + intervalsNeeded, data.length);
                    const dischargeStart = peak.index;
                    const dischargeEnd = Math.min(peak.index + intervalsNeeded, data.length);
                    
                    let intervalsAvailable = true;
                    for (let i = chargeStart; i < chargeEnd; i++) {
                        if (usedIntervals.has(i)) {
                            intervalsAvailable = false;
                            break;
                        }
                    }
                    for (let i = dischargeStart; i < dischargeEnd; i++) {
                        if (usedIntervals.has(i)) {
                            intervalsAvailable = false;
                            break;
                        }
                    }
                    
                    if (intervalsAvailable) {
                        opportunities.push({
                            chargeStart,
                            chargeEnd,
                            dischargeStart,
                            dischargeEnd,
                            chargePrice: trough.price,
                            dischargePrice: peak.price,
                            grossSpread,
                            netSpread
                        });
                        
                        // Mark intervals as used
                        for (let i = chargeStart; i < chargeEnd; i++) {
                            usedIntervals.add(i);
                        }
                        for (let i = dischargeStart; i < dischargeEnd; i++) {
                            usedIntervals.add(i);
                        }
                        
                        cyclesCreated++;
                        break;
                    }
                }
            }
        }
    }
    
    // Sort opportunities by time
    opportunities.sort((a, b) => a.chargeStart - b.chargeStart);
    
    return opportunities;
}

// Export the improved function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = calculateImprovedArbitrage;
}
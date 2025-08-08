/**
 * Deterministic optimal arbitrage via Dynamic Programming.
 * Prices are 5-min spot ($/MWh). All energy vars are MWh per interval.
 * 
 * This is a proper optimal control solution that finds the globally optimal
 * charge/discharge schedule for a given price series.
 */
function optimiseBESS_DP({
  prices,                 // array of numbers $/MWh
  dtHours = 5/60,         // 5-minute interval
  capacityMWh,            // total usable capacity
  powerMW,                // charge/discharge power limit (symmetrical)
  etaC = 0.97,            // charge efficiency
  etaD = 0.97,            // discharge efficiency
  soc0 = 0.5,             // initial SoC as fraction of capacity (0..1)
  socT = 0.5,             // terminal SoC fraction (use soc0 for neutrality)
  socSteps = 201,         // number of discrete SoC levels
  throughputCost = 0.0    // $ per MWh of battery-side throughput (degradation)
}) {
  const T = prices.length;
  const E = capacityMWh;
  const dE = E / (socSteps - 1);                    // SoC step (MWh)
  const idxFromSoC = s => Math.max(0, Math.min(socSteps-1, Math.round(s/dE)));
  const socFromIdx = i => i * dE;

  // Power → max SoC change per step
  const maxChargeSoC = etaC * powerMW * dtHours;    // MWh added to SoC
  const maxDischSoC  = powerMW * dtHours;           // MWh removed from SoC
  const maxChargeK   = Math.max(1, Math.floor(maxChargeSoC / dE));
  const maxDischK    = Math.max(1, Math.floor(maxDischSoC  / dE));

  // Value function and policy
  const V = Array.from({ length: T + 1 }, () => new Float64Array(socSteps).fill(-1e15));
  const action = Array.from({ length: T }, () => new Int16Array(socSteps).fill(0)); // delta in "SoC steps" per interval

  // Terminal condition: enforce end SoC
  const endIdx = idxFromSoC(E * socT);
  V[T][endIdx] = 0.0;

  // Backward DP
  for (let t = T - 1; t >= 0; t--) {
    const p = prices[t];
    for (let i = 0; i < socSteps; i++) {
      const soc = socFromIdx(i);

      let bestVal = -1e15;
      let bestK = 0;

      // allowed change in SoC this step: k * dE, with bounds
      const kChargeMax = Math.min(maxChargeK, Math.floor((E - soc) / dE));
      const kDischMax  = Math.min(maxDischK, Math.floor(soc / dE));

      // iterate discharge (negative k), hold (0), charge (positive k)
      for (let k = -kDischMax; k <= kChargeMax; k++) {
        const socNextIdx = i + k;
        const socNextVal = V[t + 1][socNextIdx];
        if (socNextVal <= -1e14) continue; // infeasible terminal path

        let reward = 0.0;
        if (k > 0) {
          // CHARGE: SoC increases by k*dE; grid energy = (k*dE)/etaC
          const gridIn = (k * dE) / etaC;
          const thr    = k * dE; // battery-side throughput
          reward -= p * gridIn;
          reward -= throughputCost * thr;
        } else if (k < 0) {
          // DISCHARGE: SoC decreases by |k|*dE; energy sold = etaD * |k|*dE
          const battOut = (-k) * dE;
          const sold    = etaD * battOut;
          const thr     = battOut; // battery-side throughput
          reward += p * sold;
          reward -= throughputCost * thr;
        }

        const val = reward + socNextVal;
        if (val > bestVal) {
          bestVal = val;
          bestK = k;
        }
      }

      V[t][i] = bestVal;
      action[t][i] = bestK;
    }
  }

  // Forward simulate optimal schedule from soc0
  const socSeries = new Float64Array(T + 1);
  socSeries[0] = Math.min(E, Math.max(0, E * soc0));
  const flows = []; // per-interval results
  let revenue = 0.0;
  let throughput = 0.0;
  let energyCharged = 0.0;
  let energyDischarged = 0.0;

  for (let t = 0; t < T; t++) {
    const i = idxFromSoC(socSeries[t]);
    const k = action[t][i];
    const dSoC = k * dE;

    let op = 'hold';
    let buyMWh = 0, sellMWh = 0, cash = 0;

    if (k > 0) {
      buyMWh = dSoC / etaC;                 // grid energy bought
      cash   = -prices[t] * buyMWh - throughputCost * dSoC;
      op = 'charge';
      energyCharged += buyMWh;
    } else if (k < 0) {
      const battOut = -dSoC;                // battery-side energy
      sellMWh = etaD * battOut;             // energy sold to grid
      cash    =  prices[t] * sellMWh - throughputCost * battOut;
      op = 'discharge';
      energyDischarged += sellMWh;
    }

    revenue   += cash;
    throughput+= Math.abs(dSoC);
    socSeries[t + 1] = socSeries[t] + dSoC;

    flows.push({
      t,
      price: prices[t],
      op,
      socMWh: socSeries[t + 1],
      buyMWh,
      sellMWh,
      cash,
      socFraction: socSeries[t + 1] / E
    });
  }

  // Reservation (best) prices from marginal values
  // m(t, i) ≈ [V(t+1, i+1) - V(t+1, i)] / dE
  const chargeThresh = new Float64Array(T);    // price to start charging at 50% SoC (example)
  const dischargeThresh = new Float64Array(T);
  const midIdx = Math.floor((socSteps - 1) / 2);

  for (let t = 0; t < T; t++) {
    const vNext = V[t + 1];
    const i = midIdx;
    const m = (i < socSteps - 1 ? (vNext[i + 1] - vNext[i]) : (vNext[i] - vNext[i - 1])) / dE;
    // price bands
    chargeThresh[t]    = etaC * m - throughputCost;    // buy if price <= this
    dischargeThresh[t] = (m + throughputCost) / etaD;  // sell if price >= this
  }

  // Calculate cycles
  const cycles = throughput / (2 * E);

  // Calculate average prices (weighted by energy)
  let weightedChargePrice = 0;
  let weightedDischargePrice = 0;
  
  flows.forEach(f => {
    if (f.buyMWh > 0) {
      weightedChargePrice += f.price * f.buyMWh;
    }
    if (f.sellMWh > 0) {
      weightedDischargePrice += f.price * f.sellMWh;
    }
  });
  
  const avgChargePrice = energyCharged > 0 ? weightedChargePrice / energyCharged : 0;
  const avgDischargePrice = energyDischarged > 0 ? weightedDischargePrice / energyDischarged : 0;
  const effectiveSpread = avgDischargePrice - avgChargePrice;

  return {
    revenue,
    cycles,
    socSeries: Array.from(socSeries),
    flows,
    value0: V[0][idxFromSoC(socSeries[0])],
    reservation: {
      charge: Array.from(chargeThresh),
      discharge: Array.from(dischargeThresh)
    },
    energyCharged,
    energyDischarged,
    energyTraded: energyCharged + energyDischarged,
    avgChargePrice,
    avgDischargePrice,
    avgSpread: effectiveSpread,
    throughput,
    settings: { dtHours, capacityMWh: E, powerMW, etaC, etaD, soc0, socT, socSteps, throughputCost },
    notes: 'DP optimum for given price path; reservation prices are mid-SoC thresholds.'
  };
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = optimiseBESS_DP;
}
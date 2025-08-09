/**
 * Performance Metrics Calculator
 * Compares strategy performance against benchmarks
 */

export interface Metrics {
  // Financial metrics
  totalRevenue: number;
  dailyAvgRevenue: number;
  annualizedRevenue: number;
  revenueVsBenchmark: number; // percentage
  
  // Operational metrics
  totalCycles: number;
  dailyAvgCycles: number;
  capacityUtilization: number; // percentage
  roundTripEfficiency: number;
  
  // Risk metrics
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number; // percentage of profitable intervals
  
  // Spread metrics
  avgChargePrice: number;
  avgDischargePrice: number;
  realizedSpread: number;
  capturedSpread: number; // vs theoretical maximum
  
  // Statistical metrics
  dailyVolatility: number;
  bestDay: { date: string; revenue: number };
  worstDay: { date: string; revenue: number };
  
  // Efficiency metrics
  perfectHindsightCapture: number; // percentage
  implementationShortfall: number; // $ lost to constraints
}

export function calculateMetrics(
  strategyResult: any,
  benchmarkResult: any,
  days?: number
): Metrics {
  const schedule = strategyResult.schedule || [];
  const numDays = days || Math.ceil(schedule.length / 288);
  
  // Calculate daily revenues
  const dailyRevenues = new Map<string, number>();
  let cumulativeRevenue = 0;
  const revenueHistory: number[] = [];
  
  schedule.forEach((entry: any) => {
    const date = entry.timestamp.split('T')[0];
    const current = dailyRevenues.get(date) || 0;
    dailyRevenues.set(date, current + entry.revenue);
    cumulativeRevenue += entry.revenue;
    revenueHistory.push(cumulativeRevenue);
  });
  
  // Find best and worst days
  let bestDay = { date: '', revenue: -Infinity };
  let worstDay = { date: '', revenue: Infinity };
  
  dailyRevenues.forEach((revenue, date) => {
    if (revenue > bestDay.revenue) {
      bestDay = { date, revenue };
    }
    if (revenue < worstDay.revenue) {
      worstDay = { date, revenue };
    }
  });
  
  // Calculate drawdown
  let maxDrawdown = 0;
  let peak = -Infinity;
  
  for (const value of revenueHistory) {
    if (value > peak) {
      peak = value;
    }
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  // Calculate price metrics
  let totalChargePrice = 0;
  let totalChargeEnergy = 0;
  let totalDischargePrice = 0;
  let totalDischargeEnergy = 0;
  let winningIntervals = 0;
  
  schedule.forEach((entry: any) => {
    if (entry.action === 'charge' && entry.powerMW < 0) {
      const energy = Math.abs(entry.powerMW) * (5/60);
      totalChargePrice += entry.price * energy;
      totalChargeEnergy += energy;
    } else if (entry.action === 'discharge' && entry.powerMW > 0) {
      const energy = entry.powerMW * (5/60);
      totalDischargePrice += entry.price * energy;
      totalDischargeEnergy += energy;
    }
    
    if (entry.revenue > 0) {
      winningIntervals++;
    }
  });
  
  const avgChargePrice = totalChargeEnergy > 0 ? totalChargePrice / totalChargeEnergy : 0;
  const avgDischargePrice = totalDischargeEnergy > 0 ? totalDischargePrice / totalDischargeEnergy : 0;
  const realizedSpread = avgDischargePrice - avgChargePrice;
  
  // Calculate daily volatility
  const dailyRevenueArray = Array.from(dailyRevenues.values());
  const avgDailyRevenue = strategyResult.revenue / numDays;
  const variance = dailyRevenueArray.reduce((sum, rev) => {
    return sum + Math.pow(rev - avgDailyRevenue, 2);
  }, 0) / dailyRevenueArray.length;
  const dailyVolatility = Math.sqrt(variance);
  
  // Calculate Sharpe ratio (simplified - assuming risk-free rate = 0)
  const sharpeRatio = avgDailyRevenue / (dailyVolatility || 1);
  
  // Compare to benchmark
  const revenueVsBenchmark = benchmarkResult.revenue > 0 
    ? (strategyResult.revenue / benchmarkResult.revenue - 1) * 100 
    : 0;
  
  const perfectHindsightCapture = benchmarkResult.revenue > 0
    ? (strategyResult.revenue / benchmarkResult.revenue) * 100
    : 0;
  
  const implementationShortfall = benchmarkResult.revenue - strategyResult.revenue;
  
  // Calculate capacity utilization
  const theoreticalMaxCycles = numDays * 4; // Theoretical max ~4 cycles/day
  const capacityUtilization = (strategyResult.cycles / theoreticalMaxCycles) * 100;
  
  return {
    // Financial metrics
    totalRevenue: strategyResult.revenue,
    dailyAvgRevenue: avgDailyRevenue,
    annualizedRevenue: avgDailyRevenue * 365,
    revenueVsBenchmark,
    
    // Operational metrics
    totalCycles: strategyResult.cycles,
    dailyAvgCycles: strategyResult.cycles / numDays,
    capacityUtilization,
    roundTripEfficiency: strategyResult.battery?.efficiency || 0.9,
    
    // Risk metrics
    maxDrawdown: maxDrawdown * 100,
    sharpeRatio,
    winRate: (winningIntervals / schedule.length) * 100,
    
    // Spread metrics
    avgChargePrice,
    avgDischargePrice,
    realizedSpread,
    capturedSpread: 0, // Would need theoretical max spread
    
    // Statistical metrics
    dailyVolatility,
    bestDay,
    worstDay,
    
    // Efficiency metrics
    perfectHindsightCapture,
    implementationShortfall
  };
}

/**
 * Calculate rolling metrics for live tracking
 */
export function calculateRollingMetrics(
  schedule: any[],
  windowSize: number = 288 // Default 1 day
): any {
  const metrics: any[] = [];
  
  for (let i = windowSize; i <= schedule.length; i++) {
    const window = schedule.slice(i - windowSize, i);
    
    const revenue = window.reduce((sum, e) => sum + e.revenue, 0);
    const cycles = window.reduce((sum, e) => {
      if (e.action !== 'hold') {
        return sum + Math.abs(e.powerMW) * (5/60) / (2 * e.battery.capacityMWh);
      }
      return sum;
    }, 0);
    
    metrics.push({
      timestamp: window[window.length - 1].timestamp,
      revenue,
      cycles,
      avgPrice: window.reduce((sum, e) => sum + e.price, 0) / window.length
    });
  }
  
  return metrics;
}

/**
 * Generate performance report
 */
export function generateReport(metrics: Metrics): string {
  return `
=== Performance Report ===

Financial Performance:
  Total Revenue: $${metrics.totalRevenue.toFixed(2)}
  Daily Average: $${metrics.dailyAvgRevenue.toFixed(2)}
  Annualized: $${metrics.annualizedRevenue.toFixed(2)}
  vs Benchmark: ${metrics.revenueVsBenchmark > 0 ? '+' : ''}${metrics.revenueVsBenchmark.toFixed(1)}%

Operational Metrics:
  Total Cycles: ${metrics.totalCycles.toFixed(2)}
  Daily Average: ${metrics.dailyAvgCycles.toFixed(2)}
  Capacity Utilization: ${metrics.capacityUtilization.toFixed(1)}%

Risk Metrics:
  Max Drawdown: ${metrics.maxDrawdown.toFixed(1)}%
  Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}
  Win Rate: ${metrics.winRate.toFixed(1)}%

Trading Performance:
  Avg Charge Price: $${metrics.avgChargePrice.toFixed(2)}/MWh
  Avg Discharge Price: $${metrics.avgDischargePrice.toFixed(2)}/MWh
  Realized Spread: $${metrics.realizedSpread.toFixed(2)}/MWh

Best Day: ${metrics.bestDay.date} ($${metrics.bestDay.revenue.toFixed(2)})
Worst Day: ${metrics.worstDay.date} ($${metrics.worstDay.revenue.toFixed(2)})

Perfect Hindsight Capture: ${metrics.perfectHindsightCapture.toFixed(1)}%
Implementation Shortfall: $${metrics.implementationShortfall.toFixed(2)}
  `.trim();
}
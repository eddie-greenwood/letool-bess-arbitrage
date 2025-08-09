/**
 * Trading Strategy Library
 * Each strategy implements a different approach to BESS arbitrage
 */

export interface Strategy {
  id: string;
  name: string;
  description: string;
  params: StrategyParam[];
  run: (data: any[], battery: any, params: any) => Promise<StrategyResult>;
}

export interface StrategyParam {
  name: string;
  type: 'number' | 'boolean' | 'select';
  default: any;
  min?: number;
  max?: number;
  options?: any[];
  description: string;
}

export interface StrategyResult {
  revenue: number;
  cycles: number;
  energyTraded: number;
  schedule: ScheduleEntry[];
  metrics: Record<string, number>;
}

export interface ScheduleEntry {
  timestamp: string;
  action: 'charge' | 'discharge' | 'hold';
  powerMW: number;
  soc: number;
  price: number;
  revenue: number;
}

// Simple threshold-based strategy
const thresholdStrategy: Strategy = {
  id: 'threshold',
  name: 'Price Threshold',
  description: 'Charge below threshold, discharge above threshold',
  params: [
    {
      name: 'chargeThreshold',
      type: 'number',
      default: 30,
      min: -1000,
      max: 1000,
      description: 'Price below which to charge ($/MWh)'
    },
    {
      name: 'dischargeThreshold',
      type: 'number',
      default: 80,
      min: -1000,
      max: 1000,
      description: 'Price above which to discharge ($/MWh)'
    }
  ],
  async run(data, battery, params) {
    const schedule: ScheduleEntry[] = [];
    let soc = 0;
    let revenue = 0;
    let cycles = 0;
    let energyTraded = 0;
    
    const maxCharge = battery.powerMW * (5/60); // MWh per interval
    const maxDischarge = battery.powerMW * (5/60);
    const efficiency = Math.sqrt(battery.efficiency);
    
    for (const interval of data) {
      let action: 'charge' | 'discharge' | 'hold' = 'hold';
      let powerMW = 0;
      let intervalRevenue = 0;
      
      if (interval.price <= params.chargeThreshold && soc < battery.capacityMWh) {
        // Charge
        const chargeAmount = Math.min(maxCharge, battery.capacityMWh - soc);
        const gridEnergy = chargeAmount / efficiency;
        
        action = 'charge';
        powerMW = -chargeAmount / (5/60);
        soc += chargeAmount;
        intervalRevenue = -interval.price * gridEnergy;
        energyTraded += gridEnergy;
        cycles += chargeAmount / (2 * battery.capacityMWh);
        
      } else if (interval.price >= params.dischargeThreshold && soc > 0) {
        // Discharge
        const dischargeAmount = Math.min(maxDischarge, soc);
        const gridEnergy = dischargeAmount * efficiency;
        
        action = 'discharge';
        powerMW = dischargeAmount / (5/60);
        soc -= dischargeAmount;
        intervalRevenue = interval.price * gridEnergy;
        energyTraded += gridEnergy;
        cycles += dischargeAmount / (2 * battery.capacityMWh);
      }
      
      revenue += intervalRevenue;
      
      schedule.push({
        timestamp: interval.timestamp,
        action,
        powerMW,
        soc,
        price: interval.price,
        revenue: intervalRevenue
      });
    }
    
    return {
      revenue,
      cycles,
      energyTraded,
      schedule,
      metrics: {
        avgChargePrice: 0, // Calculate from schedule
        avgDischargePrice: 0,
        utilizationPercent: (cycles * 2 * battery.capacityMWh) / (battery.capacityMWh * data.length / 288) * 100
      }
    };
  }
};

// Moving average spread strategy
const spreadStrategy: Strategy = {
  id: 'spread',
  name: 'Moving Average Spread',
  description: 'Trade based on price deviation from moving average',
  params: [
    {
      name: 'windowSize',
      type: 'number',
      default: 24,
      min: 6,
      max: 288,
      description: 'Moving average window (intervals)'
    },
    {
      name: 'spreadMultiplier',
      type: 'number',
      default: 1.5,
      min: 0.5,
      max: 3,
      description: 'Standard deviation multiplier for signals'
    }
  ],
  async run(data, battery, params) {
    const schedule: ScheduleEntry[] = [];
    let soc = battery.capacityMWh * 0.5; // Start at 50%
    let revenue = 0;
    let cycles = 0;
    let energyTraded = 0;
    
    const maxCharge = battery.powerMW * (5/60);
    const maxDischarge = battery.powerMW * (5/60);
    const efficiency = Math.sqrt(battery.efficiency);
    
    // Calculate moving averages
    const movingAvg: number[] = [];
    const movingStd: number[] = [];
    
    for (let i = 0; i < data.length; i++) {
      const window = data.slice(Math.max(0, i - params.windowSize), i + 1).map(d => d.price);
      const avg = window.reduce((a, b) => a + b, 0) / window.length;
      const std = Math.sqrt(window.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / window.length);
      
      movingAvg.push(avg);
      movingStd.push(std);
    }
    
    for (let i = 0; i < data.length; i++) {
      const interval = data[i];
      const avg = movingAvg[i];
      const std = movingStd[i];
      
      let action: 'charge' | 'discharge' | 'hold' = 'hold';
      let powerMW = 0;
      let intervalRevenue = 0;
      
      if (interval.price < avg - params.spreadMultiplier * std && soc < battery.capacityMWh) {
        // Charge - price is unusually low
        const chargeAmount = Math.min(maxCharge, battery.capacityMWh - soc);
        const gridEnergy = chargeAmount / efficiency;
        
        action = 'charge';
        powerMW = -chargeAmount / (5/60);
        soc += chargeAmount;
        intervalRevenue = -interval.price * gridEnergy;
        energyTraded += gridEnergy;
        cycles += chargeAmount / (2 * battery.capacityMWh);
        
      } else if (interval.price > avg + params.spreadMultiplier * std && soc > 0) {
        // Discharge - price is unusually high
        const dischargeAmount = Math.min(maxDischarge, soc);
        const gridEnergy = dischargeAmount * efficiency;
        
        action = 'discharge';
        powerMW = dischargeAmount / (5/60);
        soc -= dischargeAmount;
        intervalRevenue = interval.price * gridEnergy;
        energyTraded += gridEnergy;
        cycles += dischargeAmount / (2 * battery.capacityMWh);
      }
      
      revenue += intervalRevenue;
      
      schedule.push({
        timestamp: interval.timestamp,
        action,
        powerMW,
        soc,
        price: interval.price,
        revenue: intervalRevenue
      });
    }
    
    return {
      revenue,
      cycles,
      energyTraded,
      schedule,
      metrics: {
        avgChargePrice: 0,
        avgDischargePrice: 0,
        utilizationPercent: (cycles * 2 * battery.capacityMWh) / (battery.capacityMWh * data.length / 288) * 100
      }
    };
  }
};

// Peak shaving strategy
const peakShaveStrategy: Strategy = {
  id: 'peakshave',
  name: 'Peak Shaving',
  description: 'Discharge during daily peaks, charge during off-peak',
  params: [
    {
      name: 'morningPeakStart',
      type: 'number',
      default: 7,
      min: 0,
      max: 23,
      description: 'Morning peak start hour'
    },
    {
      name: 'morningPeakEnd',
      type: 'number',
      default: 9,
      min: 0,
      max: 23,
      description: 'Morning peak end hour'
    },
    {
      name: 'eveningPeakStart',
      type: 'number',
      default: 17,
      min: 0,
      max: 23,
      description: 'Evening peak start hour'
    },
    {
      name: 'eveningPeakEnd',
      type: 'number',
      default: 21,
      min: 0,
      max: 23,
      description: 'Evening peak end hour'
    }
  ],
  async run(data, battery, params) {
    const schedule: ScheduleEntry[] = [];
    let soc = battery.capacityMWh * 0.5;
    let revenue = 0;
    let cycles = 0;
    let energyTraded = 0;
    
    const maxCharge = battery.powerMW * (5/60);
    const maxDischarge = battery.powerMW * (5/60);
    const efficiency = Math.sqrt(battery.efficiency);
    
    for (const interval of data) {
      const hour = new Date(interval.timestamp).getHours();
      let action: 'charge' | 'discharge' | 'hold' = 'hold';
      let powerMW = 0;
      let intervalRevenue = 0;
      
      const isMorningPeak = hour >= params.morningPeakStart && hour < params.morningPeakEnd;
      const isEveningPeak = hour >= params.eveningPeakStart && hour < params.eveningPeakEnd;
      const isPeak = isMorningPeak || isEveningPeak;
      
      if (isPeak && soc > 0) {
        // Discharge during peak
        const dischargeAmount = Math.min(maxDischarge, soc);
        const gridEnergy = dischargeAmount * efficiency;
        
        action = 'discharge';
        powerMW = dischargeAmount / (5/60);
        soc -= dischargeAmount;
        intervalRevenue = interval.price * gridEnergy;
        energyTraded += gridEnergy;
        cycles += dischargeAmount / (2 * battery.capacityMWh);
        
      } else if (!isPeak && soc < battery.capacityMWh && interval.price < 50) {
        // Charge during off-peak if price is reasonable
        const chargeAmount = Math.min(maxCharge, battery.capacityMWh - soc);
        const gridEnergy = chargeAmount / efficiency;
        
        action = 'charge';
        powerMW = -chargeAmount / (5/60);
        soc += chargeAmount;
        intervalRevenue = -interval.price * gridEnergy;
        energyTraded += gridEnergy;
        cycles += chargeAmount / (2 * battery.capacityMWh);
      }
      
      revenue += intervalRevenue;
      
      schedule.push({
        timestamp: interval.timestamp,
        action,
        powerMW,
        soc,
        price: interval.price,
        revenue: intervalRevenue
      });
    }
    
    return {
      revenue,
      cycles,
      energyTraded,
      schedule,
      metrics: {
        avgChargePrice: 0,
        avgDischargePrice: 0,
        utilizationPercent: (cycles * 2 * battery.capacityMWh) / (battery.capacityMWh * data.length / 288) * 100
      }
    };
  }
};

// Export all strategies
export const strategies: Record<string, Strategy> = {
  threshold: thresholdStrategy,
  spread: spreadStrategy,
  peakshave: peakShaveStrategy
};
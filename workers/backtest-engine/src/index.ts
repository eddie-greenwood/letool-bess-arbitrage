/**
 * Backtesting Engine for BESS Trading Strategies
 * Runs strategies against historical data with perfect hindsight benchmark
 */

import { BacktestRunner } from './runner';
import { strategies } from './strategies';
import { calculateMetrics } from './metrics';

export interface Env {
  NEM_R2: R2Bucket;
  BACKTEST_R2: R2Bucket;
  DB: D1Database;
  BACKTEST_RUNNER: DurableObjectNamespace;
  HARVESTER_URL: string;
}

export interface BacktestRequest {
  strategyId: string;
  region: string;
  startDate: string;
  endDate: string;
  battery: {
    powerMW: number;
    capacityMWh: number;
    efficiency: number;
    rampMWPerMin?: number;
    cyclesMax?: number;
  };
  tariff?: string;
  fcas?: {
    enabled: boolean;
    services: string[];
    reservePercent?: number;
  };
  params?: Record<string, any>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Run backtest
    if (path === '/api/backtest/run' && request.method === 'POST') {
      const config = await request.json() as BacktestRequest;
      
      // Generate unique run ID
      const runId = crypto.randomUUID();
      
      // Get or create durable object for this run
      const id = env.BACKTEST_RUNNER.idFromName(runId);
      const runner = env.BACKTEST_RUNNER.get(id);
      
      // Start backtest in durable object (async)
      const response = await runner.fetch(new Request('http://do/start', {
        method: 'POST',
        body: JSON.stringify({ ...config, env })
      }));
      
      if (!response.ok) {
        return json({ success: false, error: await response.text() }, corsHeaders);
      }
      
      return json({
        success: true,
        runId,
        status: 'running',
        message: 'Backtest started'
      }, corsHeaders);
    }

    // Get backtest status/results
    if (path.startsWith('/api/backtest/result/')) {
      const runId = path.split('/').pop();
      if (!runId) {
        return json({ success: false, error: 'Invalid run ID' }, corsHeaders);
      }
      
      // Check if results are in R2 (completed)
      const resultKey = `backtest/results/${runId}.json`;
      const result = await env.BACKTEST_R2.get(resultKey);
      
      if (result) {
        const data = JSON.parse(await result.text());
        return json({ success: true, ...data }, corsHeaders);
      }
      
      // Check durable object for status
      const id = env.BACKTEST_RUNNER.idFromName(runId);
      const runner = env.BACKTEST_RUNNER.get(id);
      
      const statusResponse = await runner.fetch(new Request('http://do/status'));
      const status = await statusResponse.json();
      
      return json({ success: true, ...status }, corsHeaders);
    }

    // List available strategies
    if (path === '/api/strategies') {
      return json({
        success: true,
        strategies: Object.keys(strategies).map(id => ({
          id,
          name: strategies[id].name,
          description: strategies[id].description,
          params: strategies[id].params
        }))
      }, corsHeaders);
    }

    // Compare multiple strategies
    if (path === '/api/backtest/compare' && request.method === 'POST') {
      const { strategies: strategyIds, ...config } = await request.json();
      
      const runs = [];
      for (const strategyId of strategyIds) {
        const runId = crypto.randomUUID();
        const id = env.BACKTEST_RUNNER.idFromName(runId);
        const runner = env.BACKTEST_RUNNER.get(id);
        
        await runner.fetch(new Request('http://do/start', {
          method: 'POST',
          body: JSON.stringify({ ...config, strategyId, env })
        }));
        
        runs.push({ strategyId, runId });
      }
      
      return json({
        success: true,
        comparison: {
          id: crypto.randomUUID(),
          runs,
          status: 'running'
        }
      }, corsHeaders);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

// Durable Object for running backtests
export class BacktestRunner {
  private state: DurableObjectState;
  private env: Env;
  private status: string = 'idle';
  private progress: number = 0;
  private results: any = null;
  private error: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/start') {
      const config = await request.json();
      this.runBacktest(config); // Don't await - run async
      return new Response('Started');
    }
    
    if (url.pathname === '/status') {
      return Response.json({
        status: this.status,
        progress: this.progress,
        results: this.results,
        error: this.error
      });
    }
    
    return new Response('Not Found', { status: 404 });
  }

  private async runBacktest(config: any): Promise<void> {
    this.status = 'running';
    this.progress = 0;
    
    try {
      // Get historical data
      const data = await this.fetchHistoricalData(
        config.region,
        config.startDate,
        config.endDate
      );
      
      this.progress = 25;
      
      // Run strategy
      const strategy = strategies[config.strategyId];
      if (!strategy) {
        throw new Error(`Strategy ${config.strategyId} not found`);
      }
      
      const strategyResults = await strategy.run(data, config.battery, config.params);
      this.progress = 50;
      
      // Run perfect hindsight benchmark
      const benchmark = await this.runPerfectHindsight(data, config.battery);
      this.progress = 75;
      
      // Calculate metrics
      const metrics = calculateMetrics(strategyResults, benchmark);
      
      // Save results
      this.results = {
        runId: config.runId,
        config,
        strategy: strategyResults,
        benchmark,
        metrics,
        completedAt: new Date().toISOString()
      };
      
      // Store in R2
      const resultKey = `backtest/results/${config.runId}.json`;
      await this.env.BACKTEST_R2.put(resultKey, JSON.stringify(this.results));
      
      this.status = 'completed';
      this.progress = 100;
      
    } catch (error) {
      this.status = 'failed';
      this.error = error.message;
      console.error('Backtest failed:', error);
    }
  }

  private async fetchHistoricalData(region: string, startDate: string, endDate: string): Promise<any[]> {
    // Fetch from harvester API
    const response = await fetch(
      `${this.env.HARVESTER_URL}/api/range?region=${region}&start=${startDate}&end=${endDate}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch historical data');
    }
    
    const data = await response.json();
    return data.data;
  }

  private async runPerfectHindsight(data: any[], battery: any): Promise<any> {
    // This would run the DP optimizer with perfect foresight
    // For now, return a simple benchmark
    return {
      revenue: data.length * 100, // Placeholder
      cycles: 2.0,
      energyTraded: battery.capacityMWh * 2 * data.length / 288
    };
  }
}

function json(data: any, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}
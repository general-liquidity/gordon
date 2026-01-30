/**
 * Backtest Analysis Utilities
 *
 * Native analysis helpers that mirror the MCP backtesting server utilities.
 */

import type { BacktestResult, BacktestMetrics } from "./types.ts";

export interface BacktestAnalysisResult {
  strategy: string;
  performance: {
    totalReturn: number;
    finalValue: number;
    initialValue: number;
    sharpeRatio: number;
    maxDrawdown: number;
    riskRewardRatio: number;
  };
  tradingActivity: {
    totalTrades: number;
    winRate: number;
    avgTradeReturn: number;
    profitFactor: number;
    maxConsecutiveLosses: number;
  };
  tradeAnalysis: {
    total: number;
    wins: number;
    losses: number;
    avgWin: number;
    avgLoss: number;
    largestWin: number;
    largestLoss: number;
  };
  execution: {
    executionTime: number;
    timestamp: string;
  };
}

function calculateRiskRewardRatio(metrics: BacktestMetrics): number {
  if (metrics.maxDrawdown === 0) {
    return metrics.totalReturn > 0 ? Infinity : 0;
  }
  return Math.abs(metrics.totalReturn / metrics.maxDrawdown);
}

function analyzeTrades(result: BacktestResult): BacktestAnalysisResult["tradeAnalysis"] {
  const trades = result.trades ?? [];
  if (trades.length === 0) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
    };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const avgWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length
    : 0;

  const largestWin = wins.length > 0
    ? Math.max(...wins.map((t) => t.pnl))
    : 0;
  const largestLoss = losses.length > 0
    ? Math.min(...losses.map((t) => t.pnl))
    : 0;

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
  };
}

export function analyzeBacktestResult(result: BacktestResult): BacktestAnalysisResult {
  const metrics = result.metrics;

  return {
    strategy: result.strategyName ?? "unknown",
    performance: {
      totalReturn: metrics.totalReturn,
      finalValue: metrics.finalValue,
      initialValue: metrics.initialValue,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown,
      riskRewardRatio: calculateRiskRewardRatio(metrics),
    },
    tradingActivity: {
      totalTrades: metrics.totalTrades,
      winRate: metrics.winRate,
      avgTradeReturn: metrics.averageTrade,
      profitFactor: metrics.profitFactor,
      maxConsecutiveLosses: metrics.maxConsecutiveLosses,
    },
    tradeAnalysis: analyzeTrades(result),
    execution: {
      executionTime: result.executionTime,
      timestamp: result.createdAt,
    },
  };
}

export function compareBacktestResults(
  results: BacktestResult[],
  sortBy: keyof BacktestMetrics = "totalReturn"
): {
  comparisonTable: Array<Record<string, unknown>>;
  bestStrategy: Record<string, unknown> | null;
  totalStrategies: number;
  sortedBy: string;
  summary: {
    avgReturn: number;
    maxReturn: number;
    minReturn: number;
    avgSharpe: number;
    bestSharpe: number;
  };
} {
  if (results.length === 0) {
    return {
      comparisonTable: [],
      bestStrategy: null,
      totalStrategies: 0,
      sortedBy: String(sortBy),
      summary: {
        avgReturn: 0,
        maxReturn: 0,
        minReturn: 0,
        avgSharpe: 0,
        bestSharpe: 0,
      },
    };
  }

  const comparisonTable = results.map((result) => ({
    strategy: result.strategyName ?? "unknown",
    framework: "gordon-native",
    totalReturn: result.metrics.totalReturn,
    sharpeRatio: result.metrics.sharpeRatio,
    maxDrawdown: result.metrics.maxDrawdown,
    finalValue: result.metrics.finalValue,
    numTrades: result.metrics.totalTrades,
    winRate: result.metrics.winRate,
    riskRewardRatio: calculateRiskRewardRatio(result.metrics),
    metrics: result.metrics,
    result,
  }));

  const sorted = [...comparisonTable].sort((a, b) => {
    const aMetric = (a.metrics as BacktestMetrics)[sortBy] as number;
    const bMetric = (b.metrics as BacktestMetrics)[sortBy] as number;
    return (bMetric ?? -Infinity) - (aMetric ?? -Infinity);
  });

  const returns = comparisonTable.map((row) => row.totalReturn as number);
  const sharpes = comparisonTable.map((row) => row.sharpeRatio as number);

  return {
    comparisonTable: sorted,
    bestStrategy: sorted[0] ?? null,
    totalStrategies: results.length,
    sortedBy: String(sortBy),
    summary: {
      avgReturn: returns.reduce((a, b) => a + b, 0) / returns.length,
      maxReturn: Math.max(...returns),
      minReturn: Math.min(...returns),
      avgSharpe: sharpes.reduce((a, b) => a + b, 0) / sharpes.length,
      bestSharpe: Math.max(...sharpes),
    },
  };
}

export function rankStrategiesByMetric(
  results: BacktestResult[],
  metric: keyof BacktestMetrics = "totalReturn"
): Array<{ strategy: string; value: number; rank: number }> {
  if (results.length === 0) {
    return [];
  }

  const rows = results.map((result) => ({
    strategy: result.strategyName ?? "unknown",
    value: (result.metrics[metric] as number) ?? 0,
  }));

  rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

  return rows.map((row, index) => ({
    strategy: row.strategy,
    value: row.value,
    rank: index + 1,
  }));
}

export function findBestStrategy(
  results: BacktestResult[],
  metric: keyof BacktestMetrics = "totalReturn"
): {
  bestStrategy: string | null;
  bestMetricValue: number | null;
  metricUsed: string;
  fullResult: BacktestResult | null;
} {
  if (results.length === 0) {
    return {
      bestStrategy: null,
      bestMetricValue: null,
      metricUsed: String(metric),
      fullResult: null,
    };
  }

  let best: BacktestResult | null = null;
  let bestValue = metric === "maxDrawdown" ? Infinity : -Infinity;

  for (const result of results) {
    const value = (result.metrics[metric] as number) ?? 0;
    if (metric === "maxDrawdown") {
      if (value < bestValue) {
        bestValue = value;
        best = result;
      }
    } else if (value > bestValue) {
      bestValue = value;
      best = result;
    }
  }

  return {
    bestStrategy: best?.strategyName ?? null,
    bestMetricValue: bestValue === Infinity || bestValue === -Infinity ? null : bestValue,
    metricUsed: String(metric),
    fullResult: best,
  };
}

/**
 * Cross-Pair Analysis Tools (Mastra Format)
 * Correlation, spread, and relative performance analysis between trading pairs
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
  insufficientData: (symbol: string) => ({
    error: `Insufficient data for ${symbol}. Need at least 20 candles.`,
  }),
};

// ============================================================================
// Math Helpers (pure TypeScript, no external libs)
// ============================================================================

function returns(prices: number[]): number[] {
  return prices.slice(1).map((p, i) => (p - prices[i]!) / prices[i]!);
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const xSlice = x.slice(0, n);
  const ySlice = y.slice(0, n);
  const sumX = xSlice.reduce((a, b) => a + b, 0);
  const sumY = ySlice.reduce((a, b) => a + b, 0);
  const sumXY = xSlice.reduce((a, xi, i) => a + xi * ySlice[i]!, 0);
  const sumX2 = xSlice.reduce((a, xi) => a + xi * xi, 0);
  const sumY2 = ySlice.reduce((a, yi) => a + yi * yi, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? 0 : num / den;
}

function calculateBeta(returnsA: number[], returnsB: number[]): number {
  const n = Math.min(returnsA.length, returnsB.length);
  if (n < 3) return 0;
  const meanA = mean(returnsA.slice(0, n));
  const meanB = mean(returnsB.slice(0, n));
  let cov = 0;
  let varA = 0;
  for (let i = 0; i < n; i++) {
    const dA = returnsA[i]! - meanA;
    const dB = returnsB[i]! - meanB;
    cov += dA * dB;
    varA += dA * dA;
  }
  return varA === 0 ? 0 : cov / varA;
}

function rollingCorrelation(x: number[], y: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = window; i <= x.length; i++) {
    const xWindow = x.slice(i - window, i);
    const yWindow = y.slice(i - window, i);
    result.push(pearsonCorrelation(xWindow, yWindow));
  }
  return result;
}

function halfLife(spread: number[]): number {
  if (spread.length < 3) return Infinity;
  const y = spread.slice(1).map((s, i) => s - spread[i]!);
  const x = spread.slice(0, -1);
  const n = y.length;
  const meanX = mean(x);
  const meanY = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i]! - meanX) * (y[i]! - meanY);
    den += (x[i]! - meanX) ** 2;
  }
  const theta = den === 0 ? 0 : num / den;
  if (theta >= 0) return Infinity;
  return -Math.log(2) / Math.log(1 + theta);
}

function interpretCorrelation(corr: number): string {
  const abs = Math.abs(corr);
  const dir = corr >= 0 ? "positive" : "negative";
  if (abs >= 0.8)
    return `Strong ${dir} correlation (${corr.toFixed(3)}) — assets move closely together${corr < 0 ? " in opposite directions" : ""}`;
  if (abs >= 0.5) return `Moderate ${dir} correlation (${corr.toFixed(3)}) — some co-movement`;
  if (abs >= 0.3) return `Weak ${dir} correlation (${corr.toFixed(3)}) — limited relationship`;
  return `Very weak/no correlation (${corr.toFixed(3)}) — assets move independently`;
}

// ============================================================================
// Pair Correlation Tool
// ============================================================================

export const analyzePairCorrelationTool = createTool({
  id: "analyze_pair_correlation",
  description:
    "Analyze correlation between two trading pairs. Computes Pearson correlation of prices and returns, " +
    "beta coefficient, rolling correlation trend, and cointegration hint. " +
    "Use when user asks 'how correlated are BTC and ETH', 'BTC vs XRP relationship', 'pair analysis'.",
  inputSchema: z.object({
    symbolA: z.string().describe("First trading pair (e.g., 'BTCUSDT')"),
    symbolB: z.string().describe("Second trading pair (e.g., 'XRPUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe for analysis"),
    period: z.number().min(20).max(500).default(100).describe("Number of candles to analyze"),
  }),
  outputSchema: z.object({
    symbolA: z.string().optional(),
    symbolB: z.string().optional(),
    interval: z.string().optional(),
    period: z.number().optional(),
    priceCorrelation: z.number().optional(),
    returnCorrelation: z.number().optional(),
    beta: z.number().optional(),
    rollingCorrelation: z.array(z.number()).optional(),
    spreadMean: z.number().optional(),
    spreadStd: z.number().optional(),
    currentZScore: z.number().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbolA, symbolB, interval, period }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    try {
      const symA = symbolA.toUpperCase();
      const symB = symbolB.toUpperCase();

      // Fetch candles in parallel
      const [candlesA, candlesB] = await Promise.all([
        ctx.exchange.getCandles(symA, interval, period),
        ctx.exchange.getCandles(symB, interval, period),
      ]);

      if (candlesA.length < 20) return errors.insufficientData(symA);
      if (candlesB.length < 20) return errors.insufficientData(symB);

      // Align by length
      const len = Math.min(candlesA.length, candlesB.length);
      const closesA = candlesA.slice(-len).map((c) => c.close);
      const closesB = candlesB.slice(-len).map((c) => c.close);

      // Price correlation
      const priceCorr = pearsonCorrelation(closesA, closesB);

      // Returns correlation (more meaningful)
      const retA = returns(closesA);
      const retB = returns(closesB);
      const retCorr = pearsonCorrelation(retA, retB);

      // Beta: how much B moves per 1% move in A
      const betaVal = calculateBeta(retA, retB);

      // Rolling correlation (window of 20, last 5 values)
      const rolling = rollingCorrelation(retA, retB, 20);
      const recentRolling = rolling.slice(-5).map((v) => parseFloat(v.toFixed(4)));

      // Spread analysis (for cointegration hint)
      // Normalize prices and compute spread
      const normA = closesA.map((p) => p / closesA[0]!);
      const normB = closesB.map((p) => p / closesB[0]!);
      const spread = normA.map((a, i) => a - normB[i]!);
      const spreadM = mean(spread);
      const spreadS = std(spread);
      const currentZ = spreadS === 0 ? 0 : (spread[spread.length - 1]! - spreadM) / spreadS;

      const interpretation = [
        interpretCorrelation(retCorr),
        `Beta: ${betaVal.toFixed(3)} (for every 1% move in ${symA}, ${symB} moves ~${(betaVal * 100).toFixed(1)}% in the same direction)`,
        `Spread z-score: ${currentZ.toFixed(2)}${Math.abs(currentZ) > 2 ? " — EXTREME divergence, potential mean-reversion opportunity" : Math.abs(currentZ) > 1 ? " — notable divergence" : " — within normal range"}`,
      ].join(". ");

      return {
        symbolA: symA,
        symbolB: symB,
        interval,
        period: len,
        priceCorrelation: parseFloat(priceCorr.toFixed(4)),
        returnCorrelation: parseFloat(retCorr.toFixed(4)),
        beta: parseFloat(betaVal.toFixed(4)),
        rollingCorrelation: recentRolling,
        spreadMean: parseFloat(spreadM.toFixed(6)),
        spreadStd: parseFloat(spreadS.toFixed(6)),
        currentZScore: parseFloat(currentZ.toFixed(4)),
        interpretation,
      };
    } catch (error) {
      return { error: `Pair correlation analysis failed: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Pair Spread Tool
// ============================================================================

export const analyzePairSpreadTool = createTool({
  id: "analyze_pair_spread",
  description:
    "Analyze the price ratio spread between two pairs for mean-reversion trading. " +
    "Computes ratio, z-score, Bollinger bands on the ratio, half-life, and trade signals. " +
    "Use when user asks 'pair trade BTC/XRP', 'spread analysis', 'mean reversion opportunity'.",
  inputSchema: z.object({
    symbolA: z.string().describe("First trading pair (e.g., 'BTCUSDT')"),
    symbolB: z.string().describe("Second trading pair (e.g., 'XRPUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe for analysis"),
    period: z.number().min(20).max(500).default(100).describe("Number of candles to analyze"),
    zScoreThreshold: z
      .number()
      .min(1)
      .max(4)
      .default(2.0)
      .describe("Z-score threshold for trade signals"),
  }),
  outputSchema: z.object({
    symbolA: z.string().optional(),
    symbolB: z.string().optional(),
    currentRatio: z.number().optional(),
    meanRatio: z.number().optional(),
    stdRatio: z.number().optional(),
    zScore: z.number().optional(),
    signal: z.string().optional(),
    signalStrength: z.string().optional(),
    halfLifeBars: z.number().optional(),
    halfLifeDescription: z.string().optional(),
    bands: z
      .object({
        upper2: z.number(),
        upper1: z.number(),
        mean: z.number(),
        lower1: z.number(),
        lower2: z.number(),
      })
      .optional(),
    recentRatios: z.array(z.number()).optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbolA, symbolB, interval, period, zScoreThreshold },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    try {
      const symA = symbolA.toUpperCase();
      const symB = symbolB.toUpperCase();

      const [candlesA, candlesB] = await Promise.all([
        ctx.exchange.getCandles(symA, interval, period),
        ctx.exchange.getCandles(symB, interval, period),
      ]);

      if (candlesA.length < 20) return errors.insufficientData(symA);
      if (candlesB.length < 20) return errors.insufficientData(symB);

      const len = Math.min(candlesA.length, candlesB.length);
      const closesA = candlesA.slice(-len).map((c) => c.close);
      const closesB = candlesB.slice(-len).map((c) => c.close);

      // Compute ratio A/B
      const ratios = closesA.map((a, i) => a / closesB[i]!);
      const currentRatio = ratios[ratios.length - 1]!;
      const meanRatio = mean(ratios);
      const stdRatio = std(ratios);

      // Z-score
      const zScore = stdRatio === 0 ? 0 : (currentRatio - meanRatio) / stdRatio;

      // Signal
      let signal: string;
      let signalStrength: string;
      if (zScore < -zScoreThreshold) {
        signal = `LONG ${symA} / SHORT ${symB}`;
        signalStrength = Math.abs(zScore) > zScoreThreshold * 1.5 ? "strong" : "moderate";
      } else if (zScore > zScoreThreshold) {
        signal = `SHORT ${symA} / LONG ${symB}`;
        signalStrength = Math.abs(zScore) > zScoreThreshold * 1.5 ? "strong" : "moderate";
      } else {
        signal = "NEUTRAL — spread within normal range";
        signalStrength = "none";
      }

      // Half-life
      const hl = halfLife(ratios);
      const hlDesc =
        hl === Infinity
          ? "No mean-reversion detected (spread may be trending)"
          : `~${Math.round(hl)} bars (${Math.round(hl)} x ${interval} timeframe) to revert halfway`;

      // Bollinger bands on ratio
      const bands = {
        upper2: parseFloat((meanRatio + 2 * stdRatio).toFixed(6)),
        upper1: parseFloat((meanRatio + 1 * stdRatio).toFixed(6)),
        mean: parseFloat(meanRatio.toFixed(6)),
        lower1: parseFloat((meanRatio - 1 * stdRatio).toFixed(6)),
        lower2: parseFloat((meanRatio - 2 * stdRatio).toFixed(6)),
      };

      // Recent ratios (last 10)
      const recentRatios = ratios.slice(-10).map((r) => parseFloat(r.toFixed(6)));

      const interpretation = [
        `${symA}/${symB} ratio: ${currentRatio.toFixed(4)} (mean: ${meanRatio.toFixed(4)})`,
        `Z-score: ${zScore.toFixed(2)} → ${signal}`,
        hl !== Infinity
          ? `Half-life: ${Math.round(hl)} bars — ${hl < 10 ? "fast mean-reversion (good for pair trading)" : hl < 30 ? "moderate reversion speed" : "slow reversion"}`
          : "No clear mean-reversion pattern",
      ].join(". ");

      return {
        symbolA: symA,
        symbolB: symB,
        currentRatio: parseFloat(currentRatio.toFixed(6)),
        meanRatio: parseFloat(meanRatio.toFixed(6)),
        stdRatio: parseFloat(stdRatio.toFixed(6)),
        zScore: parseFloat(zScore.toFixed(4)),
        signal,
        signalStrength,
        halfLifeBars: hl === Infinity ? -1 : Math.round(hl),
        halfLifeDescription: hlDesc,
        bands,
        recentRatios,
        interpretation,
      };
    } catch (error) {
      return { error: `Pair spread analysis failed: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Pair Performance Comparison
// ============================================================================

export const comparePairPerformanceTool = createTool({
  id: "compare_pair_performance",
  description:
    "Compare relative performance of two assets over a period. " +
    "Shows which asset outperformed, by how much, and identifies divergence points. " +
    "Use when user asks 'BTC vs ETH performance', 'which performed better', 'relative strength'.",
  inputSchema: z.object({
    symbolA: z.string().describe("First trading pair (e.g., 'BTCUSDT')"),
    symbolB: z.string().describe("Second trading pair (e.g., 'ETHUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("1d").describe("Timeframe"),
    period: z.number().min(5).max(365).default(30).describe("Number of candles to compare"),
  }),
  outputSchema: z.object({
    symbolA: z.string().optional(),
    symbolB: z.string().optional(),
    performanceA: z.number().optional(),
    performanceB: z.number().optional(),
    outperformer: z.string().optional(),
    outperformancePercent: z.number().optional(),
    volatilityA: z.number().optional(),
    volatilityB: z.number().optional(),
    maxDrawdownA: z.number().optional(),
    maxDrawdownB: z.number().optional(),
    sharpeA: z.number().optional(),
    sharpeB: z.number().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbolA, symbolB, interval, period }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    try {
      const symA = symbolA.toUpperCase();
      const symB = symbolB.toUpperCase();

      const [candlesA, candlesB] = await Promise.all([
        ctx.exchange.getCandles(symA, interval, period),
        ctx.exchange.getCandles(symB, interval, period),
      ]);

      if (candlesA.length < 5) return errors.insufficientData(symA);
      if (candlesB.length < 5) return errors.insufficientData(symB);

      const len = Math.min(candlesA.length, candlesB.length);
      const closesA = candlesA.slice(-len).map((c) => c.close);
      const closesB = candlesB.slice(-len).map((c) => c.close);

      // Performance
      const perfA = ((closesA[closesA.length - 1]! - closesA[0]!) / closesA[0]!) * 100;
      const perfB = ((closesB[closesB.length - 1]! - closesB[0]!) / closesB[0]!) * 100;

      // Volatility (annualized std of returns)
      const retA = returns(closesA);
      const retB = returns(closesB);
      const volA = std(retA) * 100;
      const volB = std(retB) * 100;

      // Max drawdown
      function maxDrawdown(prices: number[]): number {
        let peak = prices[0]!;
        let maxDD = 0;
        for (const p of prices) {
          if (p > peak) peak = p;
          const dd = ((peak - p) / peak) * 100;
          if (dd > maxDD) maxDD = dd;
        }
        return maxDD;
      }
      const mddA = maxDrawdown(closesA);
      const mddB = maxDrawdown(closesB);

      // Simple Sharpe (return / volatility)
      const sharpeA = volA === 0 ? 0 : perfA / volA;
      const sharpeB = volB === 0 ? 0 : perfB / volB;

      const outperformer = perfA >= perfB ? symA : symB;
      const outperformance = Math.abs(perfA - perfB);

      const interpretation = [
        `${symA}: ${perfA >= 0 ? "+" : ""}${perfA.toFixed(2)}% | ${symB}: ${perfB >= 0 ? "+" : ""}${perfB.toFixed(2)}%`,
        `${outperformer} outperformed by ${outperformance.toFixed(2)}%`,
        `Risk-adjusted (Sharpe): ${symA} ${sharpeA.toFixed(2)} vs ${symB} ${sharpeB.toFixed(2)} — ${sharpeA > sharpeB ? symA : symB} has better risk-adjusted returns`,
        `Max drawdown: ${symA} -${mddA.toFixed(2)}% | ${symB} -${mddB.toFixed(2)}%`,
      ].join(". ");

      return {
        symbolA: symA,
        symbolB: symB,
        performanceA: parseFloat(perfA.toFixed(2)),
        performanceB: parseFloat(perfB.toFixed(2)),
        outperformer,
        outperformancePercent: parseFloat(outperformance.toFixed(2)),
        volatilityA: parseFloat(volA.toFixed(2)),
        volatilityB: parseFloat(volB.toFixed(2)),
        maxDrawdownA: parseFloat(mddA.toFixed(2)),
        maxDrawdownB: parseFloat(mddB.toFixed(2)),
        sharpeA: parseFloat(sharpeA.toFixed(4)),
        sharpeB: parseFloat(sharpeB.toFixed(4)),
        interpretation,
      };
    } catch (error) {
      return { error: `Performance comparison failed: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export const pairAnalysisTools = {
  analyze_pair_correlation: analyzePairCorrelationTool,
  analyze_pair_spread: analyzePairSpreadTool,
  compare_pair_performance: comparePairPerformanceTool,
};

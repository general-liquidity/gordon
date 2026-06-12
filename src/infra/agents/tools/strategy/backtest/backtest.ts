/**
 * Backtest Tools (Mastra Format)
 *
 * Tools for backtesting trading strategies including:
 * - Running backtests on historical data
 * - Optimizing strategy parameters via grid search
 * - Comparing multiple strategies
 * - Formatting backtest results for display
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { strategyRegistry, type StrategyId } from "../../../../../strategies/index.ts";
import type { Strategy } from "../../../../../strategies/types.ts";
import { DEFAULT_BACKTEST_CONFIG } from "../../../../../backtest/types.ts";
import type {
  BacktestConfig,
  BacktestMetrics,
  BacktestResult,
  BacktestTrade,
  OHLC,
} from "../../../../../backtest/types.ts";
import { runBacktest } from "../../../../../backtest/engine.ts";
import { enrichBacktestResult } from "../../../../../backtest/enrichment.ts";
import { formatBacktestSummary } from "../../../../../backtest/reporting/formatter.ts";
import type {
  HistoricalDataClient,
  HistoricalFetchMetadata,
} from "../../../../../backtest/data/historical.ts";
import {
  fetchHistoricalDataRangeWithMetadata,
  fetchHistoricalDataWithMetadata,
} from "../../../../../backtest/data/historical.ts";
import {
  analyzeBacktestResult,
  compareBacktestResults,
  findBestStrategy,
  rankStrategiesByMetric,
} from "../../../../../backtest/analysis/analysis.ts";
import {
  exportResultsJson,
  exportResultsCsv,
  generateHtmlReport,
} from "../../../../../backtest/reporting/export.ts";
import { filterExcludeMonths, filterMarketHours, filterFirstLastHour } from "../../../../../backtest/prerun/filters.ts";
import { analyzeAlphaDecay } from "../../../../../backtest/analysis/alpha-decay.ts";
import { generateBacktestChart } from "../../../../../backtest/plotting.ts";
import { walkForwardTest, type WalkForwardConfig } from "../../../../../backtest/analysis/walk-forward.ts";
import { runMonteCarloSimulation, type MonteCarloConfig } from "../../../../../backtest/analysis/monte-carlo.ts";
import { detectOverfitting } from "../../../../../backtest/optimization/overfitting.ts";
import {
  saveBacktestResult,
  loadBacktestResult,
  listBacktestHistory,
  type BacktestQueryOptions,
} from "../../../../../backtest/persistence/storage.ts";
import { getAuditLogger } from "../../../../platform/audit/index.ts";
import {
  buildBacktestOperatorReport,
  buildComparisonOperatorReport,
  buildOptimizationOperatorReport,
  buildSimulationRealismProfile,
  formatOperatorReport,
  operatorReportSchema,
  processSystematicBacktest,
} from "../../../../domain/systematic/index.ts";
import { getGordonContext, type MastraExecutionContext } from "../../types.ts";
import { normalizeCryptoSymbol, normalizeStockSymbol, resolveInstrument } from "../../../../domain/markets/instruments.ts";
import { ensureDataset } from "../../../../domain/systematic/service.ts";
import type { Exchange } from "../../../../exchange/types.ts";

// ============================================================================
// Helper Functions
// ============================================================================

// Helper functions are defined below in this file.

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
  noDataClient: { error: "No connected exchange or broker can provide historical market data." },
  strategyNotFound: (id: string) => ({
    error: `Strategy "${id}" not found. Use list_strategies to see available strategies.`,
  }),
  insufficientData: (symbol: string) => ({
    error: `Insufficient historical data for ${symbol}. Try a shorter backtest period or different timeframe.`,
  }),
};

type HistoricalMarket = "auto" | "crypto" | "stocks";

function mapExitReason(reason: string): BacktestTrade["exitReason"] {
  const upper = reason.toUpperCase();
  if (upper.includes("STOP")) return "STOP";
  if (upper.includes("TAKE_PROFIT") || upper.includes("TP")) return "TP1";
  if (upper.includes("END")) return "END_OF_TEST";
  return "SIGNAL";
}

function looksExplicitlyCrypto(symbol: string): boolean {
  return symbol.includes("/")
    || /USDT|USDC|BUSD|USD|PERP$/i.test(symbol.trim().toUpperCase());
}

async function resolveHistoricalClient(
  ctx: ReturnType<typeof getGordonContext>,
  symbol: string,
  market: HistoricalMarket = "auto",
): Promise<{
  client: HistoricalDataClient;
  normalizedSymbol: string;
  marketFamily: "crypto" | "stocks";
}> {
  if (!ctx) {
    throw new Error(errors.noDataClient.error);
  }

  if (market === "stocks") {
    if (!ctx.broker) throw new Error("Broker client not connected. Please configure a broker first.");
    if (!ctx.broker.capabilities.supportsHistoricalBars) {
      throw new Error(`${ctx.broker.displayName} does not support historical bars in Gordon yet.`);
    }
    return {
      client: ctx.broker,
      normalizedSymbol: normalizeStockSymbol(symbol),
      marketFamily: "stocks",
    };
  }

  if (market === "crypto") {
    if (!ctx.exchange) throw new Error(errors.noExchange.error);
    return {
      client: ctx.exchange,
      normalizedSymbol: normalizeCryptoSymbol(symbol),
      marketFamily: "crypto",
    };
  }

  const instrument = await resolveInstrument(ctx, symbol);
  if (instrument.route === "exchange" && ctx.exchange) {
    return {
      client: ctx.exchange,
      normalizedSymbol: instrument.normalizedSymbol,
      marketFamily: "crypto",
    };
  }

  if (instrument.route === "broker" && ctx.broker && ctx.broker.capabilities.supportsHistoricalBars) {
    return {
      client: ctx.broker,
      normalizedSymbol: instrument.normalizedSymbol,
      marketFamily: "stocks",
    };
  }

  throw new Error(errors.noDataClient.error);
}

async function fetchRangeViaDataset(
  exchange: Exchange,
  normalizedSymbol: string,
  timeframe: string,
  startTime: number,
  endTime: number,
): Promise<{ data: OHLC[]; metadata: HistoricalFetchMetadata } | null> {
  const fetchStart = Date.now();
  try {
    const candles = await ensureDataset({
      exchange,
      symbol: normalizedSymbol,
      timeframe,
      since: startTime,
      until: endTime,
    });
    if (candles.length === 0) return null;
    const data: OHLC[] = candles.map((c) => ({
      timestamp: c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    return {
      data,
      metadata: {
        symbol: normalizedSymbol,
        timeframe,
        startTime,
        endTime,
        candleCount: data.length,
        sourceId: exchange.exchangeId,
        sourceKind: "cache",
        marketFamily: "crypto",
        fetchTimeMs: Date.now() - fetchStart,
        fromCache: true,
      },
    };
  } catch {
    // Deep-history backfill failed (network, venue cap) — let the caller
    // fall back to the legacy DataSourceManager shallow-window path.
    return null;
  }
}

async function fetchHistoricalSeries(
  ctx: ReturnType<typeof getGordonContext>,
  params: {
    symbol: string;
    timeframe: string;
    market?: HistoricalMarket;
    days?: number;
    startTime?: number;
    endTime?: number;
  },
): Promise<{ data: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>; metadata: HistoricalFetchMetadata }> {
  const selection = await resolveHistoricalClient(ctx, params.symbol, params.market);

  if (params.startTime !== undefined && params.endTime !== undefined) {
    // Dataset-first: for a crypto exchange + calendar range, read what's
    // already persisted in the ohlcvCache and backfill ONLY the missing
    // sub-range(s) via the paginated deep-history ingester — instead of a
    // shallow getCandles(limit) window. Falls back to the legacy
    // DataSourceManager path if the cache yields nothing (e.g. an exchange
    // whose deep history is unavailable).
    if (selection.marketFamily === "crypto") {
      const datasetResult = await fetchRangeViaDataset(
        selection.client as Exchange,
        selection.normalizedSymbol,
        params.timeframe,
        params.startTime,
        params.endTime,
      );
      if (datasetResult && datasetResult.data.length > 0) {
        return datasetResult;
      }
    }
    const result = await fetchHistoricalDataRangeWithMetadata(
      selection.client,
      selection.normalizedSymbol,
      params.timeframe,
      params.startTime,
      params.endTime,
    );
    return result;
  }

  const result = await fetchHistoricalDataWithMetadata(
    selection.client,
    selection.normalizedSymbol,
    params.timeframe,
    params.days ?? 90,
  );
  return result;
}

function buildBacktestConfig(
  strategyId: string,
  symbol: string,
  timeframe: string,
  days: number,
  initialCapital: number,
  commissionRate: number,
  realism: ReturnType<typeof buildSimulationRealismProfile>,
): BacktestConfig {
  return {
    strategyId,
    symbol,
    timeframe,
    days,
    initialCapital,
    positionSizePercent: (DEFAULT_BACKTEST_CONFIG.positionSizePercent ?? 10),
    compounding: DEFAULT_BACKTEST_CONFIG.compounding ?? false,
    feePercent: commissionRate * 100,
    slippagePercent: DEFAULT_BACKTEST_CONFIG.slippagePercent ?? 0.05,
    simulationProfile: realism.profile,
    executionLagBars: realism.executionLagBars,
    spreadBps: realism.spreadBps,
    marketImpactBps: realism.marketImpactBps,
  };
}

function buildEngineParams(
  initialCapital: number,
  commissionRate: number,
  realism: ReturnType<typeof buildSimulationRealismProfile>,
) {
  return {
    initialCapital,
    commissionRate,
    slippageRate: (DEFAULT_BACKTEST_CONFIG.slippagePercent ?? 0.05) / 100,
    executionLagBars: realism.executionLagBars,
    spreadRate: realism.spreadBps / 10000,
    marketImpactRate: realism.marketImpactBps / 10000,
  };
}

function buildBacktestResult(
  strategy: Strategy,
  config: BacktestConfig,
  engineResult: ReturnType<typeof runBacktest>,
  executionTime: number
): BacktestResult {
  const trades: BacktestTrade[] = engineResult.trades.map((trade) => ({
    id: trade.id,
    entryTime: new Date(trade.entryTime).toISOString(),
    exitTime: new Date(trade.exitTime).toISOString(),
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    quantity: trade.quantity,
    positionValue: trade.entryPrice * trade.quantity,
    side: trade.side,
    pnl: trade.netPnL,
    pnlPercent: trade.returnPct,
    fees: trade.commission,
    exitReason: mapExitReason(trade.exitReason),
  }));

  return {
    id: `bt_${Date.now()}`,
    strategyName: strategy.name,
    config,
    metrics: engineResult.metrics,
    trades,
    equityCurve: engineResult.equityCurve.map((point) => ({
      timestamp: point.timestamp,
      equity: point.equity,
    })),
    drawdownCurve: engineResult.equityCurve.map((point) => ({
      timestamp: point.timestamp,
      drawdown: point.drawdownPct,
    })),
    startDate: new Date(engineResult.startDate).toISOString(),
    endDate: new Date(engineResult.endDate).toISOString(),
    executionTime,
    createdAt: new Date().toISOString(),
    warnings: [],
  };
}

// ============================================================================
// Backtest Result Schema
// ============================================================================

const backtestMetricsSchema = z.object({
  totalReturn: z.number(),
  annualizedReturn: z.number(),
  cagr: z.number(),
  maxDrawdown: z.number(),
  sharpeRatio: z.number(),
  sortinoRatio: z.number(),
  volatility: z.number(),
  calmarRatio: z.number(),
  totalTrades: z.number(),
  winningTrades: z.number(),
  losingTrades: z.number(),
  winRate: z.number(),
  profitFactor: z.number(),
  averageTrade: z.number(),
  averageWin: z.number(),
  averageLoss: z.number(),
  expectancy: z.number(),
  maxConsecutiveWins: z.number(),
  maxConsecutiveLosses: z.number(),
  initialValue: z.number(),
  finalValue: z.number(),
  totalPnl: z.number(),
  netProfit: z.number(),
  totalFees: z.number(),
  avgTradeDuration: z.number(),
  maxDrawdownDuration: z.number(),
});

const backtestTradeSchema = z.object({
  id: z.string(),
  entryTime: z.string(),
  exitTime: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  quantity: z.number(),
  positionValue: z.number(),
  side: z.enum(["LONG", "SHORT"]),
  pnl: z.number(),
  pnlPercent: z.number(),
  fees: z.number(),
  exitReason: z.enum(["TP1", "TP2", "TP3", "STOP", "SIGNAL", "END_OF_TEST"]),
  entrySignals: z.record(z.string(), z.unknown()).optional(),
});

const backtestConfigSchema = z.object({
  strategyId: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  days: z.number(),
  initialCapital: z.number(),
  positionSizePercent: z.number(),
  compounding: z.boolean(),
  feePercent: z.number(),
  slippagePercent: z.number(),
});

const backtestResultSchema = z.object({
  id: z.string(),
  strategyName: z.string(),
  config: backtestConfigSchema,
  metrics: backtestMetricsSchema,
  trades: z.array(backtestTradeSchema),
  equityCurve: z.array(z.object({
    timestamp: z.number(),
    equity: z.number(),
  })),
  drawdownCurve: z.array(z.object({
    timestamp: z.number(),
    drawdown: z.number(),
  })),
  startDate: z.string(),
  endDate: z.string(),
  executionTime: z.number(),
  createdAt: z.string(),
  warnings: z.array(z.string()),
  systematic: z.object({
    datasetId: z.string(),
    datasetSnapshotId: z.string().optional(),
    validationId: z.string().optional(),
    researchExperimentId: z.string().optional(),
    sourceId: z.string(),
    sourceKind: z.enum(["exchange", "broker", "cache"]),
    marketFamily: z.enum(["crypto", "stocks"]),
    quality: z.object({
      qualityScore: z.number(),
      coveragePercent: z.number(),
      expectedCandles: z.number(),
      actualCandles: z.number(),
      gapCount: z.number(),
      duplicateCount: z.number(),
      stale: z.boolean(),
      warnings: z.array(z.string()),
    }),
  }).optional(),
});

const ohlcSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

// ============================================================================
// Run Backtest Tool
// ============================================================================

export const runBacktestTool = createTool({
  id: "run_backtest",
  description:
    "Run a backtest for a strategy on historical data. Returns performance metrics " +
    "including total return, win rate, Sharpe ratio, max drawdown, and individual trade details. " +
    "Use when the user asks to 'backtest X strategy', 'test how X would perform', " +
    "or 'simulate X strategy on historical data'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    strategyId: z.string().describe("Strategy ID (e.g., 'support_bounce')"),
    market: z.enum(["auto", "crypto", "stocks"]).default("auto").describe("Market family to backtest against"),
    timeframe: z.string().default("4h").describe("Candle timeframe"),
    days: z.number().default(90).describe("Number of days to backtest. Ignored when startTime/endTime are set."),
    startTime: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Window start in epoch milliseconds. Pair with endTime for a calendar-bounded backtest (overrides days)."),
    endTime: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Window end in epoch milliseconds. Pair with startTime."),
    initialCapital: z.number().default(10000).describe("Starting capital in USDT"),
    commission: z.number().default(0.001).describe("Commission rate (0.001 = 0.1%)"),
  }),
  outputSchema: z.object({
    result: backtestResultSchema.optional(),
    summary: z.string().optional(),
    formattedSummary: z.string().optional(),
    operatorReport: operatorReportSchema.optional(),
    savedResultId: z.string().optional(),
    validationStatus: z.enum(["passed", "warning", "failed"]).optional(),
    validationScore: z.number().optional(),
    liveEligible: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, strategyId, market, timeframe, days, startTime, endTime, initialCapital, commission },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);

    const strategy = strategyRegistry.get(strategyId as StrategyId);
    if (!strategy) {
      return errors.strategyNotFound(strategyId);
    }

    try {
      const executionStart = Date.now();
      const realism = buildSimulationRealismProfile(ctx?.config);

      // Calendar-bounded backtest takes precedence over days; if start/end are
      // provided, fetch the range and recompute `days` for downstream metadata
      // / config so they stay coherent.
      const useDateRange = typeof startTime === "number" && typeof endTime === "number";
      const effectiveDays = useDateRange
        ? Math.max(1, Math.floor((endTime - startTime) / (24 * 60 * 60 * 1000)))
        : days;

      const { data: ohlcData, metadata } = await fetchHistoricalSeries(ctx, {
        symbol,
        timeframe,
        market,
        ...(useDateRange ? { startTime, endTime } : { days }),
      });

      if (ohlcData.length < 100) {
        return errors.insufficientData(metadata.symbol);
      }

      const backtestConfig = buildBacktestConfig(
        strategyId,
        metadata.symbol,
        timeframe,
        effectiveDays,
        initialCapital,
        commission,
        realism,
      );

      const engineParams = buildEngineParams(initialCapital, commission, realism);

      const engineResult = runBacktest(strategy, ohlcData, engineParams);
      const enrichment = await enrichBacktestResult(engineResult);
      const executionTime = Date.now() - executionStart;

      const result = buildBacktestResult(strategy, backtestConfig, engineResult, executionTime);
      const systematic = await processSystematicBacktest({
        strategyId,
        strategyName: strategy.name,
        strategy,
        candles: ohlcData,
        backtestResult: result,
        fetchMetadata: metadata,
        config: ctx?.config,
      });
      result.systematic = {
        datasetId: systematic.dataset.datasetId,
        datasetSnapshotId: systematic.snapshot?.snapshotId,
        validationId: systematic.validation.validationId,
        researchExperimentId: systematic.experiment?.experimentId,
        sourceId: metadata.sourceId,
        sourceKind: metadata.sourceKind,
        marketFamily: metadata.marketFamily,
        quality: systematic.dataset.quality,
        realism,
      };

      const saveResult = saveBacktestResult(result);
      getAuditLogger(ctx?.userId || "system").success("SYSTEMATIC_VALIDATION", {
        strategyId,
        symbol: metadata.symbol,
        marketFamily: metadata.marketFamily,
      }, {
        metadata: {
          validationStatus: systematic.validation.status,
          validationScore: systematic.validation.score,
          liveEligible: systematic.validation.liveEligible,
          datasetId: systematic.dataset.datasetId,
        },
      });
      const summary = [
        formatBacktestSummary(result),
        ...enrichment.summaryLines,
      ].join("\n");
      const operatorReport = buildBacktestOperatorReport({
        strategyName: strategy.name,
        symbol: metadata.symbol,
        timeframe,
        days,
        executionTime,
        result,
        validation: systematic.validation,
        profile: systematic.profile,
        biasDiagnostics: systematic.validation.biasDiagnostics,
      });
      const formattedSummary = formatOperatorReport(operatorReport);

      return {
        result,
        summary,
        formattedSummary,
        operatorReport,
        savedResultId: saveResult.id ?? result.id,
        validationStatus: systematic.validation.status,
        validationScore: systematic.validation.score,
        liveEligible: systematic.validation.liveEligible,
      };
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "SYSTEMATIC_VALIDATION",
        { strategyId, symbol, market },
        error instanceof Error ? error.message : "Backtest execution failed",
      );
      return {
        error: error instanceof Error ? error.message : "Backtest execution failed",
      };
    }
  },
});

// ============================================================================
// Optimize Strategy Tool
// ============================================================================

export const optimizeStrategyTool = createTool({
  id: "optimize_strategy",
  description:
    "Optimize strategy parameters using grid search to find the best configuration. " +
    "Use when the user asks to 'optimize X strategy', 'find best parameters', " +
    "or 'tune strategy settings'.",
  inputSchema: z.object({
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETH')"),
    market: z
      .enum(["auto", "crypto", "stocks"])
      .default("auto")
      .describe("Market family to source candles from"),
    strategyId: z
      .string()
      .describe("Strategy ID to optimize"),
    timeframe: z
      .string()
      .default("4h")
      .describe("Candle timeframe for analysis"),
    parameterRanges: z
      .record(z.string(), z.array(z.number()))
      .describe("Parameters to optimize with their value ranges (e.g., { 'period': [10, 14, 20] })"),
    optimizeFor: z
      .enum(["sharpe", "return", "winRate", "drawdown"])
      .default("sharpe")
      .describe("Metric to optimize for"),
    maxIterations: z
      .number()
      .default(50)
      .describe("Maximum number of parameter combinations to test"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    strategy: z.string().optional(),
    optimizedFor: z.string().optional(),
    formattedSummary: z.string().optional(),
    operatorReport: operatorReportSchema.optional(),
    bestParameters: z.record(z.string(), z.unknown()).optional(),
    bestMetrics: backtestMetricsSchema.optional(),
    iterationsTested: z.number().optional(),
    allResults: z.array(z.object({
      parameters: z.record(z.string(), z.unknown()),
      metrics: backtestMetricsSchema,
      score: z.number(),
    })).optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, market, strategyId, timeframe, parameterRanges, optimizeFor, maxIterations },
    execContext: MastraExecutionContext
    ) => {
    try {
      const ctx = getGordonContext(execContext);
      const realism = buildSimulationRealismProfile(ctx?.config);
      const strategy = strategyRegistry.get(strategyId as StrategyId);
      if (!strategy) {
        return { error: errors.strategyNotFound(strategyId).error };
      }

      const warnings: string[] = [];
      const { data: ohlcData, metadata } = await fetchHistoricalSeries(ctx, {
        symbol,
        timeframe,
        market,
        days: 90,
      });

      if (ohlcData.length < 100) {
        return { error: errors.insufficientData(metadata.symbol).error };
      }

      const metricKeyMap: Record<string, keyof BacktestMetrics> = {
        sharpe: "sharpeRatio",
        return: "totalReturn",
        winRate: "winRate",
        drawdown: "maxDrawdown",
      };

      const metricKey = metricKeyMap[optimizeFor] ?? "sharpeRatio";

      const paramNames = Object.keys(parameterRanges);
      const combinations: Array<Record<string, number>> = [];

      function generateCombinations(index: number, current: Record<string, number>) {
        if (index === paramNames.length) {
          combinations.push({ ...current });
          return;
        }
        const paramName = paramNames[index]!;
        for (const value of parameterRanges[paramName]!) {
          current[paramName] = value;
          generateCombinations(index + 1, current);
        }
      }

      generateCombinations(0, {});

      const testCombinations = combinations.slice(0, maxIterations);
      if (combinations.length > maxIterations) {
        warnings.push(`Testing ${maxIterations} of ${combinations.length} possible combinations.`);
      }

      const allResults: Array<{
        parameters: Record<string, number>;
        metrics: BacktestMetrics;
        score: number;
      }> = [];

      const engineParams = buildEngineParams(DEFAULT_BACKTEST_CONFIG.initialCapital, 0.001, realism);

      for (const params of testCombinations) {
        const result = runBacktest(strategy, ohlcData, engineParams, params);
        const metricValue = (result.metrics[metricKey] as number) ?? 0;
        const score = metricKey === "maxDrawdown" ? -metricValue : metricValue;

        allResults.push({
          parameters: params,
          metrics: result.metrics,
          score,
        });
      }

      allResults.sort((a, b) => b.score - a.score);
      const best = allResults[0];
      const overfitSummary = allResults.length > 1
        ? detectOverfitting(
            allResults.map((result) => ({
              parameters: result.parameters,
              metrics: result.metrics,
              score: result.score,
            })),
            { metric: metricKey },
          )
        : undefined;
      const operatorReport = buildOptimizationOperatorReport({
        strategyName: strategy.name,
        symbol: metadata.symbol,
        timeframe,
        optimizeFor,
        warnings,
        rankedResults: allResults,
        overfitSummary: overfitSummary
          ? {
              overfitScore: overfitSummary.overfitScore,
              severity: overfitSummary.severity,
              isLikelyOverfit: overfitSummary.isLikelyOverfit,
            }
          : undefined,
      });
      const formattedSummary = formatOperatorReport(operatorReport);

      return {
        symbol: metadata.symbol,
        strategy: strategy.name,
        optimizedFor: optimizeFor,
        formattedSummary,
        operatorReport,
        bestParameters: best?.parameters ?? {},
        bestMetrics: best?.metrics,
        iterationsTested: testCombinations.length,
        allResults,
        warnings,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Strategy optimization failed",
      };
    }
  },
});

// ============================================================================
// Compare Backtests Tool
// ============================================================================

export const compareBacktestsTool = createTool({
  id: "compare_backtests",
  description:
    "Compare multiple strategies on the same symbol and time period. " +
    "Use when the user asks to 'compare strategies', 'which strategy is better', " +
    "or 'rank strategies for X coin'.",
  inputSchema: z.object({
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETH')"),
    market: z
      .enum(["auto", "crypto", "stocks"])
      .default("auto")
      .describe("Market family to source candles from"),
    strategyIds: z
      .array(z.string())
      .describe("List of strategy IDs to compare"),
    timeframe: z
      .string()
      .default("4h")
      .describe("Candle timeframe for analysis"),
    startDate: z
      .string()
      .optional()
      .describe("Comparison start date (ISO format)"),
    endDate: z
      .string()
      .optional()
      .describe("Comparison end date (ISO format)"),
    rankBy: z
      .enum(["sharpe", "return", "winRate", "drawdown"])
      .default("sharpe")
      .describe("Metric to rank strategies by"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    timeframe: z.string().optional(),
    period: z.object({
      startDate: z.string(),
      endDate: z.string(),
      days: z.number(),
    }).optional(),
    rankedBy: z.string().optional(),
    rankings: z.array(z.object({
      rank: z.number(),
      strategy: z.string(),
      strategyId: z.string(),
      metrics: backtestMetricsSchema,
      score: z.number(),
    })).optional(),
    buyAndHold: z.object({
      totalReturn: z.number(),
      maxDrawdown: z.number(),
    }).optional(),
    executionTime: z.number().optional(),
    formattedSummary: z.string().optional(),
    operatorReport: operatorReportSchema.optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, market, strategyIds, timeframe, startDate, endDate, rankBy },
    execContext: MastraExecutionContext
    ) => {
    try {
      const ctx = getGordonContext(execContext);
      const realism = buildSimulationRealismProfile(ctx?.config);
      const comparisonStartTime = Date.now();
      const warnings: string[] = [];

      const metricKeyMap: Record<string, keyof BacktestMetrics> = {
        sharpe: "sharpeRatio",
        return: "totalReturn",
        winRate: "winRate",
        drawdown: "maxDrawdown",
      };

      const metricKey = metricKeyMap[rankBy] ?? "sharpeRatio";

      const validStrategies: Strategy[] = [];
      for (const id of strategyIds) {
        const found = strategyRegistry.get(id as StrategyId);
        if (found) {
          validStrategies.push(found);
        } else {
          warnings.push(`Strategy '${id}' not found and will be skipped.`);
        }
      }

      if (validStrategies.length === 0) {
        return { error: "No valid strategies to compare." };
      }

      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
      const periodDays = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
      );

      const { data: ohlcData, metadata } = await fetchHistoricalSeries(ctx, {
        symbol,
        timeframe,
        market,
        startTime: startDate || endDate ? start.getTime() : undefined,
        endTime: startDate || endDate ? end.getTime() : undefined,
        days: periodDays,
      });

      if (ohlcData.length < 100) {
        return { error: errors.insufficientData(metadata.symbol).error };
      }

      const engineParams = buildEngineParams(DEFAULT_BACKTEST_CONFIG.initialCapital, 0.001, realism);

      const results: BacktestResult[] = [];
      for (const strat of validStrategies) {
        const execStart = Date.now();
        const config = buildBacktestConfig(
          strat.id,
          metadata.symbol,
          timeframe,
          periodDays,
          engineParams.initialCapital,
          engineParams.commissionRate,
          realism,
        );
        const engineResult = runBacktest(strat, ohlcData, engineParams);
        const backtestResult = buildBacktestResult(
          strat,
          config,
          engineResult,
          Date.now() - execStart
        );
        results.push(backtestResult);
      }

      const comparison = compareBacktestResults(results, metricKey);

      const rankings = comparison.comparisonTable.map((row, index) => ({
        rank: index + 1,
        strategy: row.strategy as string,
        strategyId: (row.result as BacktestResult)?.config.strategyId ?? "unknown",
        metrics: row.metrics as BacktestMetrics,
        score: (() => {
          const metrics = row.metrics as BacktestMetrics;
          if (!metrics) return 0;
          const value = metrics[metricKey] as number;
          return metricKey === "maxDrawdown" ? -value : value;
        })(),
      }));

      const firstClose = ohlcData[0]?.close ?? 0;
      const lastClose = ohlcData[ohlcData.length - 1]?.close ?? 0;
      let buyHoldReturn = 0;
      let buyHoldMaxDrawdown = 0;
      if (firstClose > 0) {
        buyHoldReturn = ((lastClose - firstClose) / firstClose) * 100;
        let peak = firstClose;
        for (const bar of ohlcData) {
          if (bar.close > peak) {
            peak = bar.close;
          }
          const drawdown = ((peak - bar.close) / peak) * 100;
          buyHoldMaxDrawdown = Math.max(buyHoldMaxDrawdown, drawdown);
        }
      }

      const comparisonExecutionTime = Date.now() - comparisonStartTime;
      const operatorReport = buildComparisonOperatorReport({
        symbol: metadata.symbol,
        timeframe,
        rankBy,
        rankings,
        buyAndHold: {
          totalReturn: buyHoldReturn,
          maxDrawdown: buyHoldMaxDrawdown,
        },
      });
      const formattedSummary = formatOperatorReport(operatorReport);

      return {
        symbol: metadata.symbol,
        timeframe,
        period: {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          days: periodDays,
        },
        rankedBy: rankBy,
        rankings,
        buyAndHold: {
          totalReturn: buyHoldReturn,
          maxDrawdown: buyHoldMaxDrawdown,
        },
        executionTime: comparisonExecutionTime,
        formattedSummary,
        operatorReport,
        warnings,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Strategy comparison failed",
      };
    }
  },
});

// ============================================================================
// Get Backtest Summary Tool
// ============================================================================

export const getBacktestSummaryTool = createTool({
  id: "get_backtest_summary",
  description:
    "Get a human-readable summary of backtest results with insights. " +
    "Use after running a backtest to explain results to the user.",
  inputSchema: z.object({
    backtestResult: backtestResultSchema.describe("The backtest result to summarize"),
  }),
  outputSchema: z.object({
    summary: z.string().optional(),
    verdict: z.enum(["excellent", "good", "fair", "poor", "avoid"]).optional(),
    strengths: z.array(z.string()).optional(),
    weaknesses: z.array(z.string()).optional(),
    recommendations: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ backtestResult }) => {
    const metrics = backtestResult.metrics;
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Analyze total return
    if (metrics.totalReturn > 50) {
      strengths.push(`Strong total return of ${metrics.totalReturn}%`);
    } else if (metrics.totalReturn > 20) {
      strengths.push(`Decent total return of ${metrics.totalReturn}%`);
    } else if (metrics.totalReturn < 0) {
      weaknesses.push(`Negative total return of ${metrics.totalReturn}%`);
    }

    // Analyze Sharpe ratio
    if (metrics.sharpeRatio !== null) {
      if (metrics.sharpeRatio > 2) {
        strengths.push(`Excellent risk-adjusted returns (Sharpe: ${metrics.sharpeRatio})`);
      } else if (metrics.sharpeRatio > 1) {
        strengths.push(`Good risk-adjusted returns (Sharpe: ${metrics.sharpeRatio})`);
      } else if (metrics.sharpeRatio < 0.5) {
        weaknesses.push(`Poor risk-adjusted returns (Sharpe: ${metrics.sharpeRatio})`);
        recommendations.push("Consider strategies with better risk-adjusted returns");
      }
    }

    // Analyze max drawdown
    if (metrics.maxDrawdown < 10) {
      strengths.push(`Low maximum drawdown of ${metrics.maxDrawdown}%`);
    } else if (metrics.maxDrawdown > 30) {
      weaknesses.push(`High maximum drawdown of ${metrics.maxDrawdown}%`);
      recommendations.push("Consider tighter stop-losses to reduce drawdown");
    }

    // Analyze win rate
    if (metrics.winRate !== null) {
      if (metrics.winRate > 60) {
        strengths.push(`High win rate of ${metrics.winRate}%`);
      } else if (metrics.winRate < 40) {
        weaknesses.push(`Low win rate of ${metrics.winRate}%`);
      }
    }

    // Analyze trade count
    if (metrics.totalTrades < 10) {
      weaknesses.push(`Very few trades (${metrics.totalTrades}) - results may not be statistically significant`);
      recommendations.push("Run backtest over a longer period for more trades");
    }

    // Determine verdict
    let verdict: "excellent" | "good" | "fair" | "poor" | "avoid";
    const score = (metrics.sharpeRatio || 0) * 0.4 +
      (metrics.totalReturn / 50) * 0.3 +
      ((100 - metrics.maxDrawdown) / 100) * 0.2 +
      ((metrics.winRate || 50) / 100) * 0.1;

    if (score > 1.5) verdict = "excellent";
    else if (score > 1) verdict = "good";
    else if (score > 0.5) verdict = "fair";
    else if (score > 0) verdict = "poor";
    else verdict = "avoid";

    // Generate summary
    const summary = `${backtestResult.strategyName} on ${backtestResult.config.symbol} (${backtestResult.config.timeframe}): ` +
      `${metrics.totalReturn.toFixed(2)}% return over ${backtestResult.config.days} days with ` +
      `${metrics.totalTrades} trades. ` +
      `Sharpe ratio: ${metrics.sharpeRatio.toFixed(2)}. ` +
      `Max drawdown: ${metrics.maxDrawdown.toFixed(2)}%. ` +
      `Win rate: ${metrics.winRate.toFixed(2)}%.`;

    // Add disclaimer
    recommendations.push("Past performance does not guarantee future results");
    if (backtestResult.config.days < 90) {
      recommendations.push("Consider testing over a longer period (90+ days)");
    }

    return {
      summary,
      verdict,
      strengths: strengths.length > 0 ? strengths : undefined,
      weaknesses: weaknesses.length > 0 ? weaknesses : undefined,
      recommendations,
    };
  },
});

// ============================================================================
// Analysis & Utility Tools (MCP parity)
// ============================================================================

export const analyzeBacktestResultsTool = createTool({
  id: "analyze_backtest_results",
  description: "Analyze a single backtest result comprehensively.",
  inputSchema: z.object({
    result: backtestResultSchema,
  }),
  outputSchema: z.object({
    analysis: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ result }) => {
    return { analysis: analyzeBacktestResult(result) as unknown as Record<string, unknown> };
  },
});

export const compareBacktestResultsTool = createTool({
  id: "compare_backtest_results",
  description: "Compare multiple backtest results and rank them.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    sortBy: z.string().default("totalReturn"),
  }),
  outputSchema: z.object({
    comparison: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, sortBy }) => {
    if (results.length === 0) {
      return { error: "No results provided." };
    }

    const metricKey = (sortBy in results[0]!.metrics ? sortBy : "totalReturn") as keyof BacktestMetrics;
    return { comparison: compareBacktestResults(results, metricKey) };
  },
});

export const rankStrategiesByMetricTool = createTool({
  id: "rank_strategies_by_metric",
  description: "Rank strategies by a specific metric.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    metric: z.string().default("totalReturn"),
  }),
  outputSchema: z.object({
    rankings: z.array(z.object({
      strategy: z.string(),
      value: z.number(),
      rank: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, metric }) => {
    if (results.length === 0) {
      return { error: "No results provided." };
    }
    const metricKey = (metric in results[0]!.metrics ? metric : "totalReturn") as keyof BacktestMetrics;
    return { rankings: rankStrategiesByMetric(results, metricKey) };
  },
});

export const findBestStrategyTool = createTool({
  id: "find_best_strategy",
  description: "Find the best performing strategy by a specific metric.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    metric: z.string().default("totalReturn"),
  }),
  outputSchema: z.object({
    best: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, metric }) => {
    if (results.length === 0) {
      return { error: "No results provided." };
    }
    const metricKey = (metric in results[0]!.metrics ? metric : "totalReturn") as keyof BacktestMetrics;
    return { best: findBestStrategy(results, metricKey) };
  },
});

// ============================================================================
// Reporting & Export Tools
// ============================================================================

export const exportResultsJsonTool = createTool({
  id: "export_results_json",
  description: "Export backtest results to a JSON file.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    filepath: z.string(),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filepath: z.string().optional(),
    numResults: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, filepath }) => exportResultsJson(results, filepath),
});

export const exportResultsCsvTool = createTool({
  id: "export_results_csv",
  description: "Export backtest results to a CSV file.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    filepath: z.string(),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filepath: z.string().optional(),
    numResults: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, filepath }) => exportResultsCsv(results, filepath),
});

export const generateHtmlReportTool = createTool({
  id: "generate_html_report",
  description: "Generate an HTML report for backtest results.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    filepath: z.string(),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filepath: z.string().optional(),
    numResults: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, filepath }) => generateHtmlReport(results, filepath),
});

// ============================================================================
// Data Filtering Tools
// ============================================================================

export const filterExcludeMonthsTool = createTool({
  id: "filter_exclude_months",
  description: "Filter OHLC data to exclude a range of months.",
  inputSchema: z.object({
    ohlcData: z.array(ohlcSchema),
    startMonth: z.number().default(5),
    endMonth: z.number().default(9),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filteredData: z.array(ohlcSchema).optional(),
    originalRows: z.number().optional(),
    filteredRows: z.number().optional(),
    rowsRemoved: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ohlcData, startMonth, endMonth }) => {
    return filterExcludeMonths(ohlcData, startMonth, endMonth);
  },
});

export const filterMarketHoursTool = createTool({
  id: "filter_market_hours",
  description: "Filter OHLC data into market hours and non-market hours (weekdays only, UTC).",
  inputSchema: z.object({
    ohlcData: z.array(ohlcSchema),
    openTimeStr: z.string().default("13:30"),
    closeTimeStr: z.string().default("20:00"),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    marketHoursData: z.array(ohlcSchema).optional(),
    nonMarketHoursData: z.array(ohlcSchema).optional(),
    marketHoursRows: z.number().optional(),
    nonMarketHoursRows: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ohlcData, openTimeStr, closeTimeStr }) => {
    return filterMarketHours(ohlcData, openTimeStr, closeTimeStr);
  },
});

export const filterFirstLastHourTool = createTool({
  id: "filter_first_last_hour",
  description: "Filter OHLC data for first and last hour of trading (weekdays only, UTC).",
  inputSchema: z.object({
    ohlcData: z.array(ohlcSchema),
    marketOpenStr: z.string().default("13:30"),
    oneHourAfterOpenStr: z.string().default("14:30"),
    oneHourBeforeCloseStr: z.string().default("19:00"),
    marketCloseStr: z.string().default("20:00"),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filteredData: z.array(ohlcSchema).optional(),
    originalRows: z.number().optional(),
    filteredRows: z.number().optional(),
    rowsRemoved: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ohlcData, marketOpenStr, oneHourAfterOpenStr, oneHourBeforeCloseStr, marketCloseStr }) => {
    return filterFirstLastHour(ohlcData, marketOpenStr, oneHourAfterOpenStr, oneHourBeforeCloseStr, marketCloseStr);
  },
});

// ============================================================================
// Alpha Decay Tool
// ============================================================================

export const analyzeAlphaDecayTool = createTool({
  id: "analyze_alpha_decay",
  description: "Analyze how performance degrades with entry delays.",
  inputSchema: z.object({
    results: z.record(z.string(), z.record(z.string(), z.unknown())),
    metric: z.string().default("return_pct"),
  }),
  outputSchema: z.object({
    analysis: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, metric }) => {
    const parsed: Record<number, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(results)) {
      const delay = Number(key);
      if (!Number.isNaN(delay) && value && typeof value === "object") {
        parsed[delay] = value as Record<string, unknown>;
      }
    }

    const analysis = analyzeAlphaDecay(parsed, metric);
    if ("error" in analysis) {
      return { error: analysis.error };
    }
    return { analysis: analysis as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Plotting Tool
// ============================================================================

export const generateBacktestChartTool = createTool({
  id: "generate_backtest_chart",
  description: "Generate an ASCII chart for backtest visualization.",
  inputSchema: z.object({
    ohlcData: z.array(ohlcSchema),
    stats: z.object({
      equityCurve: z.array(z.number()).optional(),
    }).optional(),
    title: z.string().default("Backtest Result"),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    chart: z.string().optional(),
    title: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ohlcData, stats, title }) => {
    return generateBacktestChart(ohlcData, stats ?? {}, title);
  },
});

// ============================================================================
// Optimization Utilities (MCP parity)
// ============================================================================

export const gridSearchOptimizationTool = createTool({
  id: "grid_search_optimization",
  description: "Perform grid search optimization on precomputed backtest results.",
  inputSchema: z.object({
    param_grid: z.record(z.string(), z.array(z.unknown())),
    backtest_results: z.array(z.object({
      params: z.record(z.string(), z.unknown()),
      stats: z.record(z.string(), z.unknown()),
    })),
    metric: z.string().default("sharpe_ratio"),
    constraint_func_code: z.string().optional(),
  }),
  outputSchema: z.object({
    best_params: z.record(z.string(), z.unknown()).optional(),
    best_metric: z.number().optional(),
    best_stats: z.record(z.string(), z.unknown()).optional(),
    rank: z.number().optional(),
    total_combinations_tested: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ param_grid, backtest_results, metric, constraint_func_code }) => {
    if (constraint_func_code) {
      return { error: "constraint_func_code is not supported in TS implementation." };
    }

    const paramNames = Object.keys(param_grid);
    const combinations: Array<Record<string, unknown>> = [];

    function generateCombinations(index: number, current: Record<string, unknown>) {
      if (index === paramNames.length) {
        combinations.push({ ...current });
        return;
      }
      const paramName = paramNames[index]!;
      const values = param_grid[paramName]!;
      for (const value of values) {
        current[paramName] = value;
        generateCombinations(index + 1, current);
      }
    }

    generateCombinations(0, {});

    let bestParams: Record<string, unknown> | null = null;
    let bestMetric = -Infinity;
    let bestStats: Record<string, unknown> | null = null;
    let rank = 0;

    for (const params of combinations) {
      const match = backtest_results.find((result) => {
        const resultParams = result.params ?? {};
        return Object.entries(params).every(([key, value]) => resultParams[key] === value);
      });
      const stats = match?.stats ?? {};
      const value = typeof stats[metric] === "number" ? (stats[metric] as number) : -Infinity;

      if (value > bestMetric) {
        bestMetric = value;
        bestParams = params;
        bestStats = stats;
      }
    }

    if (!bestParams || !bestStats || bestMetric === -Infinity) {
      return { error: "No valid results found." };
    }

    rank = 1;

    return {
      best_params: bestParams,
      best_metric: bestMetric,
      best_stats: bestStats,
      rank,
      total_combinations_tested: combinations.length,
    };
  },
});

export const randomSearchOptimizationTool = createTool({
  id: "random_search_optimization",
  description: "Perform random search optimization on precomputed backtest results.",
  inputSchema: z.object({
    param_distributions: z.record(z.string(), z.unknown()),
    backtest_results: z.array(z.object({
      params: z.record(z.string(), z.unknown()),
      stats: z.record(z.string(), z.unknown()),
    })),
    n_iter: z.number().default(50),
    metric: z.string().default("sharpe_ratio"),
  }),
  outputSchema: z.object({
    best_params: z.record(z.string(), z.unknown()).optional(),
    best_metric: z.number().optional(),
    best_stats: z.record(z.string(), z.unknown()).optional(),
    rank: z.number().optional(),
    total_iterations: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ param_distributions, backtest_results, n_iter, metric }) => {
    const sampleParam = (dist: unknown): unknown => {
      if (Array.isArray(dist)) {
        if (dist.length === 2 && typeof dist[0] === "number" && typeof dist[1] === "number") {
          const min = dist[0];
          const max = dist[1];
          return min + Math.random() * (max - min);
        }
        return dist[Math.floor(Math.random() * dist.length)];
      }
      return dist;
    };

    let bestParams: Record<string, unknown> | null = null;
    let bestMetric = -Infinity;
    let bestStats: Record<string, unknown> | null = null;

    for (let i = 0; i < n_iter; i++) {
      const params: Record<string, unknown> = {};
      for (const [key, dist] of Object.entries(param_distributions)) {
        params[key] = sampleParam(dist);
      }

      const match = backtest_results.find((result) => {
        const resultParams = result.params ?? {};
        return Object.entries(params).every(([key, value]) => resultParams[key] === value);
      });

      const stats = match?.stats ?? {};
      const value = typeof stats[metric] === "number" ? (stats[metric] as number) : -Infinity;

      if (value > bestMetric) {
        bestMetric = value;
        bestParams = params;
        bestStats = stats;
      }
    }

    if (!bestParams || !bestStats || bestMetric === -Infinity) {
      return { error: "No valid results found." };
    }

    return {
      best_params: bestParams,
      best_metric: bestMetric,
      best_stats: bestStats,
      rank: 1,
      total_iterations: n_iter,
    };
  },
});

// ============================================================================
// Walk-Forward Testing Tool
// ============================================================================

export const runWalkForwardTestTool = createTool({
  id: "run_walk_forward_test",
  description:
    "Run walk-forward analysis on a strategy to validate its robustness. " +
    "Divides data into train/test periods, optimizes on training data, " +
    "and validates on out-of-sample test data. Use when the user asks to " +
    "'validate strategy robustness', 'run walk-forward test', or 'check for overfitting'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    strategyId: z.string().describe("Strategy ID to test"),
    market: z.enum(["auto", "crypto", "stocks"]).default("auto").describe("Market family to source candles from"),
    timeframe: z.string().default("4h").describe("Candle timeframe"),
    days: z.number().default(180).describe("Number of days of data to use"),
    trainRatio: z.number().default(0.7).describe("Ratio of data for training (0-1)"),
    numWindows: z.number().default(3).describe("Number of walk-forward windows"),
    parameterRanges: z
      .record(z.string(), z.array(z.number()))
      .optional()
      .describe("Parameters to optimize with their value ranges"),
    optimizeFor: z
      .enum(["sharpeRatio", "totalReturn", "winRate", "maxDrawdown"])
      .default("sharpeRatio")
      .describe("Metric to optimize for"),
  }),
  outputSchema: z.object({
    strategyId: z.string().optional(),
    strategyName: z.string().optional(),
    windows: z.array(z.object({
      windowNumber: z.number(),
      trainReturn: z.number(),
      testReturn: z.number(),
      overfitRatio: z.number(),
      testTrades: z.number(),
    })).optional(),
    aggregatedMetrics: z.object({
      avgReturn: z.number(),
      medianReturn: z.number(),
      avgSharpeRatio: z.number(),
      avgWinRate: z.number(),
      maxDrawdown: z.number(),
      totalTrades: z.number(),
      avgOverfitRatio: z.number(),
      profitableWindowsPercent: z.number(),
    }).optional(),
    stability: z.object({
      consistencyScore: z.number(),
      robustnessScore: z.number(),
      verdict: z.enum(["excellent", "good", "fair", "poor", "unreliable"]),
      warnings: z.array(z.string()),
    }).optional(),
    executionTime: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, strategyId, market, timeframe, days, trainRatio, numWindows, parameterRanges, optimizeFor },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);

    const strategy = strategyRegistry.get(strategyId as StrategyId);
    if (!strategy) {
      return { error: errors.strategyNotFound(strategyId).error };
    }

    try {
      const { data: ohlcData } = await fetchHistoricalSeries(ctx, {
        symbol,
        timeframe,
        market,
        days,
      });

      if (ohlcData.length < 200) {
        return { error: `Insufficient data for walk-forward test. Need at least 200 candles, got ${ohlcData.length}.` };
      }

      const config: WalkForwardConfig = {
        trainRatio,
        numWindows,
        parameterRanges: parameterRanges ?? {},
        optimizeFor: optimizeFor as keyof BacktestMetrics,
      };

      const result = await walkForwardTest(strategy, ohlcData, config);

      return {
        strategyId: result.strategyId,
        strategyName: result.strategyName,
        windows: result.windows.map((w) => ({
          windowNumber: w.windowNumber,
          trainReturn: w.trainMetrics.totalReturn,
          testReturn: w.testMetrics.totalReturn,
          overfitRatio: w.overfitRatio,
          testTrades: w.testTrades,
        })),
        aggregatedMetrics: result.aggregatedMetrics,
        stability: result.stability,
        executionTime: result.executionTime,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Walk-forward test failed",
      };
    }
  },
});

// ============================================================================
// Monte Carlo Simulation Tool
// ============================================================================

export const runMonteCarloTool = createTool({
  id: "run_monte_carlo",
  description:
    "Run Monte Carlo simulation on backtest results to assess strategy robustness. " +
    "Shuffles trade sequences to generate confidence intervals and identify " +
    "sequence-dependent strategies. Use when the user asks to 'run monte carlo', " +
    "'assess risk', or 'calculate confidence intervals'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    strategyId: z.string().describe("Strategy ID to simulate"),
    market: z.enum(["auto", "crypto", "stocks"]).default("auto").describe("Market family to source candles from"),
    timeframe: z.string().default("4h").describe("Candle timeframe"),
    days: z.number().default(90).describe("Number of days to backtest"),
    iterations: z.number().default(1000).describe("Number of Monte Carlo iterations"),
    initialCapital: z.number().default(10000).describe("Initial capital"),
  }),
  outputSchema: z.object({
    originalReturn: z.number().optional(),
    originalMaxDrawdown: z.number().optional(),
    tradeCount: z.number().optional(),
    iterations: z.number().optional(),
    returnDistribution: z.object({
      min: z.number(),
      max: z.number(),
      mean: z.number(),
      median: z.number(),
      stdDev: z.number(),
      percentile5: z.number(),
      percentile95: z.number(),
    }).optional(),
    drawdownDistribution: z.object({
      min: z.number(),
      max: z.number(),
      mean: z.number(),
      median: z.number(),
      percentile95: z.number(),
    }).optional(),
    scenarios: z.object({
      worstCaseReturn: z.number(),
      bestCaseReturn: z.number(),
      medianReturn: z.number(),
      profitProbability: z.number(),
      majorLossProbability: z.number(),
    }).optional(),
    riskMetrics: z.object({
      valueAtRisk5: z.number(),
      valueAtRisk1: z.number(),
      expectedShortfall: z.number(),
      riskOfRuin: z.number(),
    }).optional(),
    robustness: z.object({
      score: z.number(),
      verdict: z.enum(["excellent", "good", "fair", "poor", "unreliable"]),
      observations: z.array(z.string()),
    }).optional(),
    executionTime: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, strategyId, market, timeframe, days, iterations, initialCapital },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);

    const strategy = strategyRegistry.get(strategyId as StrategyId);
    if (!strategy) {
      return { error: errors.strategyNotFound(strategyId).error };
    }

    try {
      // First run a backtest to get trades
      const { data: ohlcData, metadata } = await fetchHistoricalSeries(ctx, {
        symbol,
        timeframe,
        market,
        days,
      });

      if (ohlcData.length < 100) {
        return { error: errors.insufficientData(metadata.symbol).error };
      }

      const engineParams = {
        initialCapital,
        commissionRate: 0.001,
      };

      const backtestResult = runBacktest(strategy, ohlcData, engineParams);

      if (backtestResult.trades.length < 10) {
        return { error: `Insufficient trades for Monte Carlo (${backtestResult.trades.length}). Need at least 10.` };
      }

      // Run Monte Carlo simulation
      const mcResult = await runMonteCarloSimulation(backtestResult.trades, {
        iterations,
        initialCapital,
      });

      return {
        originalReturn: mcResult.originalReturn,
        originalMaxDrawdown: mcResult.originalMaxDrawdown,
        tradeCount: mcResult.originalTradeCount,
        iterations: mcResult.config.iterations,
        returnDistribution: {
          min: mcResult.returnDistribution.min,
          max: mcResult.returnDistribution.max,
          mean: mcResult.returnDistribution.mean,
          median: mcResult.returnDistribution.median,
          stdDev: mcResult.returnDistribution.stdDev,
          percentile5: mcResult.returnDistribution.percentiles[5] ?? 0,
          percentile95: mcResult.returnDistribution.percentiles[95] ?? 0,
        },
        drawdownDistribution: {
          min: mcResult.drawdownDistribution.min,
          max: mcResult.drawdownDistribution.max,
          mean: mcResult.drawdownDistribution.mean,
          median: mcResult.drawdownDistribution.median,
          percentile95: mcResult.drawdownDistribution.percentiles[95] ?? 0,
        },
        scenarios: {
          worstCaseReturn: mcResult.scenarios.worstCase.return,
          bestCaseReturn: mcResult.scenarios.bestCase.return,
          medianReturn: mcResult.scenarios.medianCase.return,
          profitProbability: mcResult.scenarios.profitProbability,
          majorLossProbability: mcResult.scenarios.majorLossProbability,
        },
        riskMetrics: mcResult.riskMetrics,
        robustness: mcResult.robustness,
        executionTime: mcResult.executionTime,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Monte Carlo simulation failed",
      };
    }
  },
});

// ============================================================================
// Backtest History Tool
// ============================================================================

export const getBacktestHistoryTool = createTool({
  id: "get_backtest_history",
  description:
    "Get historical backtest results from the database. " +
    "Use to review past backtest runs, compare historical performance, " +
    "or find previously optimized parameters.",
  inputSchema: z.object({
    strategyId: z.string().optional().describe("Filter by strategy ID"),
    symbol: z.string().optional().describe("Filter by trading pair"),
    timeframe: z.string().optional().describe("Filter by timeframe"),
    minReturn: z.number().optional().describe("Minimum total return filter"),
    maxDrawdown: z.number().optional().describe("Maximum drawdown filter"),
    orderBy: z
      .enum(["createdAt", "totalReturn", "sharpeRatio", "maxDrawdown", "winRate"])
      .default("createdAt")
      .describe("Field to order by"),
    orderDirection: z
      .enum(["asc", "desc"])
      .default("desc")
      .describe("Sort direction"),
    limit: z.number().default(20).describe("Maximum number of results"),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      id: z.string(),
      strategyId: z.string(),
      strategyName: z.string(),
      symbol: z.string(),
      timeframe: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      totalReturn: z.number(),
      maxDrawdown: z.number(),
      sharpeRatio: z.number(),
      winRate: z.number(),
      totalTrades: z.number(),
      createdAt: z.string(),
    })).optional(),
    totalCount: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({
    strategyId,
    symbol,
    timeframe,
    minReturn,
    maxDrawdown,
    orderBy,
    orderDirection,
    limit,
  }) => {
    try {
      const options: BacktestQueryOptions = {
        strategyId,
        symbol: symbol
          ? looksExplicitlyCrypto(symbol)
            ? normalizeCryptoSymbol(symbol)
            : normalizeStockSymbol(symbol)
          : undefined,
        timeframe,
        minReturn,
        maxDrawdown,
        orderBy,
        orderDirection,
        limit,
      };

      const results = listBacktestHistory(options);

      return {
        results,
        totalCount: results.length,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to get backtest history",
      };
    }
  },
});

// ============================================================================
// Save Backtest Result Tool
// ============================================================================

export const saveBacktestResultTool = createTool({
  id: "save_backtest_result",
  description:
    "Save a backtest result to the database for future reference. " +
    "Use after running a backtest to persist results.",
  inputSchema: z.object({
    backtestResult: backtestResultSchema.describe("The backtest result to save"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ backtestResult }) => {
    try {
      const result = saveBacktestResult(backtestResult);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save backtest result",
      };
    }
  },
});

// ============================================================================
// Load Backtest Result Tool
// ============================================================================

export const loadBacktestResultTool = createTool({
  id: "load_backtest_result",
  description:
    "Load a previously saved backtest result by ID. " +
    "Use to retrieve full backtest details including trades and equity curve.",
  inputSchema: z.object({
    id: z.string().describe("The backtest result ID to load"),
  }),
  outputSchema: z.object({
    result: backtestResultSchema.optional(),
    error: z.string().optional(),
  }),
  execute: async ({ id }) => {
    try {
      const result = loadBacktestResult(id);

      if (!result) {
        return { error: `Backtest result with ID '${id}' not found.` };
      }

      return { result };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to load backtest result",
      };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Backtest tools exported as an object for Mastra Agent
 */
export const backtestTools = {
  run_backtest: runBacktestTool,
  optimize_strategy: optimizeStrategyTool,
  compare_backtests: compareBacktestsTool,
  get_backtest_summary: getBacktestSummaryTool,
  analyze_backtest_results: analyzeBacktestResultsTool,
  compare_backtest_results: compareBacktestResultsTool,
  rank_strategies_by_metric: rankStrategiesByMetricTool,
  find_best_strategy: findBestStrategyTool,
  export_results_json: exportResultsJsonTool,
  export_results_csv: exportResultsCsvTool,
  generate_html_report: generateHtmlReportTool,
  filter_exclude_months: filterExcludeMonthsTool,
  filter_market_hours: filterMarketHoursTool,
  filter_first_last_hour: filterFirstLastHourTool,
  analyze_alpha_decay: analyzeAlphaDecayTool,
  generate_backtest_chart: generateBacktestChartTool,
  grid_search_optimization: gridSearchOptimizationTool,
  random_search_optimization: randomSearchOptimizationTool,
  // New advanced tools
  run_walk_forward_test: runWalkForwardTestTool,
  run_monte_carlo: runMonteCarloTool,
  get_backtest_history: getBacktestHistoryTool,
  save_backtest_result: saveBacktestResultTool,
  load_backtest_result: loadBacktestResultTool,
};

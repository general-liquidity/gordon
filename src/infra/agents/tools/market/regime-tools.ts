/**
 * Regime Detection Tools (Mastra Format)
 *
 * Agent tools for market regime classification.
 * Allows agents to detect current market regime, view regime history,
 * match playbooks to regimes, and perform multi-timeframe analysis.
 *
 * All operations are wrapped in try/catch — regime failures
 * should never crash agent execution.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { RegimeDetector } from "../../../../core/regime/index.ts";
import {
  MarketRegimeSchema,
  RegimeMetricsSchema,
  RegimeSpanSchema,
} from "../../../../core/regime/types.ts";
import { resolveInstrument } from "../../../domain/markets/instruments.ts";
import { getGordonContext, normalizeSymbol, errors } from "../types.ts";
import type { MastraExecutionContext } from "../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("regime-tools");

function timeframeToMs(timeframe: string): number {
  if (timeframe.endsWith("m")) return Number.parseInt(timeframe, 10) * 60_000;
  if (timeframe.endsWith("h")) return Number.parseInt(timeframe, 10) * 3_600_000;
  if (timeframe.endsWith("d")) return Number.parseInt(timeframe, 10) * 86_400_000;
  return 3_600_000;
}

// ============================================================================
// Detect Market Regime Tool
// ============================================================================

export const detectMarketRegimeTool = createTool({
  id: "detect_market_regime",
  description:
    "Detect the current market regime for a trading pair. " +
    "Classifies conditions as trending_up, trending_down, ranging, volatile, quiet, or breakout. " +
    "Use when user asks 'what is the market doing?', 'is BTC trending?', 'market conditions for ETH', 'regime'.",
  inputSchema: z.object({
    symbol: z
      .string()
      .describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
    timeframe: z
      .string()
      .default("1h")
      .describe("Candle timeframe (e.g., '1h', '4h', '1d')"),
    candle_limit: z
      .number()
      .min(30)
      .max(500)
      .default(100)
      .describe("Number of candles to fetch (default: 100)"),
  }),
  outputSchema: z.object({
    regime: MarketRegimeSchema.optional(),
    confidence: z.number().optional(),
    timestamp: z.string().optional(),
    metrics: RegimeMetricsSchema.optional(),
    symbol: z.string().optional(),
    timeframe: z.string().optional(),
    matching_playbooks: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, timeframe, candle_limit },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return errors.noExchange;
    }

    try {
      const instrument = await resolveInstrument(ctx, symbol);
      const normalizedSymbol = instrument.normalizedSymbol;
      const candles = instrument.route === "broker" && ctx.broker
        ? await ctx.broker.getHistoricalBars({
          symbol: normalizedSymbol,
          timeframe,
          startTime: Date.now() - (candle_limit * timeframeToMs(timeframe)),
          endTime: Date.now(),
          limit: candle_limit,
        })
        : await ctx.exchange!.getCandles(
          normalizedSymbol,
          timeframe,
          candle_limit,
        );

      if (!candles || candles.length < 30) {
        return {
          error: `Insufficient candle data for ${normalizedSymbol}. Got ${candles?.length ?? 0}, need at least 30.`,
        };
      }

      const detector = RegimeDetector.getInstance();
      const signal = detector.detectRegime(candles, normalizedSymbol, timeframe);

      // Also find matching playbooks
      const matchingPlaybooks = detector.getPlaybooksForRegime(signal.regime);

      return {
        regime: signal.regime,
        confidence: signal.confidence,
        timestamp: signal.timestamp,
        metrics: signal.metrics,
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        matching_playbooks: matchingPlaybooks,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("detect_market_regime failed", { error: message });
      return { error: `Failed to detect regime: ${message}` };
    }
  },
});

// ============================================================================
// Get Regime History Tool
// ============================================================================

export const getRegimeHistoryTool = createTool({
  id: "get_regime_history",
  description:
    "Get the regime transition history for a trading pair. " +
    "Shows how the market regime has changed over time. " +
    "Use when user asks 'regime history', 'how has the market changed?', 'regime transitions'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Max history entries to return"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    regimes: z.array(RegimeSpanSchema).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }) => {
    try {
      const normalizedSymbol = normalizeSymbol(symbol);
      const detector = RegimeDetector.getInstance();
      const history = detector.getRegimeHistory(normalizedSymbol, limit);

      return {
        symbol: history.symbol,
        regimes: history.regimes,
        count: history.regimes.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_regime_history failed", { error: message });
      return { error: `Failed to get regime history: ${message}` };
    }
  },
});

// ============================================================================
// Match Playbooks to Regime Tool
// ============================================================================

export const matchPlaybooksToRegimeTool = createTool({
  id: "match_playbooks_to_regime",
  description:
    "Find playbooks suitable for the current or specified market regime. " +
    "Can auto-detect the regime for a symbol, or use a provided regime value. " +
    "Use when user asks 'which playbooks for this market?', 'best strategy right now?', " +
    "'playbooks for trending market'.",
  inputSchema: z.object({
    regime: MarketRegimeSchema
      .optional()
      .describe(
        "Market regime to match. If omitted, will auto-detect from symbol.",
      ),
    symbol: z
      .string()
      .optional()
      .describe(
        "Trading pair for auto-detection (e.g., 'BTCUSDT'). Used when regime is not provided.",
      ),
    timeframe: z
      .string()
      .default("1h")
      .describe("Timeframe for auto-detection"),
  }),
  outputSchema: z.object({
    regime: MarketRegimeSchema.optional(),
    confidence: z.number().optional(),
    playbooks: z.array(z.string()).optional(),
    count: z.number().optional(),
    auto_detected: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { regime, symbol, timeframe },
    execContext: MastraExecutionContext,
  ) => {
    try {
      const detector = RegimeDetector.getInstance();

      let resolvedRegime: string | undefined = regime;
      let confidence: number | undefined;
      let autoDetected = false;

      // If no regime given, auto-detect from symbol
      if (!resolvedRegime && symbol) {
        const ctx = getGordonContext(execContext);
        if (!ctx?.exchange && !ctx?.broker) {
          return errors.noExchange;
        }

        const instrument = await resolveInstrument(ctx!, symbol);
        const normalizedSymbol = instrument.normalizedSymbol;
        const candles = instrument.route === "broker" && ctx?.broker
          ? await ctx.broker.getHistoricalBars({
            symbol: normalizedSymbol,
            timeframe,
            startTime: Date.now() - (100 * timeframeToMs(timeframe)),
            endTime: Date.now(),
            limit: 100,
          })
          : await ctx!.exchange!.getCandles(
            normalizedSymbol,
            timeframe,
            100,
          );

        if (!candles || candles.length < 30) {
          return {
            error: `Insufficient candle data for ${normalizedSymbol}. Got ${candles?.length ?? 0}, need at least 30.`,
          };
        }

        const signal = detector.detectRegime(
          candles,
          normalizedSymbol,
          timeframe,
        );
        resolvedRegime = signal.regime;
        confidence = signal.confidence;
        autoDetected = true;
      }

      if (!resolvedRegime) {
        return {
          error:
            "Either 'regime' or 'symbol' must be provided to match playbooks.",
        };
      }

      const playbooks = detector.getPlaybooksForRegime(
        resolvedRegime as import("../../../../core/regime/types.ts").MarketRegime,
      );

      return {
        regime: resolvedRegime as import("../../../../core/regime/types.ts").MarketRegime,
        confidence,
        playbooks,
        count: playbooks.length,
        auto_detected: autoDetected,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("match_playbooks_to_regime failed", { error: message });
      return { error: `Failed to match playbooks: ${message}` };
    }
  },
});

// ============================================================================
// Multi-Timeframe Regime Tool
// ============================================================================

export const multiTimeframeRegimeTool = createTool({
  id: "multi_timeframe_regime",
  description:
    "Analyze market regime across hourly and daily timeframes for a trading pair. " +
    "Shows whether timeframes agree or conflict, plus a consensus regime. " +
    "Use when user asks 'full regime analysis', 'multi-TF regime', 'are timeframes aligned?'.",
  inputSchema: z.object({
    symbol: z
      .string()
      .describe("Trading pair (e.g., 'BTCUSDT')"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    hourly: z
      .object({
        regime: MarketRegimeSchema,
        confidence: z.number(),
      })
      .optional(),
    daily: z
      .object({
        regime: MarketRegimeSchema,
        confidence: z.number(),
      })
      .optional(),
    consensus: MarketRegimeSchema.optional(),
    conflicting: z.boolean().optional(),
    matching_playbooks: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return errors.noExchange;
    }

    try {
      const instrument = await resolveInstrument(ctx, symbol);
      const normalizedSymbol = instrument.normalizedSymbol;

      // Fetch candles for both timeframes in parallel
      const [hourlyCandles, dailyCandles] = instrument.route === "broker" && ctx.broker
        ? await Promise.all([
          ctx.broker.getHistoricalBars({
            symbol: normalizedSymbol,
            timeframe: "1h",
            startTime: Date.now() - (100 * 3_600_000),
            endTime: Date.now(),
            limit: 100,
          }),
          ctx.broker.getHistoricalBars({
            symbol: normalizedSymbol,
            timeframe: "1d",
            startTime: Date.now() - (100 * 86_400_000),
            endTime: Date.now(),
            limit: 100,
          }),
        ])
        : await Promise.all([
          ctx.exchange!.getCandles(normalizedSymbol, "1h", 100),
          ctx.exchange!.getCandles(normalizedSymbol, "1d", 100),
        ]);

      if (!hourlyCandles || hourlyCandles.length < 30) {
        return {
          error: `Insufficient hourly data for ${normalizedSymbol}. Got ${hourlyCandles?.length ?? 0}, need at least 30.`,
        };
      }
      if (!dailyCandles || dailyCandles.length < 30) {
        return {
          error: `Insufficient daily data for ${normalizedSymbol}. Got ${dailyCandles?.length ?? 0}, need at least 30.`,
        };
      }

      const detector = RegimeDetector.getInstance();
      const result = detector.getMultiTimeframeRegime(
        hourlyCandles,
        dailyCandles,
        normalizedSymbol,
      );

      const matchingPlaybooks = detector.getPlaybooksForRegime(
        result.consensus,
      );

      return {
        symbol: normalizedSymbol,
        hourly: {
          regime: result.hourly.regime,
          confidence: result.hourly.confidence,
        },
        daily: {
          regime: result.daily.regime,
          confidence: result.daily.confidence,
        },
        consensus: result.consensus,
        conflicting: result.conflicting,
        matching_playbooks: matchingPlaybooks,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("multi_timeframe_regime failed", { error: message });
      return { error: `Failed to analyze multi-timeframe regime: ${message}` };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Regime tools exported as an object for Mastra Agent.
 * This is the format expected by Mastra's Agent class.
 */
export const regimeTools = {
  detect_market_regime: detectMarketRegimeTool,
  get_regime_history: getRegimeHistoryTool,
  match_playbooks_to_regime: matchPlaybooksToRegimeTool,
  multi_timeframe_regime: multiTimeframeRegimeTool,
};

/**
 * Smart Money Concepts Pattern Tools
 *
 * Mastra tool wrappers around `src/core/indicators/smc-patterns.ts`. Exposes
 * two agent-facing entry points:
 *   - `detect_smc_patterns` — runs all five detectors (FVG, OB, CHoCH,
 *     Premium/Discount, Liquidity Sweep) and returns a unified analysis
 *     with a net bias summary
 *   - `detect_smc_single_pattern` — runs one specific detector for when
 *     the agent only needs FVGs (for example) and wants to keep the
 *     response compact
 *
 * Candles are fetched from Binance public klines via the shared candle
 * fetcher used by the proactive producers — no client auth required. Works
 * for any crypto symbol that Binance lists.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  analyzeSmcPatterns,
  detectFairValueGaps,
  detectOrderBlocks,
  detectChangeOfCharacter,
  detectPremiumDiscountZones,
  detectLiquiditySweeps,
  type OHLC,
} from "../../../../core/indicators/smc-patterns.ts";
import { fetchRecentCandles } from "../../../proactive/producers/candleFetch.ts";

import type { Timeframe } from "../../../../types/timeframes.ts";

const TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"] as const satisfies readonly Timeframe[];

function toOhlc(
  bars: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>,
): OHLC[] {
  return bars as OHLC[];
}

// ============================================================================
// 1. detect_smc_patterns (all five)
// ============================================================================

export const detectSmcPatternsTool = createTool({
  id: "detect_smc_patterns",
  description:
    "Run the full Smart Money Concepts / ICT pattern analysis on a symbol: " +
    "Fair Value Gaps, Order Blocks, Change-of-Character, Premium/Discount zones, " +
    "and Liquidity Sweeps. Returns unified analysis with bullish/bearish signal " +
    "counts and a net bias verdict. Use for SMC-style discretionary setup " +
    "hunting — identifies where smart money likely stops, gaps, and reversals " +
    "are in play. Defaults to 1h timeframe, 200 candles.",
  inputSchema: z.object({
    symbol: z.string().describe("Exchange symbol, e.g. 'BTCUSDT', 'ETHUSDT'"),
    timeframe: z.enum(TIMEFRAMES).optional().default("1h"),
    candleCount: z.number().int().min(50).max(500).optional().default(200),
    swingLookback: z.number().int().min(3).max(10).optional().default(5),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    timeframe: z.string(),
    summary: z.object({
      bullishSignals: z.number(),
      bearishSignals: z.number(),
      netBias: z.enum(["bullish", "bearish", "neutral"]),
      currentZone: z.enum(["premium", "equilibrium", "discount"]).optional(),
    }),
    fairValueGaps: z
      .array(
        z.object({
          direction: z.enum(["bull", "bear"]),
          top: z.number(),
          bottom: z.number(),
          sizePct: z.number(),
          unfilled: z.boolean(),
          anchorIndex: z.number(),
        }),
      )
      .optional(),
    orderBlocks: z
      .array(
        z.object({
          direction: z.enum(["bull", "bear"]),
          high: z.number(),
          low: z.number(),
          index: z.number(),
        }),
      )
      .optional(),
    changeOfCharacter: z
      .array(
        z.object({
          direction: z.enum(["bull", "bear"]),
          brokenLevel: z.number(),
          closePrice: z.number(),
          index: z.number(),
        }),
      )
      .optional(),
    premiumDiscount: z
      .object({
        rangeHigh: z.number(),
        rangeLow: z.number(),
        equilibrium: z.number(),
        premium: z.object({
          level50: z.number(),
          level618: z.number(),
          level705: z.number(),
          level786: z.number(),
        }),
        discount: z.object({
          level50: z.number(),
          level618: z.number(),
          level705: z.number(),
          level786: z.number(),
        }),
        currentZone: z.string(),
      })
      .nullable()
      .optional(),
    liquiditySweeps: z
      .array(
        z.object({
          direction: z.enum(["bull", "bear"]),
          sweptLevel: z.number(),
          wickDepthPct: z.number(),
          confirmed: z.boolean(),
          index: z.number(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, timeframe, candleCount, swingLookback }) => {
    const candles = await fetchRecentCandles(symbol, timeframe, candleCount ?? 200);
    if (candles.length < 20) {
      return {
        symbol,
        timeframe: timeframe ?? "1h",
        summary: { bullishSignals: 0, bearishSignals: 0, netBias: "neutral" as const },
        error: `Could not fetch sufficient candles for ${symbol} (got ${candles.length})`,
      };
    }
    const analysis = analyzeSmcPatterns(toOhlc(candles), { swingLookback: swingLookback ?? 5 });
    // Trim arrays to most recent N for compact response
    return {
      symbol,
      timeframe: timeframe ?? "1h",
      summary: analysis.summary,
      fairValueGaps: analysis.fairValueGaps.slice(-6).map((g) => ({
        direction: g.direction,
        top: Number(g.top.toFixed(4)),
        bottom: Number(g.bottom.toFixed(4)),
        sizePct: Number(g.sizePct.toFixed(3)),
        unfilled: g.unfilled,
        anchorIndex: g.anchorIndex,
      })),
      orderBlocks: analysis.orderBlocks.slice(-4).map((ob) => ({
        direction: ob.direction,
        high: Number(ob.high.toFixed(4)),
        low: Number(ob.low.toFixed(4)),
        index: ob.index,
      })),
      changeOfCharacter: analysis.changeOfCharacter.slice(-4).map((c) => ({
        direction: c.direction,
        brokenLevel: Number(c.brokenLevel.toFixed(4)),
        closePrice: Number(c.closePrice.toFixed(4)),
        index: c.index,
      })),
      premiumDiscount: analysis.premiumDiscount
        ? {
            rangeHigh: Number(analysis.premiumDiscount.rangeHigh.toFixed(4)),
            rangeLow: Number(analysis.premiumDiscount.rangeLow.toFixed(4)),
            equilibrium: Number(analysis.premiumDiscount.equilibrium.toFixed(4)),
            premium: {
              level50: Number(analysis.premiumDiscount.premium.level50.toFixed(4)),
              level618: Number(analysis.premiumDiscount.premium.level618.toFixed(4)),
              level705: Number(analysis.premiumDiscount.premium.level705.toFixed(4)),
              level786: Number(analysis.premiumDiscount.premium.level786.toFixed(4)),
            },
            discount: {
              level50: Number(analysis.premiumDiscount.discount.level50.toFixed(4)),
              level618: Number(analysis.premiumDiscount.discount.level618.toFixed(4)),
              level705: Number(analysis.premiumDiscount.discount.level705.toFixed(4)),
              level786: Number(analysis.premiumDiscount.discount.level786.toFixed(4)),
            },
            currentZone: analysis.premiumDiscount.currentZone,
          }
        : null,
      liquiditySweeps: analysis.liquiditySweeps.slice(-6).map((s) => ({
        direction: s.direction,
        sweptLevel: Number(s.sweptLevel.toFixed(4)),
        wickDepthPct: Number(s.wickDepthPct.toFixed(3)),
        confirmed: s.confirmed,
        index: s.index,
      })),
    };
  },
});

// ============================================================================
// 2. detect_smc_single_pattern (one specific detector)
// ============================================================================

export const detectSmcSinglePatternTool = createTool({
  id: "detect_smc_single_pattern",
  description:
    "Run ONE Smart Money Concepts detector on a symbol — use when you only " +
    "need Fair Value Gaps or only need Liquidity Sweeps, etc. Keeps the tool " +
    "response compact compared to detect_smc_patterns which runs all five.",
  inputSchema: z.object({
    symbol: z.string(),
    pattern: z.enum([
      "fair_value_gap",
      "order_block",
      "change_of_character",
      "premium_discount",
      "liquidity_sweep",
    ]),
    timeframe: z.enum(TIMEFRAMES).optional().default("1h"),
    candleCount: z.number().int().min(50).max(500).optional().default(200),
    swingLookback: z.number().int().min(3).max(10).optional().default(5),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    timeframe: z.string(),
    pattern: z.string(),
    count: z.number(),
    results: z.array(z.record(z.string(), z.unknown())).optional(),
    zones: z.record(z.string(), z.unknown()).nullable().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, pattern, timeframe, candleCount, swingLookback }) => {
    const candles = toOhlc(await fetchRecentCandles(symbol, timeframe, candleCount ?? 200));
    if (candles.length < 20) {
      return {
        symbol,
        timeframe: timeframe ?? "1h",
        pattern,
        count: 0,
        error: `Insufficient candles (${candles.length})`,
      };
    }
    const lookback = swingLookback ?? 5;

    switch (pattern) {
      case "fair_value_gap": {
        const results = detectFairValueGaps(candles).slice(-10);
        return {
          symbol,
          timeframe: timeframe ?? "1h",
          pattern,
          count: results.length,
          results: results as unknown as Array<Record<string, unknown>>,
        };
      }
      case "order_block": {
        const results = detectOrderBlocks(candles, lookback).slice(-10);
        return {
          symbol,
          timeframe: timeframe ?? "1h",
          pattern,
          count: results.length,
          results: results as unknown as Array<Record<string, unknown>>,
        };
      }
      case "change_of_character": {
        const results = detectChangeOfCharacter(candles, lookback).slice(-10);
        return {
          symbol,
          timeframe: timeframe ?? "1h",
          pattern,
          count: results.length,
          results: results as unknown as Array<Record<string, unknown>>,
        };
      }
      case "premium_discount": {
        const zones = detectPremiumDiscountZones(candles, lookback);
        return {
          symbol,
          timeframe: timeframe ?? "1h",
          pattern,
          count: zones ? 1 : 0,
          zones: zones as unknown as Record<string, unknown> | null,
        };
      }
      case "liquidity_sweep": {
        const results = detectLiquiditySweeps(candles, { swingLookback: lookback }).slice(-10);
        return {
          symbol,
          timeframe: timeframe ?? "1h",
          pattern,
          count: results.length,
          results: results as unknown as Array<Record<string, unknown>>,
        };
      }
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export const smcPatternTools = {
  detect_smc_patterns: detectSmcPatternsTool,
  detect_smc_single_pattern: detectSmcSinglePatternTool,
};

/**
 * Market Tools
 * Tools for scanning and analyzing the market
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import { scan } from "../../../core/scanner.ts";
import { analyze } from "../../../core/analyzer.ts";
import type { ToolRunContext } from "./types.ts";
import { errors } from "./types.ts";

// ============================================================================
// Market Scanning Tool
// ============================================================================

export const scanMarketTool = tool({
  name: "scan_market",
  description:
    "Scan the market for trading opportunities. Finds coins near support with bullish signals. " +
    "Use this when the user wants to find trading opportunities or asks 'what should I buy?'",
  parameters: z.object({
    topN: z
      .number()
      .min(10)
      .max(200)
      .default(50)
      .describe("Number of top coins by volume to scan"),
    timeframes: z
      .array(z.string())
      .default(["1h", "4h"])
      .describe("Timeframes to analyze"),
  }),
  async execute({ topN, timeframes }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const result = await scan(ctx.binance, { topN, timeframes });

    return {
      timestamp: result.timestamp,
      coinsScanned: result.coins.length,
      opportunities: result.coins
        .filter((c) => c.setupDetected)
        .slice(0, 10)
        .map((c) => ({
          symbol: c.symbol,
          price: c.price,
          change24h: c.change24h,
          setupConfidence: c.setupConfidence,
          bias: c.bias,
          risk: c.risk,
        })),
    };
  },
});

// ============================================================================
// Coin Analysis Tool
// ============================================================================

export const analyzeCoinTool = tool({
  name: "analyze_coin",
  description:
    "Perform deep analysis on a specific coin/trading pair. " +
    "Use this when the user asks about a specific coin like 'analyze BTC' or 'what about ETH?'",
  parameters: z.object({
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETHUSDT')"),
    timeframes: z
      .array(z.string())
      .default(["1h", "4h", "1d"])
      .describe("Timeframes to analyze"),
  }),
  async execute({ symbol, timeframes }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    // Normalize symbol (add USDT if not present)
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    const result = await analyze(ctx.binance, normalizedSymbol, {
      timeframes: timeframes ?? ["1h", "4h", "1d"],
    });

    return {
      symbol: result.symbol,
      price: result.price,
      trend: result.trend,
      setupDetected: result.setupDetected,
      setupConfidence: result.setupConfidence,
      supports: result.supports.slice(0, 3).map((s) => ({
        price: s.price,
        strength: s.strength,
      })),
      resistances: result.resistances.slice(0, 3).map((r) => ({
        price: r.price,
        strength: r.strength,
      })),
      indicators: {
        rsi: result.indicators.rsi,
        macdState: result.macdState,
        volumeTrend: result.volumeTrend,
      },
      recommendation:
        result.setupDetected && result.setupConfidence >= 0.6
          ? "Good setup detected - consider creating a plan"
          : result.setupDetected
            ? "Weak setup detected - wait for better entry"
            : "No setup detected - keep watching",
    };
  },
});

export const marketTools = [scanMarketTool, analyzeCoinTool];

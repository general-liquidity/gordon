/**
 * Market Tools (Mastra Format)
 * Tools for scanning and analyzing the market
 *
 * Migrated from OpenAI Agents SDK format to Mastra format:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { scan } from "../../../core/scanner.ts";
import { analyze } from "../../../core/analyzer.ts";
import { getHistoricalOpportunities, getOpportunitySummary } from "../../storage/events.ts";
import type { GordonContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noBinance: { error: "Binance client not connected. Please run setup first." },
};

// ============================================================================
// Market Scanning Tool
// ============================================================================

export const scanMarketTool = createTool({
  id: "scan_market",
  description:
    "Scan the market for trading opportunities. Finds coins near support with bullish signals. " +
    "Use this when the user wants to find trading opportunities or asks 'what should I buy?'",
  inputSchema: z.object({
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
  outputSchema: z.object({
    timestamp: z.string().optional(),
    coinsScanned: z.number().optional(),
    opportunities: z.array(z.object({
      symbol: z.string(),
      price: z.number(),
      change24h: z.number(),
      setupConfidence: z.number(),
      bias: z.string(),
      risk: z.string(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, topN, timeframes }) => {
    const ctx = context as GordonContext;
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

export const analyzeCoinTool = createTool({
  id: "analyze_coin",
  description:
    "Perform deep analysis on a specific coin/trading pair. " +
    "Use this when the user asks about a specific coin like 'analyze BTC' or 'what about ETH?'",
  inputSchema: z.object({
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETHUSDT')"),
    timeframes: z
      .array(z.string())
      .default(["1h", "4h", "1d"])
      .describe("Timeframes to analyze"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    price: z.number().optional(),
    trend: z.string().optional(),
    setupDetected: z.boolean().optional(),
    setupConfidence: z.number().optional(),
    supports: z.array(z.object({
      price: z.number(),
      strength: z.number(),
    })).optional(),
    resistances: z.array(z.object({
      price: z.number(),
      strength: z.number(),
    })).optional(),
    indicators: z.object({
      rsi: z.number().nullable().optional(),
      macdState: z.string().optional(),
      volumeTrend: z.string().optional(),
    }).optional(),
    recommendation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, symbol, timeframes }) => {
    const ctx = context as GordonContext;
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

// ============================================================================
// Historical Opportunities Tool
// ============================================================================

export const getHistoricalOpportunitiesTool = createTool({
  id: "get_historical_opportunities",
  description:
    "Query past trading opportunities that were detected by scans. " +
    "Use this to answer questions like 'did we miss any opportunities?' or 'what setups were found recently?'",
  inputSchema: z.object({
    daysBack: z
      .number()
      .min(1)
      .max(30)
      .default(7)
      .describe("Number of days to look back"),
    symbol: z
      .string()
      .default("")
      .describe("Filter by specific symbol (e.g., 'BTCUSDT'). Empty string for all symbols."),
    minConfidence: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe("Minimum confidence threshold (0-1). 0 for no filter."),
  }),
  outputSchema: z.object({
    message: z.string(),
    totalOpportunities: z.number(),
    opportunities: z.array(z.object({
      symbol: z.string(),
      timestamp: z.string(),
      price: z.number(),
      confidence: z.string(),
      bias: z.string(),
      risk: z.string(),
    })),
    dailySummary: z.record(z.string(), z.number()),
  }),
  execute: async ({ context, daysBack, symbol, minConfidence }) => {
    // This tool doesn't require Binance client - it reads from local storage
    const opportunities = getHistoricalOpportunities({
      daysBack,
      symbol: symbol || undefined,
      minConfidence: minConfidence || undefined,
      limit: 50,
    });

    const summary = getOpportunitySummary(daysBack);

    if (opportunities.length === 0) {
      return {
        message: `No opportunities were detected in the last ${daysBack} days.`,
        totalOpportunities: 0,
        opportunities: [],
        dailySummary: summary,
      };
    }

    return {
      message: `Found ${opportunities.length} opportunities in the last ${daysBack} days.`,
      totalOpportunities: opportunities.length,
      opportunities: opportunities.slice(0, 20).map((o) => ({
        symbol: o.symbol,
        timestamp: o.timestamp,
        price: o.price,
        confidence: Math.round(o.confidence * 100) + "%",
        bias: o.bias,
        risk: o.risk,
      })),
      dailySummary: summary,
    };
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Market tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const marketTools = {
  scan_market: scanMarketTool,
  analyze_coin: analyzeCoinTool,
  get_historical_opportunities: getHistoricalOpportunitiesTool,
};

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
import {
  getGordonContext,
  validateToolOutput,
  createToolErrorResponse,
  type MastraExecutionContext,
} from "./types.ts";
import { createCachedTool, TOOL_CACHE_CONFIG } from "./cache.ts";
import {
  formatScanResults,
  formatAnalysisResults,
  formatCurrency,
} from "../../../app/components/formatResults.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noBinance: { error: "Binance client not connected. Please run setup first." },
};

// ============================================================================
// Output Schemas (extracted for validation reuse)
// ============================================================================

const scanMarketOutputSchema = z.object({
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
  executionTime: z.number().optional(),
  formattedSummary: z.string().optional(),
  error: z.string().optional(),
});

const analyzeCoinOutputSchema = z.object({
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
  executionTime: z.number().optional(),
  formattedSummary: z.string().optional(),
  error: z.string().optional(),
});

const getHistoricalOpportunitiesOutputSchema = z.object({
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
});

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
  outputSchema: scanMarketOutputSchema,
  execute: async ({ topN, timeframes }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return validateToolOutput(scanMarketOutputSchema, errors.noBinance, { toolName: "scan_market" });
    }

    const startTime = Date.now();

    try {
      const result = await scan(ctx.binance, { topN, timeframes });
      const executionTime = Date.now() - startTime;

      const opportunities = result.coins
        .filter((c) => c.setupDetected)
        .slice(0, 10)
        .map((c) => ({
          symbol: c.symbol,
          price: c.price,
          change24h: c.change24h,
          setupConfidence: c.setupConfidence,
          bias: c.bias,
          risk: c.risk,
        }));

      // Generate formatted summary
      const formattedSummary = formatScanResults({
        coinsScanned: result.coins.length,
        opportunities,
        executionTime,
        maxRows: 10,
      });

      const output = {
        timestamp: result.timestamp,
        coinsScanned: result.coins.length,
        opportunities,
        executionTime,
        formattedSummary,
      };

      return validateToolOutput(scanMarketOutputSchema, output, { toolName: "scan_market" });
    } catch (error) {
      // Return structured error with recovery context
      const errorResponse = createToolErrorResponse(
        error instanceof Error ? error : new Error(String(error)),
        "/scan",
        { topN, timeframes }
      );
      return validateToolOutput(scanMarketOutputSchema, {
        error: errorResponse.error,
      }, { toolName: "scan_market" });
    }
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
  outputSchema: analyzeCoinOutputSchema,
  execute: async ({ symbol, timeframes }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return validateToolOutput(analyzeCoinOutputSchema, errors.noBinance, { toolName: "analyze_coin" });
    }

    const startTime = Date.now();

    // Normalize symbol (add USDT if not present)
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const result = await analyze(ctx.binance, normalizedSymbol, {
        timeframes: timeframes ?? ["1h", "4h", "1d"],
      });

      const executionTime = Date.now() - startTime;

      const recommendation =
        result.setupDetected && result.setupConfidence >= 0.6
          ? "Good setup detected - consider creating a plan"
          : result.setupDetected
            ? "Weak setup detected - wait for better entry"
            : "No setup detected - keep watching";

      const supports = result.supports.slice(0, 3).map((s) => ({
        price: s.price,
        strength: s.strength,
      }));

      const resistances = result.resistances.slice(0, 3).map((r) => ({
        price: r.price,
        strength: r.strength,
      }));

      const indicators = {
        rsi: result.indicators.rsi,
        macdState: result.macdState,
        volumeTrend: result.volumeTrend,
      };

      // Generate formatted summary
      const formattedSummary = formatAnalysisResults({
        symbol: result.symbol,
        price: result.price,
        trend: result.trend,
        setupDetected: result.setupDetected,
        setupConfidence: result.setupConfidence,
        indicators,
        supports,
        resistances,
        executionTime,
      });

      const output = {
        symbol: result.symbol,
        price: result.price,
        trend: result.trend,
        setupDetected: result.setupDetected,
        setupConfidence: result.setupConfidence,
        supports,
        resistances,
        indicators,
        recommendation,
        executionTime,
        formattedSummary,
      };

      return validateToolOutput(analyzeCoinOutputSchema, output, { toolName: "analyze_coin" });
    } catch (error) {
      // Return structured error with recovery context
      const errorResponse = createToolErrorResponse(
        error instanceof Error ? error : new Error(String(error)),
        `/analyze ${symbol}`,
        { symbol: normalizedSymbol, timeframes }
      );
      return validateToolOutput(analyzeCoinOutputSchema, {
        error: errorResponse.error,
        symbol: normalizedSymbol,
      }, { toolName: "analyze_coin" });
    }
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
  outputSchema: getHistoricalOpportunitiesOutputSchema,
  execute: async ({ daysBack, symbol, minConfidence }, execContext: MastraExecutionContext) => {
    // This tool doesn't require Binance client - it reads from local storage
    const opportunities = getHistoricalOpportunities({
      daysBack,
      symbol: symbol || undefined,
      minConfidence: minConfidence || undefined,
      limit: 50,
    });

    const summary = getOpportunitySummary(daysBack);

    if (opportunities.length === 0) {
      return validateToolOutput(getHistoricalOpportunitiesOutputSchema, {
        message: `No opportunities were detected in the last ${daysBack} days.`,
        totalOpportunities: 0,
        opportunities: [],
        dailySummary: summary,
      }, { toolName: "get_historical_opportunities" });
    }

    const output = {
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

    return validateToolOutput(getHistoricalOpportunitiesOutputSchema, output, { toolName: "get_historical_opportunities" });
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Market tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 *
 * All tools are wrapped with caching and request deduplication:
 * - scan_market: 2 minute TTL (comprehensive market scan)
 * - analyze_coin: 5 minute TTL (deep analysis, expensive)
 * - get_historical_opportunities: 10 minute TTL (historical data, rarely changes)
 */
export const marketTools = {
  scan_market: createCachedTool(scanMarketTool, TOOL_CACHE_CONFIG.scanning.ttl),
  analyze_coin: createCachedTool(analyzeCoinTool, TOOL_CACHE_CONFIG.analysis.ttl),
  get_historical_opportunities: createCachedTool(getHistoricalOpportunitiesTool, TOOL_CACHE_CONFIG.historical.ttl),
};

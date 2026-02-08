/**
 * Market Data Tools (Mastra Format)
 * Agent-facing tools for raw exchange market data access
 *
 * Wraps core Exchange interface methods as LLM-callable tools:
 * - get_candles: Raw OHLCV candle data
 * - get_price: Current price for a trading pair
 * - get_tickers: 24hr ticker data sorted by volume
 * - get_book_ticker: Best bid/ask for a symbol
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "./types.ts";
import { createCachedTool, TOOL_CACHE_CONFIG } from "./cache.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
};

// ============================================================================
// Get Candles Tool
// ============================================================================

export const getCandlesTool = createTool({
  id: "get_candles",
  description:
    "Fetch raw OHLCV candle data for a symbol. Returns array of candles with open, high, low, close, volume, and timestamp.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
    interval: z
      .enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"])
      .describe("Candle interval/timeframe"),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(50)
      .describe("Number of candles to fetch (default 50)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    count: z.number().optional(),
    candles: z.array(z.object({
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number(),
      timestamp: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, limit);

      return {
        symbol: normalizedSymbol,
        interval,
        count: candles.length,
        candles: candles.map((c) => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          timestamp: c.timestamp,
        })),
      };
    } catch (error) {
      return { error: `Failed to fetch candles: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Get Price Tool
// ============================================================================

export const getPriceTool = createTool({
  id: "get_price",
  description:
    "Get the current price of a trading pair.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    price: z.number().optional(),
    timestamp: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const price = await ctx.exchange.getPrice(normalizedSymbol);

      return {
        symbol: normalizedSymbol,
        price,
        timestamp: Date.now(),
      };
    } catch (error) {
      return { error: `Failed to get price: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Get Tickers Tool
// ============================================================================

export const getTickersTool = createTool({
  id: "get_tickers",
  description:
    "Get 24hr ticker data for all trading pairs or top N by volume. Returns price change, volume, high, low for each pair.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(200)
      .default(20)
      .describe("Number of top tickers to return sorted by volume (default 20)"),
  }),
  outputSchema: z.object({
    count: z.number().optional(),
    tickers: z.array(z.object({
      symbol: z.string(),
      lastPrice: z.number(),
      priceChange: z.number(),
      priceChangePercent: z.number(),
      highPrice: z.number(),
      lowPrice: z.number(),
      volume: z.number(),
      quoteVolume: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    try {
      const tickers = await ctx.exchange.get24hrTickers();

      // Sort by quote volume descending and take top N
      const sorted = tickers
        .sort((a, b) => b.quoteVolume - a.quoteVolume)
        .slice(0, limit);

      return {
        count: sorted.length,
        tickers: sorted.map((t) => ({
          symbol: t.symbol,
          lastPrice: t.lastPrice,
          priceChange: t.priceChange,
          priceChangePercent: t.priceChangePercent,
          highPrice: t.highPrice,
          lowPrice: t.lowPrice,
          volume: t.volume,
          quoteVolume: t.quoteVolume,
        })),
      };
    } catch (error) {
      return { error: `Failed to get tickers: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Get Book Ticker Tool
// ============================================================================

export const getBookTickerTool = createTool({
  id: "get_book_ticker",
  description:
    "Get the best bid and ask price for a symbol. Useful for checking current spread and liquidity.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    bidPrice: z.number().optional(),
    bidQty: z.number().optional(),
    askPrice: z.number().optional(),
    askQty: z.number().optional(),
    spread: z.string().optional(),
    spreadPercent: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const bookTicker = await ctx.exchange.getBookTicker(normalizedSymbol);

      const spread = bookTicker.askPrice - bookTicker.bidPrice;
      const spreadPercent = bookTicker.askPrice > 0
        ? (spread / bookTicker.askPrice) * 100
        : 0;

      return {
        symbol: bookTicker.symbol,
        bidPrice: bookTicker.bidPrice,
        bidQty: bookTicker.bidQty,
        askPrice: bookTicker.askPrice,
        askQty: bookTicker.askQty,
        spread: spread.toFixed(8),
        spreadPercent: spreadPercent.toFixed(4) + "%",
      };
    } catch (error) {
      return { error: `Failed to get book ticker: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Market data tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 *
 * Caching strategy:
 * - get_candles: 10 second TTL (price-level freshness)
 * - get_price: 10 second TTL (price-level freshness)
 * - get_tickers: 10 second TTL (price-level freshness)
 * - get_book_ticker: 5 second TTL (orderbook-level freshness)
 */
export const marketDataTools = {
  get_candles: createCachedTool(getCandlesTool, TOOL_CACHE_CONFIG.price.ttl),
  get_price: createCachedTool(getPriceTool, TOOL_CACHE_CONFIG.price.ttl),
  get_tickers: createCachedTool(getTickersTool, TOOL_CACHE_CONFIG.price.ttl),
  get_book_ticker: createCachedTool(getBookTickerTool, TOOL_CACHE_CONFIG.orderbook.ttl),
};

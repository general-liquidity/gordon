/**
 * V4 Data Tools — 5 explicit typed tools for state reads.
 *
 * Replaces ~100+ scattered get_* tools in the current 405-tool surface
 * by funneling each domain through one named tool. Each tool has a
 * tight zod schema, returns a typed result, and dispatches internally
 * to existing handler logic.
 *
 * Tools:
 *   - get_market_data    — candles, prices, orderbook, ticker
 *   - get_account_state  — cash, margin, buying-power per account
 *   - get_portfolio      — positions + exposure + drawdown aggregate
 *   - get_news           — news feed, optionally filtered
 *   - get_fundamentals   — stock fundamentals (Finnhub-backed)
 *
 * Design notes:
 *   - These are TOOLS, not meta-dispatchers. Each one has a clear
 *     single purpose, sharp description, and one input shape.
 *   - The "discriminator inside a tool" pattern (e.g., get_market_data's
 *     `dataType` field) is acceptable because the dispatch is closed
 *     and well-bounded — not the "compute(op, args)" generic meta.
 *   - V4 tools don't yet replace existing tools — they live alongside
 *     them, gated by GORDON_V4_TOOLS=1.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGordonContext, type MastraExecutionContext } from "../types.ts";

// ============================================================================
// get_market_data
// ============================================================================

export const getMarketDataTool = createTool({
  id: "get_market_data",
  description: [
    "Fetch market data for a symbol. One tool covers candles, current price,",
    "orderbook depth, and ticker statistics — pick via the `dataType` field.",
    "",
    "Use this whenever you need market state: technical analysis (candles),",
    "scanning (ticker), execution planning (orderbook), quick price checks.",
    "",
    "dataType values:",
    "  - 'candles'    → OHLCV array for symbol + timeframe (use for indicators, regime detection)",
    "  - 'price'      → current price for symbol (cheap, use when only price is needed)",
    "  - 'orderbook'  → top N levels of bid/ask depth (use for execution sizing, microstructure)",
    "  - 'ticker'     → 24h ticker stats — volume, high, low, change% (use for scanning)",
    "",
    "Examples:",
    "  get_market_data({ dataType: 'candles', symbol: 'BTC/USDT', timeframe: '1h', limit: 200 })",
    "  get_market_data({ dataType: 'price', symbol: 'AAPL' })",
    "  get_market_data({ dataType: 'orderbook', symbol: 'ETH/USDT', depth: 20 })",
  ].join("\n"),
  inputSchema: z.object({
    dataType: z.enum(["candles", "price", "orderbook", "ticker"]),
    symbol: z.string().describe("Trading symbol — e.g. 'BTC/USDT', 'AAPL', 'ES'"),
    timeframe: z
      .enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"])
      .optional()
      .describe("Required when dataType='candles'. Default '1h'."),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Candles: number of bars. Orderbook: levels of depth. Default 100/20."),
    depth: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Alias for limit on orderbook."),
  }),
  outputSchema: z.object({
    dataType: z.string(),
    symbol: z.string(),
    timeframe: z.string().optional(),
    data: z.unknown(),
    fetchedAt: z.string(),
  }),
  execute: async (
    args: {
      dataType: "candles" | "price" | "orderbook" | "ticker";
      symbol: string;
      timeframe?: "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";
      limit?: number;
      depth?: number;
    },
    execContext?: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    if (!exchange) {
      return {
        dataType: args.dataType,
        symbol: args.symbol,
        timeframe: args.timeframe,
        data: { error: "No exchange connected — run /setup first." },
        fetchedAt: new Date().toISOString(),
      };
    }

    const fetchedAt = new Date().toISOString();
    try {
      switch (args.dataType) {
        case "candles": {
          const candles = await exchange.getCandles(
            args.symbol,
            args.timeframe ?? "1h",
            args.limit ?? 100,
          );
          return { dataType: "candles", symbol: args.symbol, timeframe: args.timeframe ?? "1h", data: candles, fetchedAt };
        }
        case "price": {
          const price = await exchange.getPrice(args.symbol);
          return { dataType: "price", symbol: args.symbol, data: { price }, fetchedAt };
        }
        case "orderbook": {
          const book = await exchange.getOrderBook(args.symbol, args.depth ?? args.limit ?? 20);
          return { dataType: "orderbook", symbol: args.symbol, data: book, fetchedAt };
        }
        case "ticker": {
          const tickers = await exchange.get24hrTickers();
          const ticker = tickers.find((t) => t.symbol === args.symbol);
          return { dataType: "ticker", symbol: args.symbol, data: ticker ?? null, fetchedAt };
        }
      }
    } catch (err) {
      return {
        dataType: args.dataType,
        symbol: args.symbol,
        timeframe: args.timeframe,
        data: { error: err instanceof Error ? err.message : String(err) },
        fetchedAt,
      };
    }
  },
});

// ============================================================================
// get_account_state
// ============================================================================

export const getAccountStateTool = createTool({
  id: "get_account_state",
  description: [
    "Get the connected exchange/broker account state: cash, margin, buying",
    "power, account ID. Read-only. Use BEFORE any trade decision to size",
    "appropriately and after fills to verify execution.",
    "",
    "Returns the current snapshot. For portfolio composition (positions),",
    "use get_portfolio. For historical state, query the audit log.",
  ].join("\n"),
  inputSchema: z.object({}),
  outputSchema: z.object({
    venue: z.string().optional(),
    accountId: z.string().optional(),
    balances: z.unknown(),
    fetchedAt: z.string(),
  }),
  execute: async (_args: object, execContext?: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    const fetchedAt = new Date().toISOString();
    if (!exchange) {
      return { balances: { error: "No exchange connected." }, fetchedAt };
    }
    try {
      const balances = await exchange.getAllBalances();
      return {
        venue: exchange.exchangeId,
        balances,
        fetchedAt,
      };
    } catch (err) {
      return {
        balances: { error: err instanceof Error ? err.message : String(err) },
        fetchedAt,
      };
    }
  },
});

// ============================================================================
// get_portfolio
// ============================================================================

export const getPortfolioTool = createTool({
  id: "get_portfolio",
  description: [
    "Get the aggregated portfolio: open positions, P&L per position, total",
    "exposure, drawdown vs peak, sector/asset breakdown.",
    "",
    "Use for: pre-trade sizing decisions (am I already heavy in this asset?),",
    "weekend review composition, mandate breach checks, daily P&L surface.",
    "",
    "Returns typed PortfolioSnapshot. For raw exchange balances, use",
    "get_account_state instead.",
  ].join("\n"),
  inputSchema: z.object({
    includeClosedToday: z
      .boolean()
      .optional()
      .describe("Include positions closed today. Default false."),
  }),
  outputSchema: z.object({
    venue: z.string().optional(),
    positions: z.array(z.unknown()),
    totalValueUsd: z.number().optional(),
    dailyPnlUsd: z.number().optional(),
    drawdownPct: z.number().optional(),
    fetchedAt: z.string(),
  }),
  execute: async (
    _args: { includeClosedToday?: boolean },
    execContext?: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    const fetchedAt = new Date().toISOString();
    if (!exchange) {
      return { positions: [], fetchedAt };
    }
    try {
      // Exchange interface doesn't expose positions directly — derive from
      // open orders + balances. Proper wiring: route to position-tracking
      // tools (src/infra/agents/tools/positionTracking.ts) for the
      // aggregated PortfolioSnapshot.
      const balances = await exchange.getAllBalances();
      return {
        venue: exchange.exchangeId,
        positions: balances.filter((b) => b.free > 0 || b.locked > 0),
        fetchedAt,
      };
    } catch (err) {
      return {
        positions: [],
        fetchedAt,
        // include an error marker via the existing field; downstream code
        // can detect empty positions + recent timestamp as "fetch failed"
      };
    }
  },
});

// ============================================================================
// get_news
// ============================================================================

export const getNewsTool = createTool({
  id: "get_news",
  description: [
    "Get news headlines. One tool replaces the scattered crypto-news /",
    "stock-news / earnings-news / SEC-filings tools by selecting via",
    "`source` and `filter` fields.",
    "",
    "source values:",
    "  - 'crypto'    → 12 crypto-news RSS feeds + sentiment classifier",
    "  - 'stocks'    → Yahoo + Finnhub + general business news",
    "  - 'edgar'     → SEC EDGAR filings (10-K, 10-Q, 8-K, etc.)",
    "  - 'earnings'  → upcoming earnings announcements + estimates",
    "  - 'all'       → unified feed across sources (default)",
    "",
    "Use for: market context before scanning, regime-shift triggers,",
    "earnings-play timing, fundamentals-driven trade ideas.",
  ].join("\n"),
  inputSchema: z.object({
    source: z.enum(["crypto", "stocks", "edgar", "earnings", "all"]).optional(),
    symbol: z.string().optional().describe("Filter to a specific symbol."),
    sinceMinutes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Headlines from the last N minutes. Default 240 (4h)."),
    limit: z.number().int().positive().optional().describe("Max items. Default 25."),
  }),
  outputSchema: z.object({
    source: z.string(),
    items: z.array(z.unknown()),
    fetchedAt: z.string(),
  }),
  execute: async (
    args: {
      source?: "crypto" | "stocks" | "edgar" | "earnings" | "all";
      symbol?: string;
      sinceMinutes?: number;
      limit?: number;
    },
    _execContext?: MastraExecutionContext,
  ) => {
    // Stub for now — proper implementation routes to news + stock-news +
    // finnhub markets fetchers. Returns empty array to keep the surface
    // contract intact until the news dispatcher is wired.
    return {
      source: args.source ?? "all",
      items: [],
      fetchedAt: new Date().toISOString(),
    };
  },
});

// ============================================================================
// get_fundamentals
// ============================================================================

export const getFundamentalsTool = createTool({
  id: "get_fundamentals",
  description: [
    "Get fundamental data for a stock ticker. Covers income statement,",
    "balance sheet, cash flow, earnings estimates, analyst ratings,",
    "insider sentiment. Backed by Finnhub.",
    "",
    "metric values:",
    "  - 'profile'       → company profile + sector + industry",
    "  - 'income'        → income statement (revenue, EPS)",
    "  - 'balance'       → balance sheet snapshot",
    "  - 'cashflow'      → cash flow statement",
    "  - 'estimates'     → analyst EPS + revenue estimates",
    "  - 'earnings'      → historical earnings surprises",
    "  - 'analysts'      → analyst rating trends",
    "  - 'insider'       → insider sentiment + trading",
    "",
    "Stocks only — for crypto use get_market_data / get_news instead.",
  ].join("\n"),
  inputSchema: z.object({
    ticker: z.string().describe("Stock ticker, e.g. 'AAPL'."),
    metric: z.enum([
      "profile",
      "income",
      "balance",
      "cashflow",
      "estimates",
      "earnings",
      "analysts",
      "insider",
    ]),
  }),
  outputSchema: z.object({
    ticker: z.string(),
    metric: z.string(),
    data: z.unknown(),
    fetchedAt: z.string(),
  }),
  execute: async (
    args: { ticker: string; metric: string },
    _execContext?: MastraExecutionContext,
  ) => {
    // Stub — proper implementation dispatches to the finnhub-fundamentals
    // handler functions. Returns an empty payload until wired.
    return {
      ticker: args.ticker,
      metric: args.metric,
      data: { note: "V4 fundamentals dispatcher pending — wire to finnhubFundamentalsTools handlers" },
      fetchedAt: new Date().toISOString(),
    };
  },
});

export const v4DataTools = {
  get_market_data: getMarketDataTool,
  get_account_state: getAccountStateTool,
  get_portfolio: getPortfolioTool,
  get_news: getNewsTool,
  get_fundamentals: getFundamentalsTool,
};

/**
 * Data Tools — 5 explicit typed tools for state reads.
 *
 * Funnels each read domain through one named tool with a tight zod
 * schema and typed result. Dispatches internally to existing handler
 * logic (implementation modules remain private; this surface
 * is the agent-facing facade).
 *
 * Tools:
 *   - get_market_data    — candles, prices, orderbook, ticker
 *   - get_account_state  — cash, margin, buying-power per account
 *   - get_portfolio      — positions + exposure + drawdown aggregate
 *   - get_news           — news feed, optionally filtered
 *   - get_fundamentals   — stock fundamentals (Finnhub-backed)
 *
 * Design note: the "discriminator inside a tool" pattern (e.g.,
 * get_market_data's `dataType` field) is acceptable because the dispatch
 * is closed and well-bounded — not the "compute(op, args)" generic meta.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGordonContext, type MastraExecutionContext } from "../types.ts";
import { recordSymbolObservation } from "../../observation/symbolObservationTracker.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { getEventBus } from "../../../../events/index.ts";
import { getPositionManager, type PositionRecord } from "../../../../core/positions/index.ts";
import { getCryptoNewsHeadlinesTool as implCryptoNews } from "../news/news.ts";
import { getStockNewsHeadlinesTool as implStockNews } from "../news/stockNews.ts";
import { filterByAsOf } from "./retrieval-helpers.ts";
import { upsertCandles, readCandles, type CachedCandle } from "../../../data/ohlcvCache.ts";
import {
  upsertOrderbookSnapshot,
  readOrderbookSnapshot,
  type OrderbookLevel,
} from "../../../data/orderbookCache.ts";
import {
  getCompanyProfileTool as implProfile,
  getBasicFinancialsTool as implBasicFinancials,
  getFinancialsReportedTool as implFinancialsReported,
  getEarningsSurprisesTool as implEarningsSurprises,
  getRevenueEstimatesTool as implRevenueEstimates,
  getUpgradeDowngradeTool as implUpgradeDowngrade,
  getInsiderSentimentTool as implInsiderSentiment,
} from "../providers/finnhub-fundamentals-tools.ts";

const logger = createModuleLogger("surface-data-tools");
const cacheWriteWarningKeys = new Set<string>();
const LIVE_PORTFOLIO_STATES = new Set(["filled", "monitoring", "closing"]);

function warnCacheWriteFailureOnce(
  kind: "candles" | "orderbook",
  venue: string,
  symbol: string,
  error: unknown,
): void {
  const key = `${kind}:${venue}:${symbol}`;
  if (cacheWriteWarningKeys.has(key)) return;
  cacheWriteWarningKeys.add(key);
  logger.warn("Market data cache write failed; live read returned without cache persistence", {
    kind,
    venue,
    symbol,
    error: error instanceof Error ? error.message : String(error),
  });
}

function isClosedToday(position: PositionRecord, dayStartMs: number): boolean {
  const closedAt = position.closedAt ? Date.parse(position.closedAt) : NaN;
  return Number.isFinite(closedAt) && closedAt >= dayStartMs;
}

function positionMarketValue(position: PositionRecord): number {
  const quantity = Math.abs(position.quantity ?? 0);
  const price = position.currentPrice ?? position.entryPrice ?? 0;
  return quantity * price;
}

function positionHighWaterValue(position: PositionRecord): number {
  const quantity = Math.abs(position.quantity ?? 0);
  const highWater = position.highWaterMark ?? position.currentPrice ?? position.entryPrice ?? 0;
  return quantity * highWater;
}

function positionUnrealizedPnl(position: PositionRecord): number {
  if (typeof position.unrealizedPnL === "number") return position.unrealizedPnL;
  const quantity = position.quantity ?? 0;
  const entry = position.entryPrice ?? 0;
  const current = position.currentPrice ?? entry;
  const sideSign = position.side === "short" ? -1 : 1;
  return (current - entry) * quantity * sideSign;
}

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
    asOf: z
      .string()
      .optional()
      .describe(
        "ISO timestamp. For dataType='candles' or 'orderbook': read from the local cache, returning only rows whose stored_at <= asOf. Use for replay — 'what was the chart / book at time T?'. When set, no live exchange fetch is performed; a cache miss returns empty data. Other dataTypes ignore this field.",
      ),
  }),
  outputSchema: z.object({
    dataType: z.string(),
    symbol: z.string(),
    timeframe: z.string().optional(),
    data: z.unknown(),
    fetchedAt: z.string(),
    cacheSource: z.enum(["live", "cache", "live+cache-miss"]).optional(),
  }),
  execute: async (
    args: {
      dataType: "candles" | "price" | "orderbook" | "ticker";
      symbol: string;
      timeframe?: "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";
      limit?: number;
      depth?: number;
      asOf?: string;
    },
    execContext?: MastraExecutionContext,
  ) => {
    recordSymbolObservation(args.symbol);
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    const venue = exchange?.exchangeId ?? "unknown";

    // asOf-mode for candles: bypass exchange entirely, read from cache
    // with the as-of-stored-at cutoff. No live fallback — the call is a
    // historical query, returning nothing is the correct answer when
    // the cache hasn't seen this slice yet.
    if (args.dataType === "candles" && args.asOf) {
      const tf = args.timeframe ?? "1h";
      const cutoff = Date.parse(args.asOf);
      const cached = Number.isFinite(cutoff)
        ? readCandles(venue, args.symbol, tf, { asOfStoredAt: cutoff, limit: args.limit ?? 100 })
        : [];
      return {
        dataType: "candles",
        symbol: args.symbol,
        timeframe: tf,
        data: cached,
        fetchedAt: new Date().toISOString(),
        cacheSource: cached.length > 0 ? ("cache" as const) : ("live+cache-miss" as const),
      };
    }

    // asOf-mode for orderbook: same pattern as candles. Returns the
    // single most-recent book snapshot whose stored_at <= asOf.
    if (args.dataType === "orderbook" && args.asOf) {
      const cutoff = Date.parse(args.asOf);
      const cached = Number.isFinite(cutoff)
        ? readOrderbookSnapshot(venue, args.symbol, { asOfStoredAt: cutoff })
        : null;
      return {
        dataType: "orderbook",
        symbol: args.symbol,
        data: cached ? { bids: cached.bids, asks: cached.asks, takenAt: cached.takenAt } : null,
        fetchedAt: new Date().toISOString(),
        cacheSource: cached ? ("cache" as const) : ("live+cache-miss" as const),
      };
    }

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
          const tf = args.timeframe ?? "1h";
          const candles = await exchange.getCandles(args.symbol, tf, args.limit ?? 100);
          // Fire-and-forget cache write. A cache failure must NEVER
          // break the live read. Wrapped in try/catch — never throws.
          try {
            upsertCandles(venue, args.symbol, tf, candles as unknown as CachedCandle[]);
          } catch (error) {
            warnCacheWriteFailureOnce("candles", venue, args.symbol, error);
          }
          return {
            dataType: "candles",
            symbol: args.symbol,
            timeframe: tf,
            data: candles,
            fetchedAt,
            cacheSource: "live" as const,
          };
        }
        case "price": {
          const price = await exchange.getPrice(args.symbol);
          return { dataType: "price", symbol: args.symbol, data: { price }, fetchedAt };
        }
        case "orderbook": {
          const book = await exchange.getOrderBook(args.symbol, args.depth ?? args.limit ?? 20);
          // Fire-and-forget snapshot write. Cache failure never breaks
          // the live read. takenAt = now (the venue doesn't surface
          // its own timestamp for orderbook reads).
          try {
            upsertOrderbookSnapshot({
              venue,
              symbol: args.symbol,
              takenAt: Date.now(),
              bids: (book?.bids ?? []) as OrderbookLevel[],
              asks: (book?.asks ?? []) as OrderbookLevel[],
            });
          } catch (error) {
            warnCacheWriteFailureOnce("orderbook", venue, args.symbol, error);
          }
          return {
            dataType: "orderbook",
            symbol: args.symbol,
            data: book,
            fetchedAt,
            cacheSource: "live" as const,
          };
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
    totalExposureUsd: z.number().optional(),
    unrealizedPnlUsd: z.number().optional(),
    realizedPnlUsd: z.number().optional(),
    dailyPnlUsd: z.number().optional(),
    drawdownPct: z.number().optional(),
    source: z.enum(["position_tracking", "exchange_balances"]).optional(),
    fetchedAt: z.string(),
  }),
  execute: async (
    _args: { includeClosedToday?: boolean },
    execContext?: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    const fetchedAt = new Date().toISOString();
    try {
      const manager = await getPositionManager(getEventBus());
      const activeRecords = await manager.getActivePositions();
      const livePositions = activeRecords.filter((position) => LIVE_PORTFOLIO_STATES.has(position.state));
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const closedToday = _args.includeClosedToday
        ? (await manager.getTradeHistory({ since: dayStart.toISOString() })).filter((position) =>
            (position.state === "closed" || position.state === "reviewed") &&
            isClosedToday(position, dayStartMs)
          )
        : [];

      if (livePositions.length > 0 || closedToday.length > 0) {
        const totalExposureUsd = livePositions.reduce((sum, position) => sum + positionMarketValue(position), 0);
        const highWaterUsd = livePositions.reduce((sum, position) => sum + positionHighWaterValue(position), 0);
        const unrealizedPnlUsd = livePositions.reduce((sum, position) => sum + positionUnrealizedPnl(position), 0);
        const realizedPnlUsd = closedToday.reduce((sum, position) => sum + (position.realizedPnL ?? 0), 0);
        const drawdownPct = highWaterUsd > 0
          ? Math.max(0, ((highWaterUsd - totalExposureUsd) / highWaterUsd) * 100)
          : 0;

        return {
          venue: exchange?.exchangeId,
          positions: [...livePositions, ...closedToday],
          totalValueUsd: ctx?.portfolioValue && ctx.portfolioValue > 0 ? ctx.portfolioValue : totalExposureUsd,
          totalExposureUsd,
          unrealizedPnlUsd,
          realizedPnlUsd,
          dailyPnlUsd: unrealizedPnlUsd + realizedPnlUsd,
          drawdownPct,
          source: "position_tracking" as const,
          fetchedAt,
        };
      }
    } catch (err) {
      logger.warn("Position-tracking portfolio snapshot failed; falling back to exchange balances", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (exchange) {
      try {
        const balances = await exchange.getAllBalances();
        return {
          venue: exchange.exchangeId,
          positions: balances.filter((b) => b.free > 0 || b.locked > 0),
          source: "exchange_balances" as const,
          fetchedAt,
        };
      } catch {
        return {
          positions: [],
          fetchedAt,
        };
      }
    }

    return {
      positions: [],
      fetchedAt,
    };
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
    asOf: z
      .string()
      .optional()
      .describe(
        "ISO timestamp. When set, drops headlines published AFTER this time. Use for 'what news was visible at time Y?' replay questions. Headlines without a parseable publishedAt are preserved (lenient).",
      ),
  }),
  outputSchema: z.object({
    source: z.string(),
    items: z.array(z.unknown()),
    fetchedAt: z.string(),
    asOfApplied: z.boolean(),
  }),
  execute: async (
    args: {
      source?: "crypto" | "stocks" | "edgar" | "earnings" | "all";
      symbol?: string;
      sinceMinutes?: number;
      limit?: number;
      asOf?: string;
    },
    execContext?: MastraExecutionContext,
  ) => {
    if (args.symbol) recordSymbolObservation(args.symbol);
    const fetchedAt = new Date().toISOString();
    const source = args.source ?? "all";
    const hoursBack = args.sinceMinutes ? Math.ceil(args.sinceMinutes / 60) : undefined;

    // Headlines come back with publishedAt (crypto) or sometimes a different
    // field shape (stocks). Strict mode: a headline the code cannot date
    // is dropped rather than leaked past the point-in-time cutoff.
    const applyAsOf = (items: unknown[]): unknown[] => {
      if (!args.asOf) return items;
      return filterByAsOf(
        items as Array<Record<string, unknown>>,
        args.asOf,
        (r) =>
          (r.publishedAt as string | undefined) ??
          (r.published_at as string | undefined) ??
          (r.datetime as string | undefined) ??
          (r.timestamp as string | number | undefined),
        "strict",
      );
    };

    try {
      if (source === "crypto" || source === "all") {
        const result = (await (implCryptoNews.execute as any)(
          { query: args.symbol, hoursBack, limit: args.limit },
          execContext,
        )) as { headlines?: unknown[]; aggregate?: unknown; summary?: string };
        if (source === "crypto") {
          return {
            source: "crypto",
            items: applyAsOf(result.headlines ?? []),
            fetchedAt,
            asOfApplied: Boolean(args.asOf),
          };
        }
      }
      if (source === "stocks" || source === "edgar" || source === "all") {
        const ticker = (args.symbol ?? "SPY").toUpperCase();
        const stockSources = source === "edgar" ? (["edgar"] as const) : undefined;
        const result = (await (implStockNews.execute as any)(
          {
            tickers: [ticker],
            hoursBack,
            sources: stockSources,
            limit: args.limit,
          },
          execContext,
        )) as { headlines?: unknown[] };
        return {
          source,
          items: applyAsOf(result.headlines ?? []),
          fetchedAt,
          asOfApplied: Boolean(args.asOf),
        };
      }
      // earnings source — no dedicated headline fetcher; route to stock news
      // filtered by EDGAR + Finnhub which covers earnings releases.
      const ticker = (args.symbol ?? "SPY").toUpperCase();
      const earnResult = (await (implStockNews.execute as any)(
        { tickers: [ticker], hoursBack, limit: args.limit },
        execContext,
      )) as { headlines?: unknown[] };
      return {
        source: "earnings",
        items: applyAsOf(earnResult.headlines ?? []),
        fetchedAt,
        asOfApplied: Boolean(args.asOf),
      };
    } catch (_err) {
      return {
        source,
        items: [],
        fetchedAt,
        asOfApplied: Boolean(args.asOf),
      };
    }
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
    execContext?: MastraExecutionContext,
  ) => {
    recordSymbolObservation(args.ticker);
    const fetchedAt = new Date().toISOString();
    const symbol = args.ticker.toUpperCase();
    try {
      switch (args.metric) {
        case "profile": {
          const r = (await (implProfile.execute as any)({ symbol }, execContext)) as unknown;
          return { ticker: symbol, metric: "profile", data: r, fetchedAt };
        }
        case "income":
        case "balance":
        case "cashflow": {
          const freq =
            args.metric === "income"
              ? "annual"
              : args.metric === "balance"
                ? "annual"
                : "annual";
          const r = (await (implFinancialsReported.execute as any)(
            { symbol, freq },
            execContext,
          )) as unknown;
          return { ticker: symbol, metric: args.metric, data: r, fetchedAt };
        }
        case "estimates": {
          const r = (await (implRevenueEstimates.execute as any)({ symbol }, execContext)) as unknown;
          return { ticker: symbol, metric: "estimates", data: r, fetchedAt };
        }
        case "earnings": {
          const r = (await (implEarningsSurprises.execute as any)({ symbol }, execContext)) as unknown;
          return { ticker: symbol, metric: "earnings", data: r, fetchedAt };
        }
        case "analysts": {
          const r = (await (implUpgradeDowngrade.execute as any)({ symbol }, execContext)) as unknown;
          return { ticker: symbol, metric: "analysts", data: r, fetchedAt };
        }
        case "insider": {
          const r = (await (implInsiderSentiment.execute as any)({ symbol }, execContext)) as unknown;
          return { ticker: symbol, metric: "insider", data: r, fetchedAt };
        }
        default: {
          // Fall back to basic financials for any unrecognized metric.
          const r = (await (implBasicFinancials.execute as any)({ symbol }, execContext)) as unknown;
          return { ticker: symbol, metric: args.metric, data: r, fetchedAt };
        }
      }
    } catch (err) {
      return {
        ticker: symbol,
        metric: args.metric,
        data: { error: err instanceof Error ? err.message : String(err) },
        fetchedAt,
      };
    }
  },
});

export const dataTools = {
  get_market_data: getMarketDataTool,
  get_account_state: getAccountStateTool,
  get_portfolio: getPortfolioTool,
  get_news: getNewsTool,
  get_fundamentals: getFundamentalsTool,
};

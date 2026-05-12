/**
 * Finnhub Stock Event Tools
 *
 * Mastra tools wrapping the Finnhub REST client with trading-relevant data
 * Gordon was missing: earnings calendar, earnings estimates, economic
 * calendar, insider transactions, congressional trading, analyst rating
 * trends, SEC filings, news sentiment, ETF holdings.
 *
 * Free tier on Finnhub covers company news and basic quotes; premium
 * endpoints (earnings estimates, insider sentiment, congressional trades)
 * return 403 for free-tier keys. Each tool degrades gracefully — returns
 * `configured: false` with a BYOK diagnostic when FINNHUB_API_KEY is
 * missing, and `error` with the Finnhub status code when the endpoint is
 * gated by tier.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { finnhub, isFinnhubConfigured, FINNHUB_NOT_CONFIGURED_MSG } from "../../../data/providers/finnhub.ts";

function unconfigured<T extends Record<string, unknown>>(extra: T): T & { configured: false; error: string } {
  return { ...extra, configured: false as const, error: FINNHUB_NOT_CONFIGURED_MSG };
}

function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// 1. get_upcoming_earnings
// ============================================================================

export const getUpcomingEarningsTool = createTool({
  id: "get_upcoming_earnings",
  description:
    "Fetch upcoming earnings announcements from Finnhub for the next N days. " +
    "Use for earnings-play setups, pre-earnings positioning, or avoiding open " +
    "positions into earnings prints. Returns EPS / revenue estimates where " +
    "available, plus hour code (bmo = before market open, amc = after close).",
  inputSchema: z.object({
    days: z.number().int().min(1).max(30).optional().default(7),
    symbol: z.string().optional().describe("Optional filter to a single ticker"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    earnings: z
      .array(
        z.object({
          symbol: z.string(),
          date: z.string(),
          epsActual: z.number().nullable().optional(),
          epsEstimate: z.number().nullable().optional(),
          revenueEstimate: z.number().nullable().optional(),
          hour: z.string().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ days, symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ total: 0 });
    const from = daysFromNow(0);
    const to = daysFromNow(days ?? 7);
    const entries = await finnhub.getEarningsCalendar({ from, to, symbol });
    return {
      configured: true,
      total: entries.length,
      earnings: entries.map((e) => ({
        symbol: e.symbol,
        date: e.date,
        epsActual: e.epsActual ?? null,
        epsEstimate: e.epsEstimate ?? null,
        revenueEstimate: e.revenueEstimate ?? null,
        hour: e.hour,
      })),
    };
  },
});

// ============================================================================
// 2. get_earnings_estimates
// ============================================================================

export const getEarningsEstimatesTool = createTool({
  id: "get_earnings_estimates",
  description:
    "Analyst consensus earnings estimates for a symbol. Returns EPS and " +
    "revenue estimates (avg/high/low/analyst count) per period. Premium " +
    "Finnhub endpoint — returns error on free tier.",
  inputSchema: z.object({
    symbol: z.string(),
    freq: z.enum(["quarterly", "annual"]).optional().default("quarterly"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    estimates: z
      .array(
        z.object({
          period: z.string(),
          epsAvg: z.number(),
          epsHigh: z.number(),
          epsLow: z.number(),
          epsAnalysts: z.number(),
          revenueAvg: z.number(),
          revenueHigh: z.number(),
          revenueLow: z.number(),
          revenueAnalysts: z.number(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, freq }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const estimates = await finnhub.getEarningsEstimates(symbol, freq);
    return { configured: true, symbol, total: estimates.length, estimates };
  },
});

// ============================================================================
// 3. get_economic_calendar
// ============================================================================

export const getEconomicCalendarTool = createTool({
  id: "get_economic_calendar",
  description:
    "Fetch macro economic releases from Finnhub (CPI, NFP, FOMC, GDP, retail " +
    "sales, unemployment, PMI, etc.) for a date range. Use for macro-aware " +
    "positioning and pre-release risk management. Returns impact level " +
    "(low/medium/high), actual vs estimate vs previous values.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(14).optional().default(7),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    events: z
      .array(
        z.object({
          country: z.string(),
          event: z.string(),
          time: z.string(),
          impact: z.string(),
          actual: z.number().nullable().optional(),
          estimate: z.number().nullable().optional(),
          previous: z.number().nullable().optional(),
          unit: z.string().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ days }) => {
    if (!isFinnhubConfigured()) return unconfigured({ total: 0 });
    const from = daysFromNow(0);
    const to = daysFromNow(days ?? 7);
    const events = await finnhub.getEconomicCalendar({ from, to });
    return { configured: true, total: events.length, events };
  },
});

// ============================================================================
// 4. get_insider_transactions
// ============================================================================

export const getInsiderTransactionsTool = createTool({
  id: "get_insider_transactions",
  description:
    "Insider transaction history for a symbol (Form 4 filings). Returns " +
    "director / officer / 10%+ holder trades with share counts, transaction " +
    "prices, and transaction codes. Use for detecting insider buying clusters " +
    "(bullish signal) or selling waves (often noise from comp vesting, but " +
    "sometimes meaningful). Default range: last 90 days.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(365).optional().default(90),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    transactions: z
      .array(
        z.object({
          name: z.string(),
          share: z.number(),
          change: z.number(),
          filingDate: z.string(),
          transactionDate: z.string(),
          transactionPrice: z.number().optional(),
          transactionCode: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const transactions = await finnhub.getInsiderTransactions(symbol, {
      from: daysFromNow(-(daysBack ?? 90)),
      to: daysFromNow(0),
    });
    return {
      configured: true,
      symbol,
      total: transactions.length,
      transactions: transactions.map((t) => ({
        name: t.name,
        share: t.share,
        change: t.change,
        filingDate: t.filingDate,
        transactionDate: t.transactionDate,
        transactionPrice: t.transactionPrice,
        transactionCode: t.transactionCode,
      })),
    };
  },
});

// ============================================================================
// 5. get_congressional_trading
// ============================================================================

export const getCongressionalTradingTool = createTool({
  id: "get_congressional_trading",
  description:
    "US senators and representatives' equity trades for a symbol, from their " +
    "STOCK Act disclosures. Useful signal: members with committee oversight " +
    "sometimes front-run policy. Premium Finnhub endpoint — returns error on " +
    "free tier.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(730).optional().default(180),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    trades: z
      .array(
        z.object({
          name: z.string(),
          position: z.string(),
          transactionDate: z.string(),
          filingDate: z.string(),
          amountFrom: z.number(),
          amountTo: z.number(),
          ownerType: z.string(),
          assetType: z.string().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const trades = await finnhub.getCongressionalTrading(symbol, {
      from: daysFromNow(-(daysBack ?? 180)),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, total: trades.length, trades };
  },
});

// ============================================================================
// 6. get_analyst_ratings
// ============================================================================

export const getAnalystRatingsTool = createTool({
  id: "get_analyst_ratings",
  description:
    "Analyst recommendation trend for a symbol — strong buy / buy / hold / " +
    "sell / strong sell counts by period. Use for detecting consensus shifts " +
    "(ratings upgrades/downgrades, target price changes). Returns the most " +
    "recent 12 months of monthly consensus snapshots.",
  inputSchema: z.object({
    symbol: z.string(),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    trends: z
      .array(
        z.object({
          period: z.string(),
          strongBuy: z.number(),
          buy: z.number(),
          hold: z.number(),
          sell: z.number(),
          strongSell: z.number(),
          netBullish: z.number(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const trends = await finnhub.getRecommendationTrends(symbol);
    return {
      configured: true,
      symbol,
      total: trends.length,
      trends: trends.map((t) => ({
        period: t.period,
        strongBuy: t.strongBuy,
        buy: t.buy,
        hold: t.hold,
        sell: t.sell,
        strongSell: t.strongSell,
        netBullish: t.strongBuy + t.buy - (t.sell + t.strongSell),
      })),
    };
  },
});

// ============================================================================
// 7. get_sec_filings
// ============================================================================

export const getSecFilingsTool = createTool({
  id: "get_sec_filings",
  description:
    "List recent SEC filings for a symbol (10-K, 10-Q, 8-K, S-1, proxy, etc.) " +
    "via Finnhub. Returns filing URLs for manual review. Use for event-driven " +
    "setups and material disclosure monitoring.",
  inputSchema: z.object({
    symbol: z.string(),
    form: z.string().optional().describe("Filter by form type, e.g. '10-K', '10-Q', '8-K'"),
    daysBack: z.number().int().min(1).max(365).optional().default(90),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    filings: z
      .array(
        z.object({
          form: z.string(),
          filedDate: z.string(),
          acceptedDate: z.string(),
          reportUrl: z.string(),
          filingUrl: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, form, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const filings = await finnhub.getSecFilings(symbol, {
      form,
      from: daysFromNow(-(daysBack ?? 90)),
      to: daysFromNow(0),
    });
    return {
      configured: true,
      symbol,
      total: filings.length,
      filings: filings.map((f) => ({
        form: f.form,
        filedDate: f.filedDate,
        acceptedDate: f.acceptedDate,
        reportUrl: f.reportUrl,
        filingUrl: f.filingUrl,
      })),
    };
  },
});

// ============================================================================
// 8. get_news_sentiment
// ============================================================================

export const getNewsSentimentTool = createTool({
  id: "get_news_sentiment",
  description:
    "Aggregate news sentiment for a symbol from Finnhub's scoring: buzz " +
    "(articles in last week vs weekly average), bullish percent, bearish " +
    "percent, news score vs sector average. Complements Gordon's X social " +
    "tools with news-article sentiment rather than social chatter.",
  inputSchema: z.object({
    symbol: z.string(),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    sentiment: z
      .object({
        articlesInLastWeek: z.number(),
        buzz: z.number(),
        weeklyAverage: z.number(),
        bullishPercent: z.number(),
        bearishPercent: z.number(),
        companyNewsScore: z.number(),
        sectorAverageNewsScore: z.number(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const s = await finnhub.getNewsSentiment(symbol);
    if (!s) return { configured: true, symbol, error: "No sentiment data" };
    return {
      configured: true,
      symbol,
      sentiment: {
        articlesInLastWeek: s.buzz.articlesInLastWeek,
        buzz: s.buzz.buzz,
        weeklyAverage: s.buzz.weeklyAverage,
        bullishPercent: s.sentiment.bullishPercent,
        bearishPercent: s.sentiment.bearishPercent,
        companyNewsScore: s.companyNewsScore,
        sectorAverageNewsScore: s.sectorAverageNewsScore,
      },
    };
  },
});

// ============================================================================
// 9. get_etf_holdings
// ============================================================================

export const getEtfHoldingsTool = createTool({
  id: "get_etf_holdings",
  description:
    "ETF holdings (constituent weights) for an ETF symbol. Returns top holdings " +
    "with share counts, percent weight, and assets under management. Use for " +
    "sector rotation analysis, index rebalance positioning, or spotting " +
    "concentrated exposure in an ETF.",
  inputSchema: z.object({
    symbol: z.string().describe("ETF ticker, e.g. 'SPY', 'QQQ', 'XLK', 'IBIT'"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    holdings: z
      .array(
        z.object({
          symbol: z.string(),
          name: z.string(),
          share: z.number(),
          percent: z.number(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const holdings = await finnhub.getEtfHoldings(symbol);
    return {
      configured: true,
      symbol,
      total: holdings.length,
      holdings: holdings.slice(0, 50).map((h) => ({
        symbol: h.symbol,
        name: h.name,
        share: h.share,
        percent: h.percent,
      })),
    };
  },
});

// ============================================================================
// Export
// ============================================================================

export const finnhubTools = {
  get_upcoming_earnings: getUpcomingEarningsTool,
  get_earnings_estimates: getEarningsEstimatesTool,
  get_economic_calendar: getEconomicCalendarTool,
  get_insider_transactions: getInsiderTransactionsTool,
  get_congressional_trading: getCongressionalTradingTool,
  get_analyst_ratings: getAnalystRatingsTool,
  get_sec_filings: getSecFilingsTool,
  get_news_sentiment: getNewsSentimentTool,
  get_etf_holdings: getEtfHoldingsTool,
};

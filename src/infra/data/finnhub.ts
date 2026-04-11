/**
 * Finnhub REST Client
 *
 * Thin fetch-based wrapper around Finnhub's REST API. Mirrors the Finnhub
 * Python SDK's endpoint coverage but only for the surfaces Gordon actually
 * needs — earnings calendar and estimates, economic calendar, SEC filings,
 * insider transactions, congressional trading, analyst ratings, and news
 * sentiment. Deliberately narrow: we're filling data gaps Gordon has on the
 * stock side, not trying to be a general-purpose Finnhub client.
 *
 * Auth: single FINNHUB_API_KEY env var, passed as `?token=...` query param.
 * If missing, methods return empty results and a clear diagnostic — same
 * BYOK pattern as the X social intelligence tools. Free tier covers quotes,
 * company news, and basic fundamentals; premium endpoints (earnings
 * estimates, congressional trades, insider sentiment) require a paid tier
 * and return 403 for free-tier keys.
 *
 * Rate limits: Finnhub free tier is 60 requests/minute. This client doesn't
 * enforce its own limiter — the caller (via tool rate limiter) handles that.
 */

import { Cache } from "../platform/cache/cache.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("finnhub");
const BASE_URL = "https://finnhub.io/api/v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

const responseCache = new Cache<unknown>({ defaultTtl: CACHE_TTL_MS });

// ============================================================================
// Types
// ============================================================================

export interface FinnhubEarningsCalendarEntry {
  symbol: string;
  date: string;
  epsActual?: number | null;
  epsEstimate?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  hour?: "bmo" | "amc" | "dmh"; // before market open / after market close / during market hours
  year?: number;
  quarter?: number;
}

export interface FinnhubEarningsEstimate {
  symbol: string;
  period: string;
  epsAvg: number;
  epsHigh: number;
  epsLow: number;
  epsAnalysts: number;
  revenueAvg: number;
  revenueHigh: number;
  revenueLow: number;
  revenueAnalysts: number;
}

export interface FinnhubEconomicEvent {
  country: string;
  event: string;
  time: string;
  impact: "low" | "medium" | "high";
  actual?: number | null;
  estimate?: number | null;
  previous?: number | null;
  unit?: string;
}

export interface FinnhubInsiderTransaction {
  symbol: string;
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionPrice?: number;
  transactionCode: string;
}

export interface FinnhubCongressionalTrade {
  symbol: string;
  name: string;
  position: string;
  transactionDate: string;
  filingDate: string;
  amountFrom: number;
  amountTo: number;
  ownerType: string;
  assetType?: string;
}

export interface FinnhubRecommendationTrend {
  symbol: string;
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface FinnhubSecFiling {
  accessNumber: string;
  symbol: string;
  cik: string;
  form: string;
  filedDate: string;
  acceptedDate: string;
  reportUrl: string;
  filingUrl: string;
}

export interface FinnhubNewsSentiment {
  symbol: string;
  buzz: {
    articlesInLastWeek: number;
    buzz: number;
    weeklyAverage: number;
  };
  sentiment: {
    bearishPercent: number;
    bullishPercent: number;
  };
  companyNewsScore: number;
  sectorAverageNewsScore: number;
}

export interface FinnhubEtfHolding {
  symbol: string;
  name: string;
  isin?: string;
  cusip?: string;
  share: number;
  percent: number;
  assetsUnderManagement: number;
}

// ============================================================================
// Client
// ============================================================================

function getApiKey(): string | null {
  return process.env.FINNHUB_API_KEY ?? null;
}

export function isFinnhubConfigured(): boolean {
  return getApiKey() !== null;
}

export const FINNHUB_NOT_CONFIGURED_MSG =
  "Finnhub API not configured. Set FINNHUB_API_KEY in ~/.gordon/.env to enable " +
  "stock fundamentals, earnings calendar, economic calendar, insider trading, " +
  "and congressional trading tools. Get a free key at https://finnhub.io/register " +
  "(60 req/min free tier; premium tiers needed for earnings estimates and " +
  "alternative data).";

async function finnhubGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: FINNHUB_NOT_CONFIGURED_MSG };
  }

  const query = new URLSearchParams({ token: apiKey });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") query.set(k, String(v));
  }
  const url = `${BASE_URL}${path}?${query.toString()}`;
  const cacheKey = `${path}:${query.toString().replace(apiKey, "")}`;

  const cached = responseCache.get(cacheKey);
  if (cached !== undefined) return { ok: true, data: cached as T };

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "gordon-cli/0.7" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        status: res.status,
        error: `Finnhub ${res.status}: check your API key or upgrade tier for this endpoint`,
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        status: res.status,
        error: "Finnhub 429: rate limit exceeded (60 req/min on free tier)",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `Finnhub ${res.status}: ${res.statusText}`,
      };
    }
    const data = (await res.json()) as T;
    responseCache.set(cacheKey, data);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("Finnhub request failed", { path, err: msg });
    return { ok: false, error: `Finnhub request failed: ${msg}` };
  }
}

// ============================================================================
// Endpoints
// ============================================================================

/** Earnings calendar for a date range (e.g., upcoming earnings for next 7 days). */
export async function getEarningsCalendar(options: {
  from: string;
  to: string;
  symbol?: string;
}): Promise<FinnhubEarningsCalendarEntry[]> {
  const res = await finnhubGet<{ earningsCalendar?: FinnhubEarningsCalendarEntry[] }>(
    "/calendar/earnings",
    options,
  );
  if (!res.ok) return [];
  return res.data.earningsCalendar ?? [];
}

/** Analyst earnings estimates for a specific symbol, quarterly or annual. */
export async function getEarningsEstimates(
  symbol: string,
  freq: "quarterly" | "annual" = "quarterly",
): Promise<FinnhubEarningsEstimate[]> {
  const res = await finnhubGet<{ data?: FinnhubEarningsEstimate[] }>(
    "/stock/eps-estimate",
    { symbol, freq },
  );
  if (!res.ok) return [];
  return res.data.data ?? [];
}

/** Economic calendar — macro releases across major economies. */
export async function getEconomicCalendar(options: {
  from?: string;
  to?: string;
} = {}): Promise<FinnhubEconomicEvent[]> {
  const res = await finnhubGet<{ economicCalendar?: FinnhubEconomicEvent[] }>(
    "/calendar/economic",
    options,
  );
  if (!res.ok) return [];
  return res.data.economicCalendar ?? [];
}

/** Insider transactions for a symbol (Form 4 filings). */
export async function getInsiderTransactions(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubInsiderTransaction[]> {
  const res = await finnhubGet<{ data?: FinnhubInsiderTransaction[] }>(
    "/stock/insider-transactions",
    { symbol, ...options },
  );
  if (!res.ok) return [];
  return res.data.data ?? [];
}

/** Congressional (senate/house) trading disclosures for a symbol. */
export async function getCongressionalTrading(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubCongressionalTrade[]> {
  const res = await finnhubGet<{ data?: FinnhubCongressionalTrade[] }>(
    "/stock/congressional-trading",
    { symbol, ...options },
  );
  if (!res.ok) return [];
  return res.data.data ?? [];
}

/** Analyst recommendation trend for a symbol — strong buy / buy / hold / sell / strong sell counts by period. */
export async function getRecommendationTrends(
  symbol: string,
): Promise<FinnhubRecommendationTrend[]> {
  const res = await finnhubGet<FinnhubRecommendationTrend[]>(
    "/stock/recommendation",
    { symbol },
  );
  if (!res.ok) return [];
  return res.data ?? [];
}

/** SEC filings list for a symbol — 10-K, 10-Q, 8-K, etc. */
export async function getSecFilings(
  symbol: string,
  options: { form?: string; from?: string; to?: string } = {},
): Promise<FinnhubSecFiling[]> {
  const res = await finnhubGet<FinnhubSecFiling[]>(
    "/stock/filings",
    { symbol, ...options },
  );
  if (!res.ok) return [];
  return res.data ?? [];
}

/** Aggregate news sentiment for a symbol (buzz + bullish/bearish percent). */
export async function getNewsSentiment(symbol: string): Promise<FinnhubNewsSentiment | null> {
  const res = await finnhubGet<FinnhubNewsSentiment>(
    "/news-sentiment",
    { symbol },
  );
  return res.ok ? res.data : null;
}

/** ETF holdings — constituent weights. Useful for detecting ETF inclusion/exclusion flow. */
export async function getEtfHoldings(symbol: string): Promise<FinnhubEtfHolding[]> {
  const res = await finnhubGet<{ holdings?: FinnhubEtfHolding[] }>(
    "/etf/holdings",
    { symbol },
  );
  if (!res.ok) return [];
  return res.data.holdings ?? [];
}

// ============================================================================
// Singleton accessor for tool callers
// ============================================================================

/** Exposed shape — kept small so tools can test configuration + call methods. */
export const finnhub = {
  isConfigured: isFinnhubConfigured,
  getEarningsCalendar,
  getEarningsEstimates,
  getEconomicCalendar,
  getInsiderTransactions,
  getCongressionalTrading,
  getRecommendationTrends,
  getSecFilings,
  getNewsSentiment,
  getEtfHoldings,
};

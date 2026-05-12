/**
 * Finnhub REST Client
 *
 * Comprehensive fetch-based wrapper around Finnhub's REST API covering
 * stocks, ETFs, mutual funds, bonds, indices, crypto, forex, and economic
 * data. Every wrapper uses the same `finnhubGet` helper so caching, auth,
 * error handling, and rate-limit surfacing are consistent across endpoints.
 *
 * Auth: single FINNHUB_API_KEY env var, passed as `?token=...` query param.
 * If missing, methods return empty results and a clear diagnostic — same
 * BYOK pattern as the X social intelligence tools. Free tier covers quotes,
 * company news, candles, and basic fundamentals; premium endpoints
 * (earnings estimates, congressional trades, insider sentiment, lobbying,
 * patents, supply chain, etc.) return 403 for free-tier keys.
 *
 * Rate limits: Finnhub free tier is 60 requests/minute. This client doesn't
 * enforce its own limiter — the caller (via tool rate limiter) handles that.
 */

import { Cache } from "../../platform/cache/cache.ts";
import { createModuleLogger } from "../../logger/index.ts";
import {
  checkEndpointRateLimit,
  recordEndpointCall,
} from "../../agents/tools/runtime/rate-limiter.ts";

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

  const endpointKey = path.replace(/^\//, "").split("/")[0] ?? "misc";
  const limitCheck = checkEndpointRateLimit("finnhub", endpointKey);
  if (!limitCheck.allowed) {
    const waitSec = Math.ceil((limitCheck.waitTimeMs ?? 0) / 1000);
    return {
      ok: false,
      status: 429,
      error: `Finnhub rate limit: ${limitCheck.reason ?? "endpoint throttled"}${waitSec > 0 ? ` (wait ${waitSec}s)` : ""}`,
    };
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "gordon-cli/0.7" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) recordEndpointCall("finnhub", endpointKey);
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
// Company Fundamentals
// ============================================================================

export interface FinnhubCompanyProfile {
  country: string;
  currency: string;
  exchange: string;
  ipo?: string;
  marketCapitalization?: number;
  name: string;
  phone?: string;
  shareOutstanding?: number;
  ticker: string;
  weburl?: string;
  logo?: string;
  finnhubIndustry?: string;
}

export async function getCompanyProfile(symbol: string): Promise<FinnhubCompanyProfile | null> {
  const res = await finnhubGet<FinnhubCompanyProfile>("/stock/profile2", { symbol });
  return res.ok ? res.data : null;
}

export interface FinnhubBasicFinancials {
  symbol: string;
  metricType: string;
  metric: Record<string, number | string | null>;
  series?: {
    annual?: Record<string, Array<{ period: string; v: number }>>;
    quarterly?: Record<string, Array<{ period: string; v: number }>>;
  };
}

export async function getBasicFinancials(
  symbol: string,
  metric: "all" | "price" | "valuation" | "margin" | "management" = "all",
): Promise<FinnhubBasicFinancials | null> {
  const res = await finnhubGet<FinnhubBasicFinancials>("/stock/metric", { symbol, metric });
  return res.ok ? res.data : null;
}

export interface FinnhubFinancialsReported {
  cik: string;
  data: Array<{
    accessNumber: string;
    symbol: string;
    cik: string;
    year: number;
    quarter: number;
    form: string;
    startDate: string;
    endDate: string;
    filedDate: string;
    acceptedDate: string;
    report: Record<string, unknown>;
  }>;
}

export async function getFinancialsReported(
  symbol: string,
  options: { freq?: "annual" | "quarterly"; from?: string; to?: string } = {},
): Promise<FinnhubFinancialsReported | null> {
  const res = await finnhubGet<FinnhubFinancialsReported>("/stock/financials-reported", {
    symbol,
    ...options,
  });
  return res.ok ? res.data : null;
}

export interface FinnhubEarningsSurprise {
  actual: number;
  estimate: number;
  period: string;
  quarter: number;
  symbol: string;
  surprise: number;
  surprisePercent: number;
  year: number;
}

export async function getEarningsSurprises(symbol: string): Promise<FinnhubEarningsSurprise[]> {
  const res = await finnhubGet<FinnhubEarningsSurprise[]>("/stock/earnings", { symbol });
  return res.ok ? res.data ?? [] : [];
}

export interface FinnhubRevenueEstimate {
  period: string;
  revenueAvg: number;
  revenueHigh: number;
  revenueLow: number;
  revenueAnalysts: number;
}

export async function getRevenueEstimates(
  symbol: string,
  freq: "quarterly" | "annual" = "quarterly",
): Promise<FinnhubRevenueEstimate[]> {
  const res = await finnhubGet<{ data?: FinnhubRevenueEstimate[] }>("/stock/revenue-estimate", {
    symbol,
    freq,
  });
  if (!res.ok) return [];
  return res.data.data ?? [];
}

export async function getPeerCompanies(
  symbol: string,
  grouping: "industry" | "sector" | "subIndustry" = "industry",
): Promise<string[]> {
  const res = await finnhubGet<string[]>("/stock/peers", { symbol, grouping });
  return res.ok ? res.data ?? [] : [];
}

export interface FinnhubDividend {
  symbol: string;
  date: string;
  amount: number;
  adjustedAmount: number;
  payDate?: string;
  recordDate?: string;
  declarationDate?: string;
  exDate?: string;
  currency?: string;
}

export async function getDividends(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubDividend[]> {
  const res = await finnhubGet<FinnhubDividend[]>("/stock/dividend2", { symbol, ...options });
  return res.ok ? res.data ?? [] : [];
}

export interface FinnhubSplit {
  symbol: string;
  date: string;
  fromFactor: number;
  toFactor: number;
}

export async function getSplits(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubSplit[]> {
  const res = await finnhubGet<FinnhubSplit[]>("/stock/split", { symbol, ...options });
  return res.ok ? res.data ?? [] : [];
}

// ============================================================================
// Analyst & Sentiment
// ============================================================================

export interface FinnhubPriceTarget {
  symbol: string;
  targetHigh: number;
  targetLow: number;
  targetMean: number;
  targetMedian: number;
  lastUpdated: string;
}

export async function getPriceTarget(symbol: string): Promise<FinnhubPriceTarget | null> {
  const res = await finnhubGet<FinnhubPriceTarget>("/stock/price-target", { symbol });
  return res.ok ? res.data : null;
}

export interface FinnhubUpgradeDowngrade {
  symbol: string;
  gradeTime: number;
  fromGrade: string;
  toGrade: string;
  company: string;
  action: "up" | "down" | "main" | "init";
}

export async function getUpgradeDowngrade(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubUpgradeDowngrade[]> {
  const res = await finnhubGet<FinnhubUpgradeDowngrade[]>("/stock/upgrade-downgrade", {
    symbol,
    ...options,
  });
  return res.ok ? res.data ?? [] : [];
}

export interface FinnhubInsiderSentiment {
  symbol: string;
  year: number;
  month: number;
  change: number;
  mspr: number;
}

export async function getInsiderSentiment(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubInsiderSentiment[]> {
  const res = await finnhubGet<{ data?: FinnhubInsiderSentiment[] }>("/stock/insider-sentiment", {
    symbol,
    ...options,
  });
  if (!res.ok) return [];
  return res.data.data ?? [];
}

export interface FinnhubSocialSentiment {
  symbol: string;
  atTime: string;
  mention: number;
  positiveScore: number;
  negativeScore: number;
  positiveMention: number;
  negativeMention: number;
  score: number;
}

export async function getSocialSentiment(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<{ reddit: FinnhubSocialSentiment[]; twitter: FinnhubSocialSentiment[] }> {
  const res = await finnhubGet<{
    reddit?: FinnhubSocialSentiment[];
    twitter?: FinnhubSocialSentiment[];
  }>("/stock/social-sentiment", { symbol, ...options });
  if (!res.ok) return { reddit: [], twitter: [] };
  return { reddit: res.data.reddit ?? [], twitter: res.data.twitter ?? [] };
}

// ============================================================================
// Ownership
// ============================================================================

export interface FinnhubFundOwnership {
  name: string;
  share: number;
  change: number;
  filingDate: string;
  portfolioPercent: number;
}

export async function getFundOwnership(
  symbol: string,
  limit = 20,
): Promise<FinnhubFundOwnership[]> {
  const res = await finnhubGet<{ ownership?: FinnhubFundOwnership[] }>("/stock/fund-ownership", {
    symbol,
    limit,
  });
  if (!res.ok) return [];
  return res.data.ownership ?? [];
}

export interface FinnhubInstitutionalOwnership {
  cik: string;
  name: string;
  putCallShare: string;
  putCallValue: string;
  share: number;
  value: number;
  percentage: number;
}

export async function getInstitutionalOwnership(
  symbol: string,
  options: { limit?: number; cusip?: string } = {},
): Promise<FinnhubInstitutionalOwnership[]> {
  const res = await finnhubGet<{ data?: Array<{ ownership?: FinnhubInstitutionalOwnership[] }> }>(
    "/institutional/ownership",
    { symbol, ...options },
  );
  if (!res.ok) return [];
  const first = res.data.data?.[0];
  return first?.ownership ?? [];
}

// ============================================================================
// Alternative Data (premium)
// ============================================================================

export interface FinnhubLobbyingRecord {
  symbol: string;
  name: string;
  description: string;
  year: string;
  period: string;
  income: number;
  expenses: number;
  postedDate: string;
  url?: string;
}

export async function getLobbying(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubLobbyingRecord[]> {
  const res = await finnhubGet<{ data?: FinnhubLobbyingRecord[] }>("/stock/lobbying", {
    symbol,
    ...options,
  });
  if (!res.ok) return [];
  return res.data.data ?? [];
}

export interface FinnhubUsaSpendingRecord {
  symbol: string;
  awardingAgencyName: string;
  totalValue: number;
  actionDate: string;
  actionDateYear: string;
  description: string;
  naicsCode: string;
}

export async function getUsaSpending(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubUsaSpendingRecord[]> {
  const res = await finnhubGet<{ data?: FinnhubUsaSpendingRecord[] }>("/stock/usa-spending", {
    symbol,
    ...options,
  });
  if (!res.ok) return [];
  return res.data.data ?? [];
}

export interface FinnhubPatent {
  applicationNumber: string;
  categoryTitle: string;
  companyFilingName: string;
  description: string;
  filingDate: string;
  filingStatus: string;
  patentNumber: string;
  patentType: string;
  symbol: string;
  url: string;
}

export async function getUsptoPatents(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubPatent[]> {
  const res = await finnhubGet<{ data?: FinnhubPatent[] }>("/stock/uspto-patent", {
    symbol,
    ...options,
  });
  if (!res.ok) return [];
  return res.data.data ?? [];
}

export interface FinnhubVisaApplication {
  symbol: string;
  caseNumber: string;
  caseStatus: string;
  receivedDate: string;
  decisionDate: string;
  visaClass: string;
  jobTitle: string;
  socCode: string;
  fullTimePosition: string;
  beginDate: string;
  endDate: string;
  employerName: string;
  wageRangeFrom: number;
  wageRangeTo: number;
  wageUnitOfPay: string;
  worksiteAddress: string;
  worksiteCity: string;
  worksiteCounty: string;
  worksiteState: string;
  worksitePostalCode: string;
}

export async function getVisaApplications(
  symbol: string,
  options: { from?: string; to?: string } = {},
): Promise<FinnhubVisaApplication[]> {
  const res = await finnhubGet<{ data?: FinnhubVisaApplication[] }>("/stock/visa-application", {
    symbol,
    ...options,
  });
  if (!res.ok) return [];
  return res.data.data ?? [];
}

export interface FinnhubSupplyChainRelationship {
  symbol: string;
  name: string;
  oneMonthCorrelation: number;
  oneYearCorrelation: number;
  sixMonthCorrelation: number;
  threeMonthCorrelation: number;
  twoWeekCorrelation: number;
}

export async function getSupplyChain(
  symbol: string,
): Promise<{ suppliers: FinnhubSupplyChainRelationship[]; customers: FinnhubSupplyChainRelationship[] }> {
  const res = await finnhubGet<{
    data?: Array<FinnhubSupplyChainRelationship & { type: "supplier" | "customer" }>;
  }>("/stock/supply-chain", { symbol });
  if (!res.ok) return { suppliers: [], customers: [] };
  const all = res.data.data ?? [];
  return {
    suppliers: all.filter((r) => r.type === "supplier"),
    customers: all.filter((r) => r.type === "customer"),
  };
}

export interface FinnhubEsgScore {
  symbol: string;
  totalESGScore: number;
  environmentScore: number;
  governanceScore: number;
  socialScore: number;
  ESGRiskRating?: string;
}

export async function getEsgScore(symbol: string): Promise<FinnhubEsgScore | null> {
  const res = await finnhubGet<FinnhubEsgScore>("/stock/esg", { symbol });
  return res.ok ? res.data : null;
}

export interface FinnhubTranscriptMeta {
  id: string;
  title: string;
  time: string;
  year: number;
  quarter: number;
}

export async function listTranscripts(symbol: string): Promise<FinnhubTranscriptMeta[]> {
  const res = await finnhubGet<{ transcripts?: FinnhubTranscriptMeta[] }>("/stock/transcripts/list", {
    symbol,
  });
  if (!res.ok) return [];
  return res.data.transcripts ?? [];
}

export interface FinnhubTranscript {
  id: string;
  symbol: string;
  title: string;
  time: string;
  audio?: string;
  participant?: Array<{ name: string; description: string }>;
  transcript?: Array<{ name: string; speech: string[]; session: string }>;
}

export async function getTranscript(id: string): Promise<FinnhubTranscript | null> {
  const res = await finnhubGet<FinnhubTranscript>("/stock/transcripts", { id });
  return res.ok ? res.data : null;
}

// ============================================================================
// IPO Calendar
// ============================================================================

export interface FinnhubIpoEntry {
  date: string;
  exchange: string;
  name: string;
  numberOfShares: number;
  price: string;
  status: string;
  symbol: string;
  totalSharesValue: number;
}

export async function getIpoCalendar(options: { from: string; to: string }): Promise<FinnhubIpoEntry[]> {
  const res = await finnhubGet<{ ipoCalendar?: FinnhubIpoEntry[] }>("/calendar/ipo", options);
  if (!res.ok) return [];
  return res.data.ipoCalendar ?? [];
}

// ============================================================================
// Stock Market Data
// ============================================================================

export interface FinnhubQuote {
  c: number; // current price
  d: number; // change
  dp: number; // percent change
  h: number; // high of day
  l: number; // low of day
  o: number; // open price
  pc: number; // previous close
  t: number; // timestamp
}

export async function getStockQuote(symbol: string): Promise<FinnhubQuote | null> {
  const res = await finnhubGet<FinnhubQuote>("/quote", { symbol });
  return res.ok ? res.data : null;
}

export type FinnhubResolution = "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M";

export interface FinnhubCandles {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  v: number[];
  t: number[];
  s: "ok" | "no_data";
}

export async function getStockCandles(
  symbol: string,
  resolution: FinnhubResolution,
  from: number,
  to: number,
): Promise<FinnhubCandles | null> {
  const res = await finnhubGet<FinnhubCandles>("/stock/candle", { symbol, resolution, from, to });
  return res.ok ? res.data : null;
}

export interface FinnhubSymbolEntry {
  currency: string;
  description: string;
  displaySymbol: string;
  figi?: string;
  mic?: string;
  symbol: string;
  type: string;
}

export async function getStockSymbols(exchange: string): Promise<FinnhubSymbolEntry[]> {
  const res = await finnhubGet<FinnhubSymbolEntry[]>("/stock/symbol", { exchange });
  return res.ok ? res.data ?? [] : [];
}

export interface FinnhubSymbolLookupResult {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
}

export async function symbolLookup(q: string): Promise<FinnhubSymbolLookupResult[]> {
  const res = await finnhubGet<{ count: number; result?: FinnhubSymbolLookupResult[] }>("/search", { q });
  if (!res.ok) return [];
  return res.data.result ?? [];
}

export interface FinnhubMarketStatus {
  exchange: string;
  holiday: string | null;
  isOpen: boolean;
  session: string;
  timezone: string;
  t: number;
}

export async function getMarketStatus(exchange: string = "US"): Promise<FinnhubMarketStatus | null> {
  const res = await finnhubGet<FinnhubMarketStatus>("/stock/market-status", { exchange });
  return res.ok ? res.data : null;
}

// ============================================================================
// News
// ============================================================================

export interface FinnhubNewsArticle {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image?: string;
  related?: string;
  source: string;
  summary: string;
  url: string;
}

export async function getCompanyNews(
  symbol: string,
  options: { from: string; to: string },
): Promise<FinnhubNewsArticle[]> {
  const res = await finnhubGet<FinnhubNewsArticle[]>("/company-news", { symbol, ...options });
  return res.ok ? res.data ?? [] : [];
}

export async function getMarketNews(
  category: "general" | "forex" | "crypto" | "merger" = "general",
  minId?: number,
): Promise<FinnhubNewsArticle[]> {
  const res = await finnhubGet<FinnhubNewsArticle[]>("/news", { category, minId });
  return res.ok ? res.data ?? [] : [];
}

// ============================================================================
// Scanner
// ============================================================================

export interface FinnhubPatternResult {
  aprice: number;
  asymbol?: string;
  atime: number;
  bprice: number;
  bsymbol?: string;
  btime: number;
  cprice?: number;
  ctime?: number;
  dprice?: number;
  dtime?: number;
  entry?: number;
  maxpossibleprofit?: string;
  patternname: string;
  patterntype: string;
  profit1?: number;
  profit2?: number;
  sortTime: number;
  status: string;
  stoploss?: number;
  symbol: string;
  terminal?: number;
}

export async function getPatternRecognition(
  symbol: string,
  resolution: FinnhubResolution = "D",
): Promise<FinnhubPatternResult[]> {
  const res = await finnhubGet<{ points?: FinnhubPatternResult[] }>("/scan/pattern", {
    symbol,
    resolution,
  });
  if (!res.ok) return [];
  return res.data.points ?? [];
}

export interface FinnhubSupportResistance {
  levels: number[];
}

export async function getSupportResistance(
  symbol: string,
  resolution: FinnhubResolution = "D",
): Promise<FinnhubSupportResistance | null> {
  const res = await finnhubGet<FinnhubSupportResistance>("/scan/support-resistance", {
    symbol,
    resolution,
  });
  return res.ok ? res.data : null;
}

export interface FinnhubAggregateSignal {
  technicalAnalysis: {
    count: { buy: number; neutral: number; sell: number };
    signal: "buy" | "sell" | "neutral" | "strong_buy" | "strong_sell";
  };
  trend: {
    adx: number;
    trending: boolean;
  };
}

export async function getAggregateSignal(
  symbol: string,
  resolution: FinnhubResolution = "D",
): Promise<FinnhubAggregateSignal | null> {
  const res = await finnhubGet<FinnhubAggregateSignal>("/scan/technical-indicator", {
    symbol,
    resolution,
  });
  return res.ok ? res.data : null;
}

// ============================================================================
// ETF / Mutual Fund / Index / Bond
// ============================================================================

export interface FinnhubEtfProfile {
  symbol: string;
  name: string;
  description?: string;
  isin?: string;
  cusip?: string;
  assetClass: string;
  investmentSegment?: string;
  exchange: string;
  totalAssets?: number;
  expenseRatio?: number;
  inceptionDate?: string;
  issuer?: string;
  website?: string;
  holdingsCount?: number;
  nav?: number;
  navCurrency?: string;
  leveraged?: boolean;
}

export async function getEtfProfile(symbol: string): Promise<FinnhubEtfProfile | null> {
  const res = await finnhubGet<{ profile?: FinnhubEtfProfile }>("/etf/profile", { symbol });
  if (!res.ok) return null;
  return res.data.profile ?? null;
}

export interface FinnhubEtfExposureEntry {
  name?: string;
  exposure: number;
}

export async function getEtfCountryExposure(symbol: string): Promise<FinnhubEtfExposureEntry[]> {
  const res = await finnhubGet<{ countryExposure?: FinnhubEtfExposureEntry[] }>("/etf/country", { symbol });
  if (!res.ok) return [];
  return res.data.countryExposure ?? [];
}

export async function getEtfSectorExposure(symbol: string): Promise<FinnhubEtfExposureEntry[]> {
  const res = await finnhubGet<{ sectorExposure?: FinnhubEtfExposureEntry[] }>("/etf/sector", { symbol });
  if (!res.ok) return [];
  return res.data.sectorExposure ?? [];
}

export interface FinnhubMutualFundProfile {
  symbol: string;
  name: string;
  category?: string;
  investmentStrategy?: string;
  inceptionDate?: string;
  totalNav?: number;
  expenseRatio?: number;
  beta?: number;
  fiveYearAverageReturn?: number;
  threeYearAverageReturn?: number;
  minimumInvestment?: number;
  fundFamily?: string;
  currency?: string;
}

export async function getMutualFundProfile(symbol: string): Promise<FinnhubMutualFundProfile | null> {
  const res = await finnhubGet<{ profile?: FinnhubMutualFundProfile }>("/mutual-fund/profile", { symbol });
  if (!res.ok) return null;
  return res.data.profile ?? null;
}

export interface FinnhubMutualFundHolding {
  symbol: string;
  name: string;
  cusip?: string;
  isin?: string;
  share: number;
  percent: number;
  value: number;
}

export async function getMutualFundHoldings(symbol: string): Promise<FinnhubMutualFundHolding[]> {
  const res = await finnhubGet<{ holdings?: FinnhubMutualFundHolding[] }>("/mutual-fund/holdings", { symbol });
  if (!res.ok) return [];
  return res.data.holdings ?? [];
}

export async function getMutualFundCountryExposure(symbol: string): Promise<FinnhubEtfExposureEntry[]> {
  const res = await finnhubGet<{ countryExposure?: FinnhubEtfExposureEntry[] }>(
    "/mutual-fund/country",
    { symbol },
  );
  if (!res.ok) return [];
  return res.data.countryExposure ?? [];
}

export async function getMutualFundSectorExposure(symbol: string): Promise<FinnhubEtfExposureEntry[]> {
  const res = await finnhubGet<{ sectorExposure?: FinnhubEtfExposureEntry[] }>(
    "/mutual-fund/sector",
    { symbol },
  );
  if (!res.ok) return [];
  return res.data.sectorExposure ?? [];
}

export interface FinnhubIndexConstituent {
  symbol: string;
  name: string;
}

export async function getIndexConstituents(symbol: string): Promise<string[]> {
  const res = await finnhubGet<{ constituents?: string[] }>("/index/constituents", { symbol });
  if (!res.ok) return [];
  return res.data.constituents ?? [];
}

export interface FinnhubYieldCurvePoint {
  d: string;
  v: number;
}

export async function getBondYieldCurve(code: string = "10y"): Promise<FinnhubYieldCurvePoint[]> {
  const res = await finnhubGet<{ data?: FinnhubYieldCurvePoint[] }>("/bond/yield-curve", { code });
  if (!res.ok) return [];
  return res.data.data ?? [];
}

export interface FinnhubBondProfile {
  isin: string;
  cusip: string;
  figi?: string;
  coupon?: number;
  maturityDate?: string;
  issueDate?: string;
  callable?: boolean;
  bondType?: string;
  debtType?: string;
  industryGroup?: string;
  securityType?: string;
  originalAmountOutstanding?: number;
  issuer?: string;
  couponFrequency?: number;
}

export async function getBondProfile(isin: string): Promise<FinnhubBondProfile | null> {
  const res = await finnhubGet<FinnhubBondProfile>("/bond/profile", { isin });
  return res.ok ? res.data : null;
}

// ============================================================================
// Crypto
// ============================================================================

export async function getCryptoExchanges(): Promise<string[]> {
  const res = await finnhubGet<string[]>("/crypto/exchange", {});
  return res.ok ? res.data ?? [] : [];
}

export interface FinnhubCryptoSymbol {
  description: string;
  displaySymbol: string;
  symbol: string;
}

export async function getCryptoSymbols(exchange: string): Promise<FinnhubCryptoSymbol[]> {
  const res = await finnhubGet<FinnhubCryptoSymbol[]>("/crypto/symbol", { exchange });
  return res.ok ? res.data ?? [] : [];
}

export async function getCryptoCandles(
  symbol: string,
  resolution: FinnhubResolution,
  from: number,
  to: number,
): Promise<FinnhubCandles | null> {
  const res = await finnhubGet<FinnhubCandles>("/crypto/candle", { symbol, resolution, from, to });
  return res.ok ? res.data : null;
}

export interface FinnhubCryptoProfile {
  name: string;
  description: string;
  longName?: string;
  logo?: string;
  marketCap?: number;
  totalSupply?: number;
  circulatingSupply?: number;
  maxSupply?: number;
  website?: string;
  whitepaper?: string;
  proofType?: string;
  gitRepoUrl?: string;
  launchDate?: string;
}

export async function getCryptoProfile(symbol: string): Promise<FinnhubCryptoProfile | null> {
  const res = await finnhubGet<FinnhubCryptoProfile>("/crypto/profile", { symbol });
  return res.ok ? res.data : null;
}

// ============================================================================
// Forex
// ============================================================================

export async function getForexExchanges(): Promise<string[]> {
  const res = await finnhubGet<string[]>("/forex/exchange", {});
  return res.ok ? res.data ?? [] : [];
}

export async function getForexSymbols(exchange: string): Promise<FinnhubCryptoSymbol[]> {
  const res = await finnhubGet<FinnhubCryptoSymbol[]>("/forex/symbol", { exchange });
  return res.ok ? res.data ?? [] : [];
}

export async function getForexCandles(
  symbol: string,
  resolution: FinnhubResolution,
  from: number,
  to: number,
): Promise<FinnhubCandles | null> {
  const res = await finnhubGet<FinnhubCandles>("/forex/candle", { symbol, resolution, from, to });
  return res.ok ? res.data : null;
}

export interface FinnhubForexRates {
  base: string;
  quote: Record<string, number>;
}

export async function getForexRates(base: string = "USD"): Promise<FinnhubForexRates | null> {
  const res = await finnhubGet<FinnhubForexRates>("/forex/rates", { base });
  return res.ok ? res.data : null;
}

// ============================================================================
// Economic
// ============================================================================

export interface FinnhubEconomicCode {
  code: string;
  country: string;
  name: string;
  unit: string;
}

export async function listEconomicCodes(): Promise<FinnhubEconomicCode[]> {
  const res = await finnhubGet<FinnhubEconomicCode[]>("/economic-code", {});
  return res.ok ? res.data ?? [] : [];
}

export interface FinnhubEconomicSeries {
  code: string;
  data?: Array<{ d: string; v: number }>;
}

export async function getEconomicData(code: string): Promise<FinnhubEconomicSeries | null> {
  const res = await finnhubGet<FinnhubEconomicSeries>("/economic", { code });
  return res.ok ? res.data : null;
}

// ============================================================================
// Singleton accessor for tool callers
// ============================================================================

/** Exposed shape — all endpoint wrappers grouped under one namespace. */
export const finnhub = {
  isConfigured: isFinnhubConfigured,
  // original 9
  getEarningsCalendar,
  getEarningsEstimates,
  getEconomicCalendar,
  getInsiderTransactions,
  getCongressionalTrading,
  getRecommendationTrends,
  getSecFilings,
  getNewsSentiment,
  getEtfHoldings,
  // fundamentals
  getCompanyProfile,
  getBasicFinancials,
  getFinancialsReported,
  getEarningsSurprises,
  getRevenueEstimates,
  getPeerCompanies,
  getDividends,
  getSplits,
  // analyst & sentiment
  getPriceTarget,
  getUpgradeDowngrade,
  getInsiderSentiment,
  getSocialSentiment,
  // ownership
  getFundOwnership,
  getInstitutionalOwnership,
  // alt data
  getLobbying,
  getUsaSpending,
  getUsptoPatents,
  getVisaApplications,
  getSupplyChain,
  getEsgScore,
  listTranscripts,
  getTranscript,
  // IPO
  getIpoCalendar,
  // market data
  getStockQuote,
  getStockCandles,
  getStockSymbols,
  symbolLookup,
  getMarketStatus,
  // news
  getCompanyNews,
  getMarketNews,
  // scanner
  getPatternRecognition,
  getSupportResistance,
  getAggregateSignal,
  // ETF / fund / index / bond
  getEtfProfile,
  getEtfCountryExposure,
  getEtfSectorExposure,
  getMutualFundProfile,
  getMutualFundHoldings,
  getMutualFundCountryExposure,
  getMutualFundSectorExposure,
  getIndexConstituents,
  getBondYieldCurve,
  getBondProfile,
  // crypto
  getCryptoExchanges,
  getCryptoSymbols,
  getCryptoCandles,
  getCryptoProfile,
  // forex
  getForexExchanges,
  getForexSymbols,
  getForexCandles,
  getForexRates,
  // economic
  listEconomicCodes,
  getEconomicData,
};

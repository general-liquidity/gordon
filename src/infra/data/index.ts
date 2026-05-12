// ============================================================================
// Data — Market data sources and enrichment
//
// Registry of all data sources with unified health monitoring.
// Sources: CoinGecko, Google News, SEC EDGAR, LLM enrichment, multi-source quotes.
// ============================================================================

export { CoinGeckoClient, getCoinGeckoClient } from "./providers/coingecko.ts";
export { NewsClient, getNewsClient } from "./providers/news.ts";
export { SECFilingsClient, getSECFilingsClient } from "./providers/sec-filings.ts";
export { SECInsiderClient, getSECInsiderClient } from "./providers/sec-insider.ts";
export type { InsiderTransaction, InsiderSummary, InsiderTransactionType } from "./providers/sec-insider.ts";
export { SECSegmentsClient, getSECSegmentsClient } from "./providers/sec-segments.ts";
export type { SegmentBreakdown, SegmentEntry } from "./providers/sec-segments.ts";
export {
  screenStocks,
  PRESETS,
  PRESET_QUALITY_GROWTH,
  PRESET_DIVIDEND,
  PRESET_DEEP_VALUE,
  PRESET_MOMENTUM,
  SP500_TOP,
  NASDAQ_100_SAMPLE,
} from "./providers/stockScreener.ts";
export type { ScreenCriteria, ScreenResult, ScreenOptions } from "./providers/stockScreener.ts";
export { XSearchClient, getXSearchClient } from "./providers/xSearch.ts";
export type { XTweet, XSearchOptions, XSearchSummary } from "./providers/xSearch.ts";
export { FundamentalsClient, getFundamentalsClient } from "./providers/fundamentals.ts";
export { AlphaVantageClient, getAlphaVantageClient } from "./providers/alphaVantage.ts";
export { enrichQuoteWithLLM } from "./enrichment/llmEnrichment.ts";
export { MultiSourceQuoteService } from "./providers/multiSourceQuote.ts";

// Data source registry for discovery and health monitoring
export interface DataSourceInfo {
  id: string;
  name: string;
  type: "price" | "news" | "filings" | "yield" | "enrichment" | "insider" | "segments" | "screener" | "social";
  requiresApiKey: boolean;
  rateLimit: string;
  endpoint: string;
}

export const DATA_SOURCE_REGISTRY: DataSourceInfo[] = [
  { id: "coingecko", name: "CoinGecko", type: "price", requiresApiKey: false, rateLimit: "10-30/min", endpoint: "api.coingecko.com" },
  { id: "google-news", name: "Google News", type: "news", requiresApiKey: false, rateLimit: "unlimited", endpoint: "news.google.com/rss" },
  { id: "sec-edgar", name: "SEC EDGAR", type: "filings", requiresApiKey: false, rateLimit: "10/sec", endpoint: "efts.sec.gov" },
  { id: "yahoo-fundamentals", name: "Yahoo Finance Fundamentals", type: "price", requiresApiKey: false, rateLimit: "60/min", endpoint: "query2.finance.yahoo.com" },
  { id: "defillama", name: "DeFiLlama", type: "yield", requiresApiKey: false, rateLimit: "unlimited", endpoint: "yields.llama.fi" },
  { id: "llm-enrichment", name: "LLM Enrichment", type: "enrichment", requiresApiKey: true, rateLimit: "per-provider", endpoint: "via LLM client" },
  { id: "alpha-vantage", name: "Alpha Vantage", type: "price", requiresApiKey: true, rateLimit: "25/day (free) or 75/min (paid)", endpoint: "www.alphavantage.co" },
  { id: "sec-insider", name: "SEC Form 4 Insider Trades", type: "insider", requiresApiKey: false, rateLimit: "10/sec", endpoint: "data.sec.gov" },
  { id: "sec-segments", name: "SEC XBRL Revenue Segments", type: "segments", requiresApiKey: false, rateLimit: "10/sec", endpoint: "data.sec.gov" },
  { id: "stock-screener", name: "Fundamental Stock Screener", type: "screener", requiresApiKey: false, rateLimit: "via Yahoo Finance", endpoint: "query2.finance.yahoo.com" },
  { id: "x-search", name: "X (Twitter) Search", type: "social", requiresApiKey: true, rateLimit: "per X API tier", endpoint: "api.twitter.com" },
];

export function getDataSource(id: string): DataSourceInfo | undefined {
  return DATA_SOURCE_REGISTRY.find((d) => d.id === id);
}

export function getDataSourcesByType(type: DataSourceInfo["type"]): DataSourceInfo[] {
  return DATA_SOURCE_REGISTRY.filter((d) => d.type === type);
}

export function getFreeDataSources(): DataSourceInfo[] {
  return DATA_SOURCE_REGISTRY.filter((d) => !d.requiresApiKey);
}

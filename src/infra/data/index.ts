// ============================================================================
// Data — Market data sources and enrichment
//
// Registry of all data sources with unified health monitoring.
// Sources: CoinGecko, Google News, SEC EDGAR, LLM enrichment, multi-source quotes.
// ============================================================================

export { CoinGeckoClient, getCoinGeckoClient } from "./coingecko.ts";
export { NewsClient, getNewsClient } from "./news.ts";
export { SECFilingsClient, getSECFilingsClient } from "./sec-filings.ts";
export { FundamentalsClient, getFundamentalsClient } from "./fundamentals.ts";
export { AlphaVantageClient, getAlphaVantageClient } from "./alphaVantage.ts";
export { enrichQuoteWithLLM } from "./llmEnrichment.ts";
export { MultiSourceQuoteService } from "./multiSourceQuote.ts";

// Data source registry for discovery and health monitoring
export interface DataSourceInfo {
  id: string;
  name: string;
  type: "price" | "news" | "filings" | "yield" | "enrichment";
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

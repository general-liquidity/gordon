/**
 * News Aggregation Client
 *
 * Retrieves financial news via Google News RSS feed.
 * Free, no API key required. Parses RSS XML with simple regex.
 */

import { Cache } from "../cache/cache.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("news");

const GNEWS_RSS_BASE = "https://news.google.com/rss/search";

const newsCache = new Cache<NewsItem[]>({ defaultTtl: 3 * 60 * 1000 });

// ============================================================================
// Types
// ============================================================================

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  snippet: string;
}

// ============================================================================
// Ticker -> company name mapping for better search results
// ============================================================================

const TICKER_NAMES: Record<string, string> = {
  AAPL: "Apple",
  MSFT: "Microsoft",
  GOOGL: "Google Alphabet",
  AMZN: "Amazon",
  META: "Meta Facebook",
  TSLA: "Tesla",
  NVDA: "NVIDIA",
  JPM: "JPMorgan Chase",
  V: "Visa",
  JNJ: "Johnson Johnson",
  WMT: "Walmart",
  PG: "Procter Gamble",
  MA: "Mastercard",
  UNH: "UnitedHealth",
  HD: "Home Depot",
  DIS: "Disney",
  BAC: "Bank of America",
  NFLX: "Netflix",
  ADBE: "Adobe",
  CRM: "Salesforce",
  AMD: "AMD",
  INTC: "Intel",
  PYPL: "PayPal",
  COIN: "Coinbase",
  SQ: "Block Square",
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
};

// ============================================================================
// RSS Parsing
// ============================================================================

function stripHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "");
}

function parseRssItems(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]!;

    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);

    const rawTitle = titleMatch?.[1] ?? "";
    const title = stripHtmlEntities(rawTitle.trim());

    // Google News appends " - Source Name" to titles; extract source from that if <source> is missing
    let source = sourceMatch ? stripHtmlEntities(sourceMatch[1]!.trim()) : "";
    if (!source) {
      const dashIdx = title.lastIndexOf(" - ");
      if (dashIdx > 0) {
        source = title.slice(dashIdx + 3).trim();
      }
    }

    const url = linkMatch?.[1]?.trim() ?? "";
    const publishedAt = pubDateMatch?.[1]?.trim() ?? "";
    const snippet = descMatch
      ? stripHtmlEntities(descMatch[1]!.trim()).slice(0, 200)
      : "";

    if (title) {
      items.push({ title, source, url, publishedAt, snippet });
    }
  }

  return items;
}

// ============================================================================
// NewsClient
// ============================================================================

export class NewsClient {
  /**
   * Search news by free-text query.
   *
   * @param query - Search query string
   * @param limit - Max results to return (default 10)
   */
  async getNews(query: string, limit = 10): Promise<NewsItem[]> {
    const cacheKey = `q:${query}:${limit}`;
    const cached = newsCache.get(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      q: query,
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    });

    const url = `${GNEWS_RSS_BASE}?${params.toString()}`;
    logger.debug("Fetching news RSS", { query, url });

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Gordon-CLI/0.8",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        throw new Error(`Google News RSS error: ${res.status} ${res.statusText}`);
      }

      const xml = await res.text();
      const items = parseRssItems(xml).slice(0, limit);
      newsCache.set(cacheKey, items);

      logger.info("News fetch complete", {
        query,
        results: String(items.length),
      });

      return items;
    } catch (error) {
      logger.warn("News fetch failed", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get news for a stock/crypto symbol.
   * Automatically expands ticker to company name for better results.
   *
   * @param symbol - Ticker symbol (e.g., "AAPL", "BTC")
   * @param limit - Max results (default 10)
   */
  async getNewsForSymbol(symbol: string, limit = 10): Promise<NewsItem[]> {
    const upper = symbol.toUpperCase().replace(/USDT?$/, "");
    const companyName = TICKER_NAMES[upper];

    // Search with both ticker and company name for better coverage
    const query = companyName
      ? `${upper} ${companyName} stock`
      : `${upper} stock market`;

    return this.getNews(query, limit);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let defaultClient: NewsClient | null = null;

export function getNewsClient(): NewsClient {
  if (!defaultClient) {
    defaultClient = new NewsClient();
  }
  return defaultClient;
}

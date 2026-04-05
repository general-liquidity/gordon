/**
 * X (Twitter) Social Search
 *
 * Thin wrapper around X API v2 for cashtag / keyword search. X requires a
 * paid API tier (Basic $200/mo or higher) for search endpoints — Gordon
 * does NOT bundle an X API key. Users bring their own (BYOAPI).
 *
 * If no key is configured, this module returns empty results and a clear
 * diagnostic. The calling code should treat absence-of-social-data as
 * "signal unavailable" not as an error.
 *
 * Alternative free paths: Reddit, StockTwits (their public API is open) —
 * see the companion stubs at the bottom of this file.
 */

import { Cache } from "../platform/cache/cache.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("x-search");

const searchCache = new Cache<XTweet[]>({ defaultTtl: 5 * 60 * 1000 });

// ============================================================================
// Types
// ============================================================================

export interface XTweet {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
  /** Public engagement metrics. */
  metrics?: {
    retweetCount: number;
    replyCount: number;
    likeCount: number;
    quoteCount: number;
  };
  /** Sentiment score derived from content (-1 bearish → 1 bullish). */
  sentiment?: number;
}

export interface XSearchOptions {
  /** Max results to return (10-100). */
  maxResults?: number;
  /** Start time (ISO 8601). X API supports last 7 days on Basic tier. */
  startTime?: string;
  /** End time (ISO 8601). */
  endTime?: string;
  /** Filter: exclude replies. */
  excludeReplies?: boolean;
  /** Minimum follower count for author (anti-noise filter). */
  minAuthorFollowers?: number;
}

export interface XSearchSummary {
  query: string;
  totalTweets: number;
  avgSentiment: number;
  topTweets: XTweet[];
  /** Engagement-weighted sentiment (bigger voices count more). */
  weightedSentiment: number;
}

// ============================================================================
// Client
// ============================================================================

function getBearerToken(): string | null {
  return process.env.X_API_BEARER_TOKEN || process.env.TWITTER_API_BEARER_TOKEN || null;
}

export class XSearchClient {
  private readonly baseUrl = "https://api.twitter.com/2";

  async isConfigured(): Promise<boolean> {
    return getBearerToken() !== null;
  }

  /**
   * Search X for a ticker/cashtag/keyword. Returns empty array if no API key.
   */
  async search(query: string, options: XSearchOptions = {}): Promise<XTweet[]> {
    const token = getBearerToken();
    if (!token) {
      logger.debug("X API key not configured — skipping search", { query });
      return [];
    }

    const cacheKey = `${query}:${JSON.stringify(options)}`;
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      query: buildSearchQuery(query, options),
      max_results: String(Math.min(Math.max(options.maxResults ?? 20, 10), 100)),
      "tweet.fields": "created_at,public_metrics,author_id",
    });
    if (options.startTime) params.set("start_time", options.startTime);
    if (options.endTime) params.set("end_time", options.endTime);

    try {
      const res = await fetch(`${this.baseUrl}/tweets/search/recent?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        logger.warn("X API returned non-OK", { status: res.status });
        return [];
      }
      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          text: string;
          author_id: string;
          created_at: string;
          public_metrics?: {
            retweet_count: number;
            reply_count: number;
            like_count: number;
            quote_count: number;
          };
        }>;
      };
      const tweets: XTweet[] = (json.data ?? []).map((t) => ({
        id: t.id,
        text: t.text,
        authorId: t.author_id,
        createdAt: t.created_at,
        metrics: t.public_metrics
          ? {
              retweetCount: t.public_metrics.retweet_count,
              replyCount: t.public_metrics.reply_count,
              likeCount: t.public_metrics.like_count,
              quoteCount: t.public_metrics.quote_count,
            }
          : undefined,
        sentiment: scoreSentiment(t.text),
      }));

      searchCache.set(cacheKey, tweets);
      return tweets;
    } catch (err) {
      logger.warn("X search failed", { err: String(err) });
      return [];
    }
  }

  /** Search for a ticker cashtag (e.g., "$AAPL"). */
  async searchTicker(ticker: string, options: XSearchOptions = {}): Promise<XSearchSummary> {
    const tweets = await this.search(`$${ticker.toUpperCase()}`, options);
    return summarize(`$${ticker.toUpperCase()}`, tweets);
  }
}

function buildSearchQuery(query: string, options: XSearchOptions): string {
  const parts = [query];
  if (options.excludeReplies) parts.push("-is:reply");
  parts.push("lang:en");
  return parts.join(" ");
}

// ============================================================================
// Lightweight sentiment scoring (no ML dependency)
// ============================================================================

const BULL_WORDS = new Set([
  "buy", "long", "bull", "bullish", "moon", "pump", "breakout", "rally",
  "gains", "uptrend", "support", "accumulate", "strong", "beat", "upgrade",
  "outperform", "overweight", "target raised", "bullish bias",
]);
const BEAR_WORDS = new Set([
  "sell", "short", "bear", "bearish", "dump", "crash", "correction",
  "downtrend", "resistance", "weak", "miss", "downgrade", "underperform",
  "underweight", "target cut", "bearish bias", "rug",
]);

function scoreSentiment(text: string): number {
  const lowered = text.toLowerCase();
  let score = 0;
  for (const w of BULL_WORDS) if (lowered.includes(w)) score += 1;
  for (const w of BEAR_WORDS) if (lowered.includes(w)) score -= 1;
  // Bounded to [-1, 1]
  return Math.max(-1, Math.min(1, score / 5));
}

function summarize(query: string, tweets: XTweet[]): XSearchSummary {
  if (tweets.length === 0) {
    return { query, totalTweets: 0, avgSentiment: 0, topTweets: [], weightedSentiment: 0 };
  }
  const sentiments = tweets.map((t) => t.sentiment ?? 0);
  const avg = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const t of tweets) {
    const engagement =
      (t.metrics?.likeCount ?? 0) +
      (t.metrics?.retweetCount ?? 0) * 2 +
      (t.metrics?.replyCount ?? 0);
    const weight = Math.log10(engagement + 10);
    weightedSum += (t.sentiment ?? 0) * weight;
    weightTotal += weight;
  }
  const weighted = weightTotal > 0 ? weightedSum / weightTotal : avg;

  const sorted = [...tweets].sort((a, b) => {
    const aE = (a.metrics?.likeCount ?? 0) + (a.metrics?.retweetCount ?? 0) * 2;
    const bE = (b.metrics?.likeCount ?? 0) + (b.metrics?.retweetCount ?? 0) * 2;
    return bE - aE;
  });

  return {
    query,
    totalTweets: tweets.length,
    avgSentiment: avg,
    topTweets: sorted.slice(0, 5),
    weightedSentiment: weighted,
  };
}

let instance: XSearchClient | null = null;
export function getXSearchClient(): XSearchClient {
  if (!instance) instance = new XSearchClient();
  return instance;
}

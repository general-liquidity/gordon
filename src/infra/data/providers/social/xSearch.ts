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

import { Cache } from "../../../platform/cache/cache.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import {
  buildContextFilter,
  getAnnotationByEntityId,
  type XContextAnnotation,
} from "./xContextAnnotations.ts";
import { parseTextEntities, type TextEntities } from "../../enrichment/textEntities.ts";

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
  /**
   * X-assigned context annotations for this tweet — domain/entity pairs X
   * uses to classify what the tweet is about (Bitcoin, $TSLA, etc.).
   * Only populated when the search requests `context_annotations` fields.
   */
  contextAnnotations?: XContextAnnotation[];
  /**
   * Entities extracted from the tweet body using twitter-text: cashtags,
   * hashtags, mentions, urls. Gives Gordon a tier-agnostic way to see
   * co-mentioned tickers even when X context annotations aren't available.
   */
  entities?: TextEntities;
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
  /**
   * Restrict the search to tweets X has classified with one of these
   * context annotations. When multiple are provided, they are combined with
   * OR. Higher-precision than raw keyword/cashtag search.
   */
  contextAnnotations?: readonly XContextAnnotation[];
  /**
   * Request `context_annotations` in the tweet fields so the returned
   * XTweet objects include their X-assigned entities. Automatically
   * enabled when `contextAnnotations` is set.
   */
  includeContextFields?: boolean;
}

export interface XSearchSummary {
  query: string;
  totalTweets: number;
  avgSentiment: number;
  topTweets: XTweet[];
  /** Engagement-weighted sentiment (bigger voices count more). */
  weightedSentiment: number;
}

export interface XUser {
  id: string;
  username: string;
  name: string;
  verified: boolean;
  description: string;
  followerCount: number;
  followingCount: number;
  tweetCount: number;
}

export interface XTimelineOptions {
  /** Max tweets to return (5-100). */
  maxResults?: number;
  /** Start time (ISO 8601). */
  startTime?: string;
  /** Filter: exclude replies. */
  excludeReplies?: boolean;
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

    const wantsContextFields = Boolean(
      options.includeContextFields ||
        (options.contextAnnotations && options.contextAnnotations.length > 0),
    );
    const tweetFields = wantsContextFields
      ? "created_at,public_metrics,author_id,context_annotations"
      : "created_at,public_metrics,author_id";

    const params = new URLSearchParams({
      query: buildSearchQuery(query, options),
      max_results: String(Math.min(Math.max(options.maxResults ?? 20, 10), 100)),
      "tweet.fields": tweetFields,
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
          context_annotations?: Array<{
            domain: { id: string; name: string; description?: string };
            entity: { id: string; name: string; description?: string };
          }>;
        }>;
      };
      const tweets: XTweet[] = (json.data ?? []).map((t) => {
        const annotations = t.context_annotations
          ? mapContextAnnotations(t.context_annotations)
          : undefined;
        return {
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
          contextAnnotations: annotations,
          entities: parseTextEntities(t.text),
        };
      });

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

  /**
   * Resolve an X handle to a user record. Returns null if not configured or
   * the user does not exist.
   */
  async getUserByUsername(username: string): Promise<XUser | null> {
    const token = getBearerToken();
    if (!token) {
      logger.debug("X API key not configured — skipping user lookup", { username });
      return null;
    }
    const clean = username.replace(/^@/, "").trim();
    if (!clean) return null;

    const cacheKey = `user:${clean.toLowerCase()}`;
    const cachedTweets = searchCache.get(cacheKey);
    if (cachedTweets && cachedTweets.length === 1 && cachedTweets[0]) {
      const t = cachedTweets[0] as unknown as XUser;
      if ((t as unknown as { id?: string }).id) return t;
    }

    try {
      const params = new URLSearchParams({
        "user.fields": "public_metrics,description,verified",
      });
      const res = await fetch(
        `${this.baseUrl}/users/by/username/${encodeURIComponent(clean)}?${params.toString()}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        logger.warn("X user lookup returned non-OK", { status: res.status, username: clean });
        return null;
      }
      const json = (await res.json()) as {
        data?: {
          id: string;
          username: string;
          name: string;
          verified?: boolean;
          description?: string;
          public_metrics?: {
            followers_count: number;
            following_count: number;
            tweet_count: number;
          };
        };
      };
      if (!json.data) return null;
      const user: XUser = {
        id: json.data.id,
        username: json.data.username,
        name: json.data.name,
        verified: json.data.verified ?? false,
        description: json.data.description ?? "",
        followerCount: json.data.public_metrics?.followers_count ?? 0,
        followingCount: json.data.public_metrics?.following_count ?? 0,
        tweetCount: json.data.public_metrics?.tweet_count ?? 0,
      };
      return user;
    } catch (err) {
      logger.warn("X user lookup failed", { username: clean, err: String(err) });
      return null;
    }
  }

  /**
   * Fetch recent tweets from a user's timeline. Accepts either a numeric user
   * ID or a handle (will be resolved via getUserByUsername).
   */
  async getUserTimeline(
    userIdOrUsername: string,
    options: XTimelineOptions = {},
  ): Promise<XTweet[]> {
    const token = getBearerToken();
    if (!token) {
      logger.debug("X API key not configured — skipping timeline", { userIdOrUsername });
      return [];
    }

    let userId = userIdOrUsername;
    if (!/^\d+$/.test(userIdOrUsername)) {
      const user = await this.getUserByUsername(userIdOrUsername);
      if (!user) return [];
      userId = user.id;
    }

    const cacheKey = `timeline:${userId}:${JSON.stringify(options)}`;
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      max_results: String(Math.min(Math.max(options.maxResults ?? 20, 5), 100)),
      "tweet.fields": "created_at,public_metrics,author_id",
    });
    if (options.excludeReplies) params.set("exclude", "replies");
    if (options.startTime) params.set("start_time", options.startTime);

    try {
      const res = await fetch(`${this.baseUrl}/users/${userId}/tweets?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        logger.warn("X timeline API returned non-OK", { status: res.status, userId });
        return [];
      }
      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          text: string;
          author_id?: string;
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
        authorId: t.author_id ?? userId,
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
        entities: parseTextEntities(t.text),
      }));
      searchCache.set(cacheKey, tweets);
      return tweets;
    } catch (err) {
      logger.warn("X timeline failed", { userId, err: String(err) });
      return [];
    }
  }
}

/**
 * Public summary helper for callers that already have raw tweets (e.g. a
 * basket scan). Re-exports the internal summarize() logic so tools can
 * compute summaries without needing to re-implement weighting.
 */
export function summarizeTweets(query: string, tweets: XTweet[]): XSearchSummary {
  return summarize(query, tweets);
}

function buildSearchQuery(query: string, options: XSearchOptions): string {
  const parts = [query];
  if (options.contextAnnotations && options.contextAnnotations.length > 0) {
    const filter = buildContextFilter(options.contextAnnotations);
    if (filter) parts.push(filter);
  }
  if (options.excludeReplies) parts.push("-is:reply");
  parts.push("lang:en");
  return parts.join(" ");
}

function mapContextAnnotations(
  raw: Array<{
    domain: { id: string; name: string; description?: string };
    entity: { id: string; name: string; description?: string };
  }>,
): XContextAnnotation[] {
  const annotations: XContextAnnotation[] = [];
  for (const item of raw) {
    const known = getAnnotationByEntityId(item.entity.id);
    if (known) {
      annotations.push(known);
      continue;
    }
    annotations.push({
      domain: item.domain.id,
      entityId: item.entity.id,
      entityName: item.entity.name,
      symbol: item.entity.name,
      category: "generic",
    });
  }
  return annotations;
}

// ============================================================================
// Lightweight sentiment scoring (no ML dependency)
// ============================================================================

const BULL_WORDS = new Set([
  "buy",
  "long",
  "bull",
  "bullish",
  "moon",
  "pump",
  "breakout",
  "rally",
  "gains",
  "uptrend",
  "support",
  "accumulate",
  "strong",
  "beat",
  "upgrade",
  "outperform",
  "overweight",
  "target raised",
  "bullish bias",
]);
const BEAR_WORDS = new Set([
  "sell",
  "short",
  "bear",
  "bearish",
  "dump",
  "crash",
  "correction",
  "downtrend",
  "resistance",
  "weak",
  "miss",
  "downgrade",
  "underperform",
  "underweight",
  "target cut",
  "bearish bias",
  "rug",
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

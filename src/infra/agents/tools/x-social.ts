/**
 * X (Twitter) Social Intelligence Tools
 *
 * Mastra tools that wrap XSearchClient for trading-focused social signals:
 *   - search_x_sentiment        cashtag / keyword sentiment scan
 *   - get_x_trending_cashtags   mention-velocity ranking across a ticker basket
 *   - get_x_user_timeline       recent tweets from a single handle (whale / news watcher)
 *   - watch_x_accounts          parallel timeline pull across a curated list
 *   - analyze_x_narrative       deeper narrative synthesis (engagement-weighted + key voices)
 *
 * All tools degrade gracefully when X API is not configured: they return
 * `configured: false` with a BYOK message rather than failing. X requires a
 * paid Basic tier ($200/mo+) for search and timeline endpoints.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getXSearchClient, summarizeTweets, type XTweet } from "../../data/xSearch.ts";
import {
  resolveXContext,
  listXEntitySymbols,
  type XContextAnnotation,
  type XAnnotationCategory,
} from "../../data/xContextAnnotations.ts";

// ============================================================================
// Shared helpers
// ============================================================================

const NOT_CONFIGURED_MSG =
  "X API not configured. Set X_API_BEARER_TOKEN in ~/.gordon/.env to enable " +
  "social sentiment. X requires a paid Basic tier ($200/mo+) for search and timeline endpoints.";

function labelSentiment(score: number): string {
  if (score >= 0.5) return "strongly bullish";
  if (score >= 0.2) return "bullish";
  if (score >= 0.05) return "slightly bullish";
  if (score >= -0.05) return "neutral";
  if (score >= -0.2) return "slightly bearish";
  if (score >= -0.5) return "bearish";
  return "strongly bearish";
}

function engagementOf(t: XTweet): number {
  const m = t.metrics;
  if (!m) return 0;
  return m.likeCount + m.retweetCount * 2 + m.replyCount + m.quoteCount;
}

function shapeTweet(t: XTweet) {
  return {
    id: t.id,
    text: t.text,
    authorId: t.authorId,
    createdAt: t.createdAt,
    sentiment: Number((t.sentiment ?? 0).toFixed(3)),
    likes: t.metrics?.likeCount ?? 0,
    retweets: t.metrics?.retweetCount ?? 0,
    replies: t.metrics?.replyCount ?? 0,
    quotes: t.metrics?.quoteCount ?? 0,
    engagement: engagementOf(t),
    cashtags: t.entities?.cashtags ?? [],
    hashtags: t.entities?.hashtags ?? [],
    mentions: t.entities?.mentions ?? [],
  };
}

// ============================================================================
// 1. search_x_sentiment — cashtag / keyword sentiment scan
// ============================================================================

export const searchXSentimentTool = createTool({
  id: "search_x_sentiment",
  description:
    "Search X (Twitter) for cashtag or keyword sentiment. Returns engagement-weighted " +
    "bullish/bearish score and top tweets by engagement. Use for sentiment checks on " +
    "a specific ticker ($BTC, $TSLA), a narrative ('bitcoin ETF', 'AI agents'), or " +
    "pre-trade social confirmation. Window defaults to 24h; X API allows up to 7 days " +
    "on Basic tier.",
  inputSchema: z.object({
    query: z.string().describe(
      "Cashtag ($BTC, $TSLA) or keyword phrase. Cashtags automatically prefix with '$'.",
    ),
    maxResults: z.number().int().min(10).max(100).optional().default(30),
    excludeReplies: z.boolean().optional().default(true),
    windowHours: z.number().int().min(1).max(168).optional().default(24),
    minAuthorFollowers: z.number().int().min(0).optional().describe(
      "Optional anti-noise filter: drop authors with fewer than N followers.",
    ),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    query: z.string(),
    windowHours: z.number(),
    totalTweets: z.number(),
    avgSentiment: z.number(),
    weightedSentiment: z.number(),
    sentimentLabel: z.string(),
    topTweets: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          authorId: z.string(),
          createdAt: z.string(),
          sentiment: z.number(),
          likes: z.number(),
          retweets: z.number(),
          replies: z.number(),
          quotes: z.number(),
          engagement: z.number(),
          cashtags: z.array(z.string()).optional(),
          hashtags: z.array(z.string()).optional(),
          mentions: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ query, maxResults, excludeReplies, windowHours, minAuthorFollowers }) => {
    const client = getXSearchClient();
    if (!(await client.isConfigured())) {
      return {
        configured: false,
        query,
        windowHours: windowHours ?? 24,
        totalTweets: 0,
        avgSentiment: 0,
        weightedSentiment: 0,
        sentimentLabel: "unavailable",
        error: NOT_CONFIGURED_MSG,
      };
    }

    try {
      const startTime = new Date(Date.now() - (windowHours ?? 24) * 60 * 60 * 1000).toISOString();
      const looksCashtagLike = /^\$?[A-Za-z]{1,10}$/.test(query.trim());
      const effectiveQuery = looksCashtagLike
        ? `$${query.replace(/^\$/, "").toUpperCase()}`
        : query;

      const tweets = await client.search(effectiveQuery, {
        maxResults,
        excludeReplies,
        startTime,
        minAuthorFollowers,
      });
      const summary = summarizeTweets(effectiveQuery, tweets);

      return {
        configured: true,
        query: summary.query,
        windowHours: windowHours ?? 24,
        totalTweets: summary.totalTweets,
        avgSentiment: Number(summary.avgSentiment.toFixed(3)),
        weightedSentiment: Number(summary.weightedSentiment.toFixed(3)),
        sentimentLabel: labelSentiment(summary.weightedSentiment),
        topTweets: summary.topTweets.map(shapeTweet),
      };
    } catch (e) {
      return {
        configured: true,
        query,
        windowHours: windowHours ?? 24,
        totalTweets: 0,
        avgSentiment: 0,
        weightedSentiment: 0,
        sentimentLabel: "error",
        error: `X search failed: ${(e as Error).message}`,
      };
    }
  },
});

// ============================================================================
// 2. get_x_trending_cashtags — mention velocity across a basket
// ============================================================================

export const getXTrendingCashtagsTool = createTool({
  id: "get_x_trending_cashtags",
  description:
    "Rank a basket of tickers by X mention velocity. Parallel-scans each cashtag " +
    "and returns ranked results with mention count, weighted sentiment, and " +
    "engagement totals. Use for 'what's the market buzzing about right now?' " +
    "queries or to pick which ticker from a watchlist deserves deeper research first.",
  inputSchema: z.object({
    tickers: z
      .array(z.string())
      .min(1)
      .max(20)
      .describe("Ticker symbols without '$' prefix, e.g. ['BTC', 'ETH', 'SOL', 'DOGE']."),
    windowHours: z.number().int().min(1).max(168).optional().default(6),
    maxResultsPerTicker: z.number().int().min(10).max(100).optional().default(30),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    windowHours: z.number(),
    ranked: z
      .array(
        z.object({
          ticker: z.string(),
          mentionCount: z.number(),
          totalEngagement: z.number(),
          avgSentiment: z.number(),
          weightedSentiment: z.number(),
          sentimentLabel: z.string(),
          topTweetText: z.string().optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ tickers, windowHours, maxResultsPerTicker }) => {
    const client = getXSearchClient();
    if (!(await client.isConfigured())) {
      return {
        configured: false,
        windowHours: windowHours ?? 6,
        error: NOT_CONFIGURED_MSG,
      };
    }

    try {
      const startTime = new Date(Date.now() - (windowHours ?? 6) * 60 * 60 * 1000).toISOString();
      const settled = await Promise.allSettled(
        tickers.map(async (raw) => {
          const ticker = raw.replace(/^\$/, "").toUpperCase();
          const tweets = await client.search(`$${ticker}`, {
            maxResults: maxResultsPerTicker,
            excludeReplies: true,
            startTime,
          });
          const summary = summarizeTweets(`$${ticker}`, tweets);
          const totalEngagement = tweets.reduce((sum, t) => sum + engagementOf(t), 0);
          return {
            ticker,
            mentionCount: summary.totalTweets,
            totalEngagement,
            avgSentiment: Number(summary.avgSentiment.toFixed(3)),
            weightedSentiment: Number(summary.weightedSentiment.toFixed(3)),
            sentimentLabel: labelSentiment(summary.weightedSentiment),
            topTweetText: summary.topTweets[0]?.text,
          };
        }),
      );

      const ranked = settled
        .filter((s): s is PromiseFulfilledResult<any> => s.status === "fulfilled")
        .map((s) => s.value)
        .sort((a, b) => b.mentionCount * Math.log10(b.totalEngagement + 10)
                      - a.mentionCount * Math.log10(a.totalEngagement + 10));

      return {
        configured: true,
        windowHours: windowHours ?? 6,
        ranked,
      };
    } catch (e) {
      return {
        configured: true,
        windowHours: windowHours ?? 6,
        error: `X trending scan failed: ${(e as Error).message}`,
      };
    }
  },
});

// ============================================================================
// 3. get_x_user_timeline — recent tweets from a single handle
// ============================================================================

export const getXUserTimelineTool = createTool({
  id: "get_x_user_timeline",
  description:
    "Fetch recent tweets from a specific X account. Use for whale/analyst watching " +
    "(e.g. @hyblockcapital, @CryptoCapo_), exchange announcements (@binance, @coinbase), " +
    "or news accounts. Returns tweets with engagement metrics and a rolling sentiment " +
    "score over the provided window.",
  inputSchema: z.object({
    username: z.string().describe("X handle with or without '@' prefix."),
    maxResults: z.number().int().min(5).max(100).optional().default(20),
    excludeReplies: z.boolean().optional().default(true),
    windowHours: z.number().int().min(1).max(168).optional().default(24),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    username: z.string(),
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        verified: z.boolean(),
        followerCount: z.number(),
        description: z.string(),
      })
      .optional(),
    totalTweets: z.number(),
    avgSentiment: z.number(),
    weightedSentiment: z.number(),
    sentimentLabel: z.string(),
    tweets: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          authorId: z.string(),
          createdAt: z.string(),
          sentiment: z.number(),
          likes: z.number(),
          retweets: z.number(),
          replies: z.number(),
          quotes: z.number(),
          engagement: z.number(),
          cashtags: z.array(z.string()).optional(),
          hashtags: z.array(z.string()).optional(),
          mentions: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ username, maxResults, excludeReplies, windowHours }) => {
    const client = getXSearchClient();
    const clean = username.replace(/^@/, "");
    if (!(await client.isConfigured())) {
      return {
        configured: false,
        username: clean,
        totalTweets: 0,
        avgSentiment: 0,
        weightedSentiment: 0,
        sentimentLabel: "unavailable",
        error: NOT_CONFIGURED_MSG,
      };
    }

    try {
      const startTime = new Date(Date.now() - (windowHours ?? 24) * 60 * 60 * 1000).toISOString();
      const user = await client.getUserByUsername(clean);
      if (!user) {
        return {
          configured: true,
          username: clean,
          totalTweets: 0,
          avgSentiment: 0,
          weightedSentiment: 0,
          sentimentLabel: "unavailable",
          error: `X user not found: @${clean}`,
        };
      }
      const tweets = await client.getUserTimeline(user.id, {
        maxResults,
        excludeReplies,
        startTime,
      });
      const summary = summarizeTweets(`@${clean}`, tweets);

      return {
        configured: true,
        username: clean,
        user: {
          id: user.id,
          name: user.name,
          verified: user.verified,
          followerCount: user.followerCount,
          description: user.description.slice(0, 200),
        },
        totalTweets: summary.totalTweets,
        avgSentiment: Number(summary.avgSentiment.toFixed(3)),
        weightedSentiment: Number(summary.weightedSentiment.toFixed(3)),
        sentimentLabel: labelSentiment(summary.weightedSentiment),
        tweets: tweets.map(shapeTweet),
      };
    } catch (e) {
      return {
        configured: true,
        username: clean,
        totalTweets: 0,
        avgSentiment: 0,
        weightedSentiment: 0,
        sentimentLabel: "error",
        error: `X timeline failed: ${(e as Error).message}`,
      };
    }
  },
});

// ============================================================================
// 4. watch_x_accounts — parallel pull across a curated whale/news list
// ============================================================================

export const watchXAccountsTool = createTool({
  id: "watch_x_accounts",
  description:
    "Monitor a curated list of X accounts in parallel. Pulls recent tweets from each " +
    "handle, flags posts with high engagement, and surfaces the top signal. Use for " +
    "news desks, whale watchers, or a custom 'trading A-list'. Caller provides the list " +
    "— Gordon does not persist it.",
  inputSchema: z.object({
    usernames: z
      .array(z.string())
      .min(1)
      .max(15)
      .describe("Up to 15 X handles (with or without '@')."),
    windowHours: z.number().int().min(1).max(168).optional().default(6),
    maxPerAccount: z.number().int().min(5).max(50).optional().default(10),
    minEngagement: z.number().int().min(0).optional().default(100).describe(
      "Only surface tweets with engagement >= this threshold as highlights.",
    ),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    windowHours: z.number(),
    accountsChecked: z.number(),
    totalTweets: z.number(),
    highlights: z
      .array(
        z.object({
          username: z.string(),
          authorId: z.string(),
          text: z.string(),
          createdAt: z.string(),
          engagement: z.number(),
          sentiment: z.number(),
          sentimentLabel: z.string(),
        }),
      )
      .optional(),
    perAccountSummary: z
      .array(
        z.object({
          username: z.string(),
          tweetCount: z.number(),
          avgSentiment: z.number(),
          sentimentLabel: z.string(),
          topEngagement: z.number(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ usernames, windowHours, maxPerAccount, minEngagement }) => {
    const client = getXSearchClient();
    if (!(await client.isConfigured())) {
      return {
        configured: false,
        windowHours: windowHours ?? 6,
        accountsChecked: 0,
        totalTweets: 0,
        error: NOT_CONFIGURED_MSG,
      };
    }

    try {
      const startTime = new Date(Date.now() - (windowHours ?? 6) * 60 * 60 * 1000).toISOString();
      const settled = await Promise.allSettled(
        usernames.map(async (raw) => {
          const username = raw.replace(/^@/, "");
          const user = await client.getUserByUsername(username);
          if (!user) return { username, tweets: [] as XTweet[] };
          const tweets = await client.getUserTimeline(user.id, {
            maxResults: maxPerAccount,
            excludeReplies: true,
            startTime,
          });
          return { username, tweets };
        }),
      );

      const results = settled
        .filter((s): s is PromiseFulfilledResult<{ username: string; tweets: XTweet[] }> => s.status === "fulfilled")
        .map((s) => s.value);

      const highlights = results
        .flatMap((r) =>
          r.tweets
            .filter((t) => engagementOf(t) >= (minEngagement ?? 100))
            .map((t) => ({
              username: r.username,
              authorId: t.authorId,
              text: t.text,
              createdAt: t.createdAt,
              engagement: engagementOf(t),
              sentiment: Number((t.sentiment ?? 0).toFixed(3)),
              sentimentLabel: labelSentiment(t.sentiment ?? 0),
            })),
        )
        .sort((a, b) => b.engagement - a.engagement)
        .slice(0, 20);

      const perAccountSummary = results.map((r) => {
        const sentiments = r.tweets.map((t) => t.sentiment ?? 0);
        const avg = sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0;
        const topEngagement = r.tweets.reduce((max, t) => Math.max(max, engagementOf(t)), 0);
        return {
          username: r.username,
          tweetCount: r.tweets.length,
          avgSentiment: Number(avg.toFixed(3)),
          sentimentLabel: labelSentiment(avg),
          topEngagement,
        };
      });

      const totalTweets = results.reduce((sum, r) => sum + r.tweets.length, 0);

      return {
        configured: true,
        windowHours: windowHours ?? 6,
        accountsChecked: results.length,
        totalTweets,
        highlights,
        perAccountSummary,
      };
    } catch (e) {
      return {
        configured: true,
        windowHours: windowHours ?? 6,
        accountsChecked: 0,
        totalTweets: 0,
        error: `X account watch failed: ${(e as Error).message}`,
      };
    }
  },
});

// ============================================================================
// 5. analyze_x_narrative — deep narrative synthesis
// ============================================================================

export const analyzeXNarrativeTool = createTool({
  id: "analyze_x_narrative",
  description:
    "Deep X narrative analysis for a trading thesis. Runs an engagement-weighted " +
    "sentiment pass, identifies the top voices driving the conversation, computes " +
    "narrative strength (tweets/hour + engagement momentum), and returns the " +
    "headline bull/bear quotes. Use when a user asks 'what's the narrative around " +
    "X?' or for pre-position confirmation on discretionary bets.",
  inputSchema: z.object({
    narrative: z.string().describe(
      "Narrative phrase — e.g. 'bitcoin ETF flows', 'AI agents trading', '$SOL breakout', 'solana outage'.",
    ),
    windowHours: z.number().int().min(1).max(168).optional().default(24),
    maxResults: z.number().int().min(20).max(100).optional().default(60),
    minAuthorFollowers: z.number().int().min(0).optional().default(500),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    narrative: z.string(),
    windowHours: z.number(),
    totalTweets: z.number(),
    narrativeStrength: z.object({
      tweetsPerHour: z.number(),
      engagementPerTweet: z.number(),
      momentumLabel: z.string(),
    }).optional(),
    sentiment: z.object({
      avg: z.number(),
      weighted: z.number(),
      label: z.string(),
      bullRatio: z.number(),
      bearRatio: z.number(),
    }).optional(),
    topVoices: z
      .array(
        z.object({
          authorId: z.string(),
          tweetCount: z.number(),
          totalEngagement: z.number(),
          avgSentiment: z.number(),
        }),
      )
      .optional(),
    bullQuote: z
      .object({
        text: z.string(),
        engagement: z.number(),
      })
      .optional(),
    bearQuote: z
      .object({
        text: z.string(),
        engagement: z.number(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ narrative, windowHours, maxResults, minAuthorFollowers }) => {
    const client = getXSearchClient();
    if (!(await client.isConfigured())) {
      return {
        configured: false,
        narrative,
        windowHours: windowHours ?? 24,
        totalTweets: 0,
        error: NOT_CONFIGURED_MSG,
      };
    }

    try {
      const startTime = new Date(Date.now() - (windowHours ?? 24) * 60 * 60 * 1000).toISOString();
      const tweets = await client.search(narrative, {
        maxResults,
        excludeReplies: true,
        startTime,
        minAuthorFollowers,
      });

      if (tweets.length === 0) {
        return {
          configured: true,
          narrative,
          windowHours: windowHours ?? 24,
          totalTweets: 0,
        };
      }

      const summary = summarizeTweets(narrative, tweets);
      const totalEngagement = tweets.reduce((sum, t) => sum + engagementOf(t), 0);
      const engagementPerTweet = tweets.length > 0 ? totalEngagement / tweets.length : 0;
      const tweetsPerHour = tweets.length / (windowHours ?? 24);

      // Momentum label
      let momentumLabel = "quiet";
      if (tweetsPerHour >= 20 && engagementPerTweet >= 100) momentumLabel = "viral";
      else if (tweetsPerHour >= 10 || engagementPerTweet >= 100) momentumLabel = "hot";
      else if (tweetsPerHour >= 3) momentumLabel = "active";

      // Top voices (by author)
      const byAuthor = new Map<string, { count: number; engagement: number; sentimentSum: number }>();
      for (const t of tweets) {
        const cur = byAuthor.get(t.authorId) ?? { count: 0, engagement: 0, sentimentSum: 0 };
        cur.count += 1;
        cur.engagement += engagementOf(t);
        cur.sentimentSum += t.sentiment ?? 0;
        byAuthor.set(t.authorId, cur);
      }
      const topVoices = [...byAuthor.entries()]
        .map(([authorId, v]) => ({
          authorId,
          tweetCount: v.count,
          totalEngagement: v.engagement,
          avgSentiment: Number((v.sentimentSum / v.count).toFixed(3)),
        }))
        .sort((a, b) => b.totalEngagement - a.totalEngagement)
        .slice(0, 5);

      // Bull/bear ratio
      const bulls = tweets.filter((t) => (t.sentiment ?? 0) > 0.1).length;
      const bears = tweets.filter((t) => (t.sentiment ?? 0) < -0.1).length;

      // Best bull/bear quotes (engagement-weighted)
      const bullQuoteTweet = [...tweets]
        .filter((t) => (t.sentiment ?? 0) > 0.1)
        .sort((a, b) => engagementOf(b) - engagementOf(a))[0];
      const bearQuoteTweet = [...tweets]
        .filter((t) => (t.sentiment ?? 0) < -0.1)
        .sort((a, b) => engagementOf(b) - engagementOf(a))[0];

      return {
        configured: true,
        narrative,
        windowHours: windowHours ?? 24,
        totalTweets: tweets.length,
        narrativeStrength: {
          tweetsPerHour: Number(tweetsPerHour.toFixed(2)),
          engagementPerTweet: Number(engagementPerTweet.toFixed(1)),
          momentumLabel,
        },
        sentiment: {
          avg: Number(summary.avgSentiment.toFixed(3)),
          weighted: Number(summary.weightedSentiment.toFixed(3)),
          label: labelSentiment(summary.weightedSentiment),
          bullRatio: Number((bulls / tweets.length).toFixed(3)),
          bearRatio: Number((bears / tweets.length).toFixed(3)),
        },
        topVoices,
        bullQuote: bullQuoteTweet
          ? { text: bullQuoteTweet.text, engagement: engagementOf(bullQuoteTweet) }
          : undefined,
        bearQuote: bearQuoteTweet
          ? { text: bearQuoteTweet.text, engagement: engagementOf(bearQuoteTweet) }
          : undefined,
      };
    } catch (e) {
      return {
        configured: true,
        narrative,
        windowHours: windowHours ?? 24,
        totalTweets: 0,
        error: `X narrative analysis failed: ${(e as Error).message}`,
      };
    }
  },
});

// ============================================================================
// 6. search_x_by_entity — high-precision search via X context annotations
// ============================================================================

export const searchXByEntityTool = createTool({
  id: "search_x_by_entity",
  description:
    "High-precision X search using X's auto-classified context annotations instead " +
    "of raw keywords. X tags tweets with entities (Bitcoin cryptocurrency, $TSLA, " +
    "Ethereum cryptocurrency, etc.) — filtering on these catches tweets that don't " +
    "use the exact cashtag but ARE about the asset, and excludes false positives " +
    "where the keyword appears in unrelated context. Use for narrative analysis, " +
    "pre-position sentiment confirmation, or high-signal whale sentiment checks. " +
    "If the entity is not in Gordon's curated map, the tool falls back to keyword " +
    "search and returns a note. NOTE: the context: search operator may require a " +
    "paid X API tier.",
  inputSchema: z.object({
    entity: z.string().describe(
      "Entity name, ticker, or alias — e.g. 'BTC', 'bitcoin', '$TSLA', 'tesla', 'solana', 'AAPL'.",
    ),
    maxResults: z.number().int().min(10).max(100).optional().default(50),
    excludeReplies: z.boolean().optional().default(true),
    windowHours: z.number().int().min(1).max(168).optional().default(24),
    minAuthorFollowers: z.number().int().min(0).optional().default(500),
    additionalQuery: z.string().optional().describe(
      "Optional additional keyword filter on top of the entity filter, " +
      "e.g. 'etf' to narrow Bitcoin results to the ETF narrative.",
    ),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    entityInput: z.string(),
    resolvedAnnotations: z
      .array(
        z.object({
          domain: z.string(),
          entityId: z.string(),
          entityName: z.string(),
          symbol: z.string(),
          category: z.string(),
        }),
      )
      .optional(),
    fallbackMode: z.boolean(),
    totalTweets: z.number(),
    avgSentiment: z.number(),
    weightedSentiment: z.number(),
    sentimentLabel: z.string(),
    topTweets: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          authorId: z.string(),
          createdAt: z.string(),
          sentiment: z.number(),
          likes: z.number(),
          retweets: z.number(),
          replies: z.number(),
          quotes: z.number(),
          engagement: z.number(),
          cashtags: z.array(z.string()).optional(),
          hashtags: z.array(z.string()).optional(),
          mentions: z.array(z.string()).optional(),
          relatedEntities: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    coMentionedEntities: z
      .array(
        z.object({
          entityName: z.string(),
          symbol: z.string(),
          category: z.string(),
          mentionCount: z.number(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ entity, maxResults, excludeReplies, windowHours, minAuthorFollowers, additionalQuery }) => {
    const client = getXSearchClient();
    if (!(await client.isConfigured())) {
      return {
        configured: false,
        entityInput: entity,
        fallbackMode: false,
        totalTweets: 0,
        avgSentiment: 0,
        weightedSentiment: 0,
        sentimentLabel: "unavailable",
        error: NOT_CONFIGURED_MSG,
      };
    }

    const annotations = resolveXContext(entity);
    const fallbackMode = annotations.length === 0;
    const shapedResolved = annotations.map((a) => ({
      domain: a.domain,
      entityId: a.entityId,
      entityName: a.entityName,
      symbol: a.symbol,
      category: a.category,
    }));

    try {
      const startTime = new Date(Date.now() - (windowHours ?? 24) * 60 * 60 * 1000).toISOString();

      let tweets: XTweet[] = [];
      if (fallbackMode) {
        tweets = await client.search(additionalQuery ? `${entity} ${additionalQuery}` : entity, {
          maxResults,
          excludeReplies,
          startTime,
          minAuthorFollowers,
          includeContextFields: true,
        });
      } else {
        tweets = await client.search(additionalQuery ?? "", {
          maxResults,
          excludeReplies,
          startTime,
          minAuthorFollowers,
          contextAnnotations: annotations,
          includeContextFields: true,
        });
      }

      if (tweets.length === 0) {
        return {
          configured: true,
          entityInput: entity,
          resolvedAnnotations: fallbackMode ? undefined : shapedResolved,
          fallbackMode,
          totalTweets: 0,
          avgSentiment: 0,
          weightedSentiment: 0,
          sentimentLabel: "no data",
        };
      }

      const summary = summarizeTweets(entity, tweets);

      const coMentioned = new Map<string, { entityName: string; symbol: string; category: string; count: number }>();
      const resolvedEntityIds = new Set(annotations.map((a) => a.entityId));
      for (const t of tweets) {
        if (!t.contextAnnotations) continue;
        for (const ann of t.contextAnnotations) {
          if (resolvedEntityIds.has(ann.entityId)) continue;
          const key = ann.entityId;
          const existing = coMentioned.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            coMentioned.set(key, {
              entityName: ann.entityName,
              symbol: ann.symbol,
              category: ann.category,
              count: 1,
            });
          }
        }
      }
      const coMentionedEntities = [...coMentioned.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((e) => ({
          entityName: e.entityName,
          symbol: e.symbol,
          category: e.category,
          mentionCount: e.count,
        }));

      return {
        configured: true,
        entityInput: entity,
        resolvedAnnotations: fallbackMode ? undefined : shapedResolved,
        fallbackMode,
        totalTweets: summary.totalTweets,
        avgSentiment: Number(summary.avgSentiment.toFixed(3)),
        weightedSentiment: Number(summary.weightedSentiment.toFixed(3)),
        sentimentLabel: labelSentiment(summary.weightedSentiment),
        topTweets: summary.topTweets.map((t) => ({
          ...shapeTweet(t),
          relatedEntities: t.contextAnnotations?.map((a) => a.entityName).filter((n) => n) ?? [],
        })),
        coMentionedEntities,
      };
    } catch (e) {
      return {
        configured: true,
        entityInput: entity,
        resolvedAnnotations: fallbackMode ? undefined : shapedResolved,
        fallbackMode,
        totalTweets: 0,
        avgSentiment: 0,
        weightedSentiment: 0,
        sentimentLabel: "error",
        error: `X entity search failed: ${(e as Error).message}`,
      };
    }
  },
});

// ============================================================================
// 7. list_x_trading_entities — discovery helper for the agent
// ============================================================================

export const listXTradingEntitiesTool = createTool({
  id: "list_x_trading_entities",
  description:
    "List the trading entities Gordon can filter by on X using context annotations. " +
    "Use this when you're not sure if an entity (coin, stock, ETF) is supported for " +
    "high-precision search_x_by_entity lookups. Returns the canonical symbol, X " +
    "entity name, and category (crypto / stock / etf / index). No API call — cheap " +
    "to call repeatedly.",
  inputSchema: z.object({
    category: z
      .enum(["crypto", "stock", "etf", "index", "forex", "commodity", "generic", "all"])
      .optional()
      .default("all")
      .describe("Filter by category; omit for all."),
  }),
  outputSchema: z.object({
    total: z.number(),
    entities: z.array(
      z.object({
        symbol: z.string(),
        entityName: z.string(),
        category: z.string(),
      }),
    ),
  }),
  execute: async ({ category }) => {
    const all = listXEntitySymbols();
    const filtered = !category || category === "all"
      ? all
      : all.filter((e) => e.category === (category as XAnnotationCategory));
    return {
      total: filtered.length,
      entities: filtered,
    };
  },
});

// ============================================================================
// Export
// ============================================================================

export const xSocialTools = {
  search_x_sentiment: searchXSentimentTool,
  get_x_trending_cashtags: getXTrendingCashtagsTool,
  get_x_user_timeline: getXUserTimelineTool,
  watch_x_accounts: watchXAccountsTool,
  analyze_x_narrative: analyzeXNarrativeTool,
  search_x_by_entity: searchXByEntityTool,
  list_x_trading_entities: listXTradingEntitiesTool,
};

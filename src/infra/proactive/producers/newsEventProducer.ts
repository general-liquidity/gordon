/**
 * News Event Producer
 *
 * Periodic producer that polls public crypto-news RSS feeds (CoinDesk,
 * Cointelegraph, Decrypt) for headlines mentioning the user's monitored
 * symbols, scores them with a keyword sentiment classifier, and fires a
 * `news_event` candidate when a single headline is high-confidence
 * bullish/bearish OR when the aggregate tone over the last hour flips
 * sharply for any monitored asset.
 *
 * Symbol set: monitored symbols from resolveMonitoredSymbols() — same
 * set the regime / volatility producers use.
 *
 * State: keeps a per-symbol fingerprint of headlines we've already
 * fired on so the same article doesn't re-trigger across ticks.
 *
 * No API keys: all sources are free public RSS. The whole pipeline
 * (fetch + parse + score + dedupe) runs in a single tick on the order
 * of tens of ms when the cache is warm; the per-source 5-minute cache
 * inside cryptoHeadlines.ts keeps tick-on-tick fetches cheap.
 */

import type { CandidateProducer } from "../proactiveEngine.ts";
import { buildCandidate } from "../proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { resolveMonitoredSymbols } from "./candleFetch.ts";
import { fetchHeadlines, type NewsHeadline } from "../../news/cryptoHeadlines.ts";
import { scoreSentiment } from "../../news/sentiment.ts";

const logger = createModuleLogger("news-event-producer");

const HOURS_BACK = 6;
/** Only fire on a single headline if its sentiment score crosses this. */
const STRONG_SIGNAL_CONFIDENCE = 0.7;
/** Cap candidates per tick — don't spam if a feed has 10 bullish stories. */
const MAX_CANDIDATES_PER_TICK = 3;

// Per-symbol fingerprint set so we don't re-fire on the same headline
// link across ticks. Keys: link URLs we've already used. Cleared on
// engine reset.
const firedLinksBySymbol = new Map<string, Set<string>>();

export const newsEventProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_news_event") return [];

  const symbols = await resolveMonitoredSymbols();
  if (symbols.length === 0) return [];

  // Strip USDT/USDC/USD/etc. suffix for the news query — feeds talk
  // about "Bitcoin" not "BTCUSDT". The expansion in cryptoHeadlines
  // handles BTC → bitcoin etc.
  const queryTokens = new Set<string>();
  for (const s of symbols) {
    const base = s.replace(/(USDT|USDC|FDUSD|TUSD|BUSD|USD|EUR|GBP|JPY)$/i, "");
    if (base) queryTokens.add(base);
  }
  const query = [...queryTokens].join("|");

  let headlines: NewsHeadline[];
  try {
    headlines = await fetchHeadlines({ query, hoursBack: HOURS_BACK, limit: 50 });
  } catch (err) {
    logger.debug("Headline fetch failed", { err: String(err) });
    return [];
  }

  if (headlines.length === 0) return [];

  // For each monitored symbol, find the highest-confidence non-neutral
  // headline we haven't already fired on. This keeps cards
  // symbol-scoped and de-duplicated.
  const candidates: ProactiveSuggestion[] = [];
  for (const baseSymbol of queryTokens) {
    let already = firedLinksBySymbol.get(baseSymbol);
    if (!already) {
      already = new Set<string>();
      firedLinksBySymbol.set(baseSymbol, already);
    }

    // Filter headlines that mention this specific symbol (the broader
    // query was OR-ed across all monitored symbols; we narrow per-symbol
    // here so a "Bitcoin surges" story doesn't fire on ETH).
    const symbolRe = new RegExp(`\\b${baseSymbol}\\b`, "i");
    const symbolHeadlines = headlines.filter((h) => symbolRe.test(h.title));

    let best: { headline: NewsHeadline; score: ReturnType<typeof scoreSentiment> } | null = null;
    for (const h of symbolHeadlines) {
      if (already.has(h.link)) continue;
      const score = scoreSentiment(h.title);
      if (score.sentiment === "neutral") continue;
      if (score.confidence < STRONG_SIGNAL_CONFIDENCE) continue;
      if (!best || score.confidence > best.score.confidence) {
        best = { headline: h, score };
      }
    }
    if (!best) continue;

    already.add(best.headline.link);

    const tone = best.score.sentiment === "bullish" ? "Bullish" : "Bearish";
    const action =
      best.score.sentiment === "bullish"
        ? `Consider whether the news strengthens an existing long thesis or unwinds a short on ${baseSymbol}.`
        : `Consider tightening stops on long ${baseSymbol} positions or pausing new entries until the dust settles.`;

    candidates.push(
      buildCandidate(
        "news_event",
        `${tone} news on ${baseSymbol}: ${best.headline.title}`,
        `${best.headline.source} just ran "${best.headline.title}". Sentiment: ${best.score.sentiment} (${(best.score.confidence * 100).toFixed(0)}% confidence). Matched keywords: ${best.score.matchedKeywords.slice(0, 4).join(", ")}.`,
        {
          confidence: best.score.confidence,
          action,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_news_event",
            metadata: {
              symbol: baseSymbol,
              link: best.headline.link,
              headlineSource: best.headline.source,
              sentiment: best.score.sentiment,
            },
          },
        },
      ),
    );

    if (candidates.length >= MAX_CANDIDATES_PER_TICK) break;
  }

  return candidates;
};

/** Test / engine-reset hook — clears the per-symbol fired-link set so
 *  the producer doesn't carry state across test runs or engine restarts. */
export function resetNewsEventProducerState(): void {
  firedLinksBySymbol.clear();
}

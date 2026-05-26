/**
 * Synthesis manifest — fingerprint of what this session SAW when a plan was
 * created.
 *
 * The "edge in the void" thesis (Wikoff 2026): a discretionary trader's edge
 * isn't in the setup, it's in the synthesis across heterogeneous inputs
 * (regime + news + positioning + reps) that converges on a decision the
 * spreadsheet can't capture. You can't backtest that synthesis — but you
 * CAN snapshot the inputs that were present at decision time, so the
 * journal-review skill (or the operator) can replay why a trade felt right.
 *
 * What this is NOT: a packaged edge, a reproducible setup, a signal. It's
 * a provenance artifact. The trade was a function of these inputs + the
 * operator's wiring. Capture the inputs; the wiring stays in the operator.
 *
 * Read-only by construction: every subsystem read is non-blocking + falls
 * back to null. The manifest may be partial. A partial manifest is more
 * useful than a missing one — a future review can still say "regime was X,
 * news was empty (cold cache), 0 observations" and that itself is signal.
 */

import { peekCachedHeadlines } from "../../news/cryptoHeadlines.ts";
import { scoreSentiment, aggregateSentiment, type Sentiment } from "../../news/sentiment.ts";
import { RegimeDetector } from "../../../core/regime/index.ts";
import { loadACELessons } from "../ace/Curator.ts";
import { getSymbolObservationCount } from "./symbolObservationTracker.ts";
import { readCandles } from "../../data/ohlcvCache.ts";

const DEFAULT_OBSERVATION_WINDOW_MS = 4 * 60 * 60 * 1000; // 4h
const MAX_MATCHED_LESSON_IDS = 8;

export interface SynthesisManifest {
  capturedAt: number;
  symbol: string;
  /** Active regime detected for this symbol in THIS session, or null when
   *  the detector hasn't seen this symbol yet. */
  regime: {
    label: string;
    confidence: number;
    timeframe: string;
  } | null;
  /** Aggregate read of news currently in the in-process cache (no network).
   *  null when the cache is cold or no headlines match the symbol. */
  news: {
    headlinesCount: number;
    netSentiment: number;
    windowHoursApprox: number;
    topBullish?: string;
    topBearish?: string;
  } | null;
  /** Number of data-tool observations recorded on this symbol in the
   *  window. Same source as `symbolObservationTracker`. */
  observationCount: number;
  observationWindowMs: number;
  /** ACE lesson IDs whose text mentions the symbol or its base token.
   *  Capped at MAX_MATCHED_LESSON_IDS — most-recently-updated first. */
  matchedLessonIds: string[];
  /**
   * Pointer into the local OHLCV cache so a future /replay-decision
   * skill can reconstruct the exact candle window the LLM saw at plan
   * creation. Null when no cached candles exist for this symbol — the
   * cache is populated lazily on get_market_data calls, so plans whose
   * data was never read through Gordon (operator pasted a chart, etc.)
   * won't carry a ref.
   */
  candleSnapshotRef: {
    venue: string;
    symbol: string;
    timeframe: string;
    fromTs: number;
    toTs: number;
    asOfStoredAt: number;
    barCount: number;
  } | null;
}

/** Normalize "BTC/USDT" → ["BTC/USDT", "BTCUSDT", "BTC"] for fuzzy text
 *  matching against headlines + lesson bodies. Lowercased. */
function symbolTokens(symbol: string): string[] {
  const raw = symbol.trim().toUpperCase();
  if (!raw) return [];
  const tokens = new Set<string>();
  tokens.add(raw.toLowerCase());
  const noSlash = raw.replace(/\//g, "");
  if (noSlash !== raw) tokens.add(noSlash.toLowerCase());
  const base = raw.split("/")[0];
  if (base && base !== raw) tokens.add(base.toLowerCase());
  // Strip common quote suffixes to recover the base ticker for unsplit
  // symbols like "BTCUSDT" → "BTC". Order matters — try the longer
  // suffixes first.
  for (const suffix of ["USDT", "USDC", "USD", "BUSD", "DAI", "EUR", "BTC", "ETH"]) {
    if (raw.endsWith(suffix) && raw.length > suffix.length) {
      const stripped = raw.slice(0, -suffix.length).toLowerCase();
      if (stripped.length >= 2) tokens.add(stripped);
    }
  }
  return [...tokens];
}

function tryRegime(symbol: string): SynthesisManifest["regime"] {
  try {
    const detector = RegimeDetector.getInstance();
    const signal = detector.getCurrentRegime(symbol, "1h");
    if (!signal) return null;
    return {
      label: String(signal.regime),
      confidence: Number(signal.confidence ?? 0),
      timeframe: "1h",
    };
  } catch {
    return null;
  }
}

function tryNews(tokens: string[]): SynthesisManifest["news"] {
  if (tokens.length === 0) return null;
  let cached;
  try {
    cached = peekCachedHeadlines();
  } catch {
    return null;
  }
  if (!cached || cached.length === 0) return null;
  const matching = cached.filter((h) => {
    const lower = h.title.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  });
  if (matching.length === 0) return null;
  const scored = matching.map((h) => {
    const s = scoreSentiment(h.title);
    return { title: h.title, sentiment: s.sentiment as Sentiment, confidence: s.confidence };
  });
  const agg = aggregateSentiment(scored);
  return {
    headlinesCount: matching.length,
    netSentiment: agg.netScore,
    windowHoursApprox: 24, // peekCachedHeadlines doesn't filter by time; cache TTL bounds freshness
    topBullish: agg.topBullish?.title,
    topBearish: agg.topBearish?.title,
  };
}

function tryMatchedLessons(tokens: string[]): string[] {
  if (tokens.length === 0) return [];
  let store;
  try {
    store = loadACELessons();
  } catch {
    return [];
  }
  if (!store?.lessons?.length) return [];
  const matched = store.lessons
    .filter((l) => {
      const lower = (l.text ?? "").toLowerCase();
      return tokens.some((t) => lower.includes(t));
    })
    .sort((a, b) => {
      const ax = a.curatedAt ? new Date(a.curatedAt).getTime() : 0;
      const bx = b.curatedAt ? new Date(b.curatedAt).getTime() : 0;
      return bx - ax;
    })
    .slice(0, MAX_MATCHED_LESSON_IDS)
    .map((l) => l.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return matched;
}

function tryCandleSnapshotRef(
  symbol: string,
  venue: string | undefined,
  capturedAt: number,
  timeframe: string,
): SynthesisManifest["candleSnapshotRef"] {
  if (!venue) return null;
  try {
    const rows = readCandles(venue, symbol, timeframe, { asOfStoredAt: capturedAt });
    if (rows.length === 0) return null;
    return {
      venue,
      symbol,
      timeframe,
      fromTs: rows[0]!.openTime,
      toTs: rows[rows.length - 1]!.openTime,
      asOfStoredAt: capturedAt,
      barCount: rows.length,
    };
  } catch {
    return null;
  }
}

export interface BuildManifestOptions {
  observationWindowMs?: number;
  /** Venue for the candle-snapshot ref. When omitted, no ref is captured. */
  venue?: string;
  /** Timeframe to snapshot. Default '1h' — the operator can override
   *  via a future caller if the plan is built off a different timeframe. */
  candleTimeframe?: string;
}

export function buildSynthesisManifest(
  symbol: string,
  options: BuildManifestOptions = {},
): SynthesisManifest {
  const windowMs = options.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS;
  const normalized = symbol.trim().toUpperCase();
  const tokens = symbolTokens(normalized);
  const capturedAt = Date.now();
  const timeframe = options.candleTimeframe ?? "1h";
  return {
    capturedAt,
    symbol: normalized,
    regime: tryRegime(normalized),
    news: tryNews(tokens),
    observationCount: getSymbolObservationCount(normalized, windowMs),
    observationWindowMs: windowMs,
    matchedLessonIds: tryMatchedLessons(tokens),
    candleSnapshotRef: tryCandleSnapshotRef(normalized, options.venue, capturedAt, timeframe),
  };
}

/** One-line human-readable summary for journal mirroring. Empty parts
 *  collapse so a cold-cache manifest still produces a useful line. */
export function summarizeManifest(m: SynthesisManifest): string {
  const parts: string[] = [];
  if (m.regime) parts.push(`regime: ${m.regime.label} (${m.regime.confidence.toFixed(2)})`);
  if (m.news) {
    const sign = m.news.netSentiment > 0.1 ? "+" : m.news.netSentiment < -0.1 ? "" : "±";
    parts.push(`news: ${m.news.headlinesCount} hdl (${sign}${m.news.netSentiment.toFixed(2)})`);
  }
  parts.push(`obs: ${m.observationCount}`);
  if (m.matchedLessonIds.length) parts.push(`lessons: ${m.matchedLessonIds.length}`);
  if (m.candleSnapshotRef) parts.push(`candles: ${m.candleSnapshotRef.barCount}@${m.candleSnapshotRef.timeframe}`);
  return parts.join(" | ");
}

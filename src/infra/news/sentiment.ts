/**
 * Lightweight keyword-based sentiment classifier for crypto headlines.
 *
 * No LLM call — runs locally so the radar producer can score thousands
 * of headlines per hour without spend. Good enough for "should this
 * trigger a card?" decisions; the LLM can be involved later in the
 * judge phase to refine before a card actually fires.
 *
 * Trade-off: keyword scoring misses sarcasm and context. We intentionally
 * skew toward false negatives (mark as 'neutral' on borderline matches)
 * rather than false positives, since a wrong sentiment score on a card
 * is more damaging than a missed one.
 */

export type Sentiment = "bullish" | "bearish" | "neutral";

export interface SentimentScore {
  sentiment: Sentiment;
  /** Confidence in [0, 1]. Neutral always returns 0; bullish/bearish
   *  scale by hit count vs the opposing camp. */
  confidence: number;
  /** Keywords found in the title — surfaced for debug / explanation. */
  matchedKeywords: string[];
}

const BULLISH_KEYWORDS = [
  "surge", "surges", "surging", "soar", "soars", "soaring",
  "rally", "rallies", "rallying", "rallied",
  "breakout", "breakouts",
  "ath", "all-time high", "record high", "new high",
  "bullish", "bull run",
  "gain", "gains", "gaining",
  "jump", "jumps", "jumped", "jumping",
  "rise", "rises", "rising", "risen",
  "pump", "pumps", "pumping", "pumped",
  "skyrocket", "skyrockets", "skyrocketing",
  "boom", "booming",
  "partnership", "partners",
  "adoption", "mainstream",
  "upgrade", "upgrades", "upgrading", "mainnet",
  "launch", "launches", "launched", "launching",
  "approval", "approved", "approves",
  "etf approved", "etf approval",
  "milestone", "milestones",
  "outperform", "outperforms",
  "bid", "buying pressure",
  "treasury", "accumulate", "accumulating",
];

const BEARISH_KEYWORDS = [
  "crash", "crashes", "crashing", "crashed",
  "plunge", "plunges", "plunging", "plunged",
  "dump", "dumps", "dumping", "dumped",
  "tumble", "tumbles", "tumbling",
  "hack", "hacked", "hacking", "exploit", "exploited", "exploits",
  "lawsuit", "sued", "sues",
  "ban", "bans", "banned", "banning",
  "regulation", "regulatory", "regulator",
  "sec ", "sec.", "sec charges", "sec investigation",
  "fraud", "fraudulent",
  "drop", "drops", "dropped", "dropping",
  "tank", "tanks", "tanking",
  "decline", "declines", "declining",
  "bearish", "bear market",
  "fall", "falls", "fallen", "falling",
  "lose", "loses", "losing", "losses",
  "sell-off", "selloff", "sell off",
  "liquidation", "liquidations", "liquidated",
  "fail", "fails", "failed", "failing",
  "slump", "slumps", "slumping",
  "delisted", "delist", "delisting",
  "rugpull", "rug pull", "rugpulls",
  "fud",
  "investigation", "investigated", "probe", "probes",
  "halt", "halts", "halted", "halting",
  "outflow", "outflows",
  "warning", "warns",
];

/** Score one title. Lowercases once; scans both keyword sets; tallies
 *  unique hits per camp. */
export function scoreSentiment(title: string): SentimentScore {
  const lower = title.toLowerCase();
  const bullishHits = new Set<string>();
  const bearishHits = new Set<string>();

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) bullishHits.add(kw);
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) bearishHits.add(kw);
  }

  const b = bullishHits.size;
  const r = bearishHits.size;

  if (b === 0 && r === 0) {
    return { sentiment: "neutral", confidence: 0, matchedKeywords: [] };
  }
  // Mixed signal — call neutral so we don't surface a misleading card.
  if (b > 0 && r > 0 && Math.abs(b - r) <= 1) {
    return {
      sentiment: "neutral",
      confidence: 0,
      matchedKeywords: [...bullishHits, ...bearishHits],
    };
  }
  if (b > r) {
    // Confidence: at least 0.5 with one hit, scales up to 0.95.
    const conf = Math.min(0.95, 0.5 + 0.15 * (b - r));
    return { sentiment: "bullish", confidence: conf, matchedKeywords: [...bullishHits] };
  }
  const conf = Math.min(0.95, 0.5 + 0.15 * (r - b));
  return { sentiment: "bearish", confidence: conf, matchedKeywords: [...bearishHits] };
}

/** Aggregate sentiment across a batch of headlines into a single
 *  read. Used by the radar producer to decide whether to fire a card. */
export interface AggregateSentiment {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  netScore: number; // -1..+1 — positive = net bullish
  /** Highest-confidence bullish title in the batch (if any). */
  topBullish?: { title: string; confidence: number };
  /** Highest-confidence bearish title in the batch (if any). */
  topBearish?: { title: string; confidence: number };
}

export function aggregateSentiment(scored: Array<{ title: string; sentiment: Sentiment; confidence: number }>): AggregateSentiment {
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let topBullish: { title: string; confidence: number } | undefined;
  let topBearish: { title: string; confidence: number } | undefined;

  for (const h of scored) {
    if (h.sentiment === "bullish") {
      bullishCount++;
      if (!topBullish || h.confidence > topBullish.confidence) {
        topBullish = { title: h.title, confidence: h.confidence };
      }
    } else if (h.sentiment === "bearish") {
      bearishCount++;
      if (!topBearish || h.confidence > topBearish.confidence) {
        topBearish = { title: h.title, confidence: h.confidence };
      }
    } else {
      neutralCount++;
    }
  }

  const total = bullishCount + bearishCount;
  const netScore = total === 0 ? 0 : (bullishCount - bearishCount) / total;

  return { bullishCount, bearishCount, neutralCount, netScore, topBullish, topBearish };
}

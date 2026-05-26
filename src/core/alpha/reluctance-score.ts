/**
 * Reluctance score — latency between trade execution and the first
 * related journal entry, scored 0..1 (higher = more reluctant).
 *
 * The premise (TTRH, Klingson): "if I felt reluctant to log a trade,
 * that meant I shouldn't have taken it — because it didn't fit my
 * rules." Long latency to record a trade in the journal is a soft
 * signal that the operator's gut already knew the trade was off-process,
 * even before they consciously named it.
 *
 * Pure function over data the caller has already pulled — the trade's
 * execution timestamp from the trade ledger + post-trade journal
 * timestamps from TradeJournal. No I/O here, no new store.
 *
 * Important per [[journal-is-substrate]]: this function does NOT write
 * a new record anywhere. It scores existing data and returns a
 * read-only verdict for surfacing (in /exit-review, /reluctance-check,
 * or wherever the operator wants).
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type ReluctanceBucket = "fast" | "moderate" | "slow" | "very_slow" | "never";

export interface ReluctanceInput {
  /** Trade execution timestamp (ms epoch). */
  tradeExecutedAtMs: number;
  /** All journal entry timestamps (ms epoch) for the same symbol. The
   *  caller is responsible for filtering by symbol before passing them
   *  in — the function trusts the input. */
  journalEntryTimestampsMs: number[];
  /** Current time, ms epoch. Defaults to Date.now(). Override for tests
   *  + when scoring trades at a historical "now." */
  nowMs?: number;
}

export interface ReluctanceResult {
  /** Time from trade execution to the FIRST post-trade journal entry,
   *  in ms. null when the trade was never logged. */
  latencyMs: number | null;
  /** Convenience accessor in minutes — null when never logged. */
  latencyMinutes: number | null;
  /** 0..1. Fast logging = near 0, never-logged + old = near 1. */
  reluctanceScore: number;
  bucket: ReluctanceBucket;
  /** One-line summary suitable for surfacing in a skill output. */
  interpretation: string;
}

/** Reluctance buckets, in ascending latency order. The score is a
 *  piecewise linear interpolation: 0 at trade time, 1 by 24h post-trade
 *  or never-logged. */
const BUCKET_THRESHOLDS: Array<{
  bucket: ReluctanceBucket;
  upToMs: number;
  scoreAtUpper: number;
}> = [
  { bucket: "fast", upToMs: 30 * MINUTE_MS, scoreAtUpper: 0.2 },
  { bucket: "moderate", upToMs: 2 * HOUR_MS, scoreAtUpper: 0.5 },
  { bucket: "slow", upToMs: DAY_MS, scoreAtUpper: 0.8 },
  // Anything past 24h that's still being logged is "very slow."
];

function scoreFromLatency(latencyMs: number): { score: number; bucket: ReluctanceBucket } {
  if (latencyMs <= 0) return { score: 0, bucket: "fast" };
  let prevUpper = 0;
  let prevScore = 0;
  for (const t of BUCKET_THRESHOLDS) {
    if (latencyMs <= t.upToMs) {
      const span = Math.max(t.upToMs - prevUpper, 1);
      const interp = prevScore + ((latencyMs - prevUpper) / span) * (t.scoreAtUpper - prevScore);
      return { score: Math.min(1, Math.max(0, interp)), bucket: t.bucket };
    }
    prevUpper = t.upToMs;
    prevScore = t.scoreAtUpper;
  }
  // Past 24h but logged: ramp from 0.8 toward 1.0 over the next week.
  const past24h = latencyMs - DAY_MS;
  const rampSpan = 6 * DAY_MS;
  const tail = Math.min(1, past24h / rampSpan);
  return { score: Math.min(1, 0.8 + 0.2 * tail), bucket: "very_slow" };
}

export function computeReluctanceScore(input: ReluctanceInput): ReluctanceResult {
  const now = input.nowMs ?? Date.now();
  const postTradeStamps = input.journalEntryTimestampsMs
    .filter((t) => Number.isFinite(t) && t >= input.tradeExecutedAtMs);
  if (postTradeStamps.length === 0) {
    // Never logged. Score grows with how long ago the trade was — a
    // 5-minute-old unlogged trade isn't yet a reluctance signal; a
    // 3-day-old unlogged trade is.
    const ageMs = Math.max(0, now - input.tradeExecutedAtMs);
    const ageScore = scoreFromLatency(ageMs).score;
    return {
      latencyMs: null,
      latencyMinutes: null,
      reluctanceScore: Math.max(0.5, ageScore), // floor at "moderate"
      bucket: "never",
      interpretation: `No journal entry recorded post-trade. Age ${(ageMs / HOUR_MS).toFixed(1)}h — write up the trade or accept the reluctance signal.`,
    };
  }
  const firstPostTradeMs = Math.min(...postTradeStamps);
  const latencyMs = firstPostTradeMs - input.tradeExecutedAtMs;
  const { score, bucket } = scoreFromLatency(latencyMs);
  const latencyMinutes = latencyMs / MINUTE_MS;
  const human = formatLatency(latencyMs);
  const interpretation =
    bucket === "fast"
      ? `Logged in ${human} — clean post-trade workflow.`
      : bucket === "moderate"
        ? `Logged in ${human} — within normal range but watch the pattern.`
        : bucket === "slow"
          ? `Logged ${human} after trade — soft reluctance signal; check whether the trade fit your rules.`
          : `Logged ${human} after trade — strong reluctance signal; this trade likely violated your process.`;
  return {
    latencyMs,
    latencyMinutes,
    reluctanceScore: score,
    bucket,
    interpretation,
  };
}

function formatLatency(ms: number): string {
  if (ms < HOUR_MS) return `${(ms / MINUTE_MS).toFixed(0)}m`;
  if (ms < DAY_MS) return `${(ms / HOUR_MS).toFixed(1)}h`;
  return `${(ms / DAY_MS).toFixed(1)}d`;
}

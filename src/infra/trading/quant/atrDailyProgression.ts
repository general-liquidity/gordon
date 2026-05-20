/**
 * ATR Daily Progression (GORDON_ATR_PROGRESSION).
 *
 * Tracks how much of a typical day's volatility budget has already been
 * spent by the current intraday range:
 *
 *   progression = (todayHigh − todayLow) / dailyAtr
 *
 * As progression rises through 0.50 / 0.75 / 1.00 / 1.50, the marginal
 * probability of further trend continuation drops and reversal risk rises.
 * Used to gate breakout-style entries late in the session and to detect
 * "ATR exhaustion" where mean-reversion becomes the higher-probability play.
 *
 * Crypto adaptation: defaults to UTC day boundaries since crypto is 24/7
 * (no session gaps to handle). Caller can override `dayBoundaryHourUtc`.
 *
 * Pure compute. No I/O.
 */

export const ATR_PROGRESSION_FLAG_ENV = "GORDON_ATR_PROGRESSION";

export function isAtrProgressionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ATR_PROGRESSION_FLAG_ENV] === "1" || env[ATR_PROGRESSION_FLAG_ENV] === "true";
}

export interface AtrProgressionCandle {
  /** Epoch milliseconds. */
  timestamp: number;
  high: number;
  low: number;
  close: number;
}

export interface AtrProgressionInput {
  /** Intraday candles, oldest-first. Must include at least atrLookback prior days plus the current partial day. */
  candles: ReadonlyArray<AtrProgressionCandle>;
  /** Number of prior trading days used to compute the daily ATR baseline. Default 14. */
  atrLookback?: number;
  /** UTC hour at which the trading day starts. Default 0 (true UTC). */
  dayBoundaryHourUtc?: number;
}

export type AtrProgressionZone =
  | "low"        // <25%
  | "moderate"   // 25–50%
  | "active"     // 50–75%
  | "high"       // 75–90%
  | "warning"    // 90–100%
  | "exceeded"   // 100–150%
  | "extreme";   // >150%

export type AtrProgressionAction = "continue" | "caution" | "avoid";

export interface AtrProgressionResult {
  dailyAtr: number;
  todayHigh: number;
  todayLow: number;
  todayRange: number;
  progressionPct: number;
  zone: AtrProgressionZone;
  continuationProbability: number;
  reversalProbability: number;
  suggestedAction: AtrProgressionAction;
  daysObserved: number;
  reasoning: string;
}

const DEFAULT_ATR_LOOKBACK = 14;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function dayKey(timestampMs: number, boundaryHourUtc: number): number {
  const shifted = timestampMs - boundaryHourUtc * MS_PER_HOUR;
  return Math.floor(shifted / MS_PER_DAY);
}

function determineZone(pct: number): AtrProgressionZone {
  if (pct >= 150) return "extreme";
  if (pct >= 100) return "exceeded";
  if (pct >= 90) return "warning";
  if (pct >= 75) return "high";
  if (pct >= 50) return "active";
  if (pct >= 25) return "moderate";
  return "low";
}

function continuationProb(pct: number): number {
  // Monotone-decreasing step function approximating the empirical
  // observation that range-exhausted days revert more often than they
  // extend. Calibrated to the millionaire-trading-system port heuristic
  // but adjusted slightly so the curve is continuous-ish.
  if (pct >= 150) return 0.1;
  if (pct >= 100) return 0.2;
  if (pct >= 90) return 0.3;
  if (pct >= 75) return 0.4;
  if (pct >= 50) return 0.6;
  if (pct >= 25) return 0.8;
  return 0.9;
}

function suggestedAction(zone: AtrProgressionZone): AtrProgressionAction {
  if (zone === "exceeded" || zone === "extreme") return "avoid";
  if (zone === "warning") return "caution";
  return "continue";
}

export function computeAtrProgression(input: AtrProgressionInput): AtrProgressionResult {
  const lookback = input.atrLookback ?? DEFAULT_ATR_LOOKBACK;
  const boundary = input.dayBoundaryHourUtc ?? 0;
  const candles = input.candles;
  if (candles.length === 0) {
    return {
      dailyAtr: 0,
      todayHigh: 0,
      todayLow: 0,
      todayRange: 0,
      progressionPct: 0,
      zone: "low",
      continuationProbability: 0,
      reversalProbability: 0,
      suggestedAction: "avoid",
      daysObserved: 0,
      reasoning: "no candles provided",
    };
  }

  // Group candles into days by boundary-shifted UTC day index.
  const byDay = new Map<
    number,
    { high: number; low: number; close: number; lastTs: number }
  >();
  for (const c of candles) {
    const k = dayKey(c.timestamp, boundary);
    const prior = byDay.get(k);
    if (!prior) {
      byDay.set(k, { high: c.high, low: c.low, close: c.close, lastTs: c.timestamp });
    } else {
      prior.high = Math.max(prior.high, c.high);
      prior.low = Math.min(prior.low, c.low);
      if (c.timestamp >= prior.lastTs) {
        prior.close = c.close;
        prior.lastTs = c.timestamp;
      }
    }
  }

  const sortedDays = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  if (sortedDays.length < 2) {
    const onlyDay = sortedDays[0]?.[1];
    return {
      dailyAtr: 0,
      todayHigh: onlyDay?.high ?? 0,
      todayLow: onlyDay?.low ?? 0,
      todayRange: onlyDay ? onlyDay.high - onlyDay.low : 0,
      progressionPct: 0,
      zone: "low",
      continuationProbability: 0,
      reversalProbability: 0,
      suggestedAction: "avoid",
      daysObserved: sortedDays.length,
      reasoning: `need ≥2 days of data, got ${sortedDays.length}`,
    };
  }

  const todayEntry = sortedDays[sortedDays.length - 1]![1];
  const priorDays = sortedDays.slice(0, -1);

  // Compute daily TR over prior days using Wilder true range:
  //   TR = max(H − L, |H − prevClose|, |L − prevClose|)
  const trs: number[] = [];
  for (let i = 0; i < priorDays.length; i++) {
    const cur = priorDays[i]![1];
    const prevClose = i > 0 ? priorDays[i - 1]![1].close : cur.close;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    );
    trs.push(tr);
  }

  const window = trs.slice(-lookback);
  const dailyAtr = window.length > 0
    ? window.reduce((a, b) => a + b, 0) / window.length
    : 0;

  const todayHigh = todayEntry.high;
  const todayLow = todayEntry.low;
  const todayRange = todayHigh - todayLow;
  const progressionPct = dailyAtr > 0 ? (todayRange / dailyAtr) * 100 : 0;
  const zone = determineZone(progressionPct);
  const contProb = continuationProb(progressionPct);
  const revProb = 1 - contProb;
  const action = suggestedAction(zone);

  const reasoning =
    dailyAtr > 0
      ? `range=${todayRange.toFixed(4)} vs ATR(${lookback})=${dailyAtr.toFixed(4)} → ${progressionPct.toFixed(1)}% (${zone}, ${action})`
      : `daily ATR is zero — insufficient prior-day variation`;

  return {
    dailyAtr,
    todayHigh,
    todayLow,
    todayRange,
    progressionPct,
    zone,
    continuationProbability: contProb,
    reversalProbability: revProb,
    suggestedAction: action,
    daysObserved: sortedDays.length,
    reasoning,
  };
}

export function atrProgressionToPayload(result: AtrProgressionResult): Record<string, unknown> {
  return {
    kind: "atr_progression.computed",
    progressionPct: Number(result.progressionPct.toFixed(2)),
    zone: result.zone,
    suggestedAction: result.suggestedAction,
    continuationProbability: result.continuationProbability,
    daysObserved: result.daysObserved,
  };
}

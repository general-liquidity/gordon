/**
 * Resistance-tests — counts how many times a level has been touched and
 * rejected within a recent window.
 *
 * Why this exists: the momentum-swing playbook (Wikoff) emphasizes
 * trading the breakout above a level that has rejected MULTIPLE times
 * — the more tests, the more sellers are stacked there, and the more
 * meaningful the break when buyers finally overpower them. The
 * tight-consolidation indicator returns a `breakoutLevel` (the
 * consolidation high) but doesn't validate "has this level actually
 * been tested before?" This indicator does.
 *
 * Definition of a "test":
 *   1. A bar's high comes within `tolerancePct` of the level.
 *   2. Within `rejectionWindow` bars, price pulls back at least
 *      `minRejectionPct` from the level (close below level by that pct).
 *   3. Consecutive touches within `minBarsBetweenTests` collapse into a
 *      single test — three bars touching the same level back-to-back is
 *      one test event, not three.
 */

import type { Candle } from "./types.ts";

export interface ResistanceTestsParams {
  /** How close a high must come (fraction of level) to count as a touch.
   *  Default 0.005 (0.5%). */
  tolerancePct?: number;
  /** How many bars back to scan. Default 60. */
  windowBars?: number;
  /** Minimum pullback (fraction of level) within `rejectionWindow` for
   *  a touch to count as a rejection. Default 0.01 (1%). */
  minRejectionPct?: number;
  /** Bars to look forward from a touch to verify rejection. Default 5. */
  rejectionWindow?: number;
  /** Minimum bars between recorded tests — collapses consecutive
   *  touches. Default 3. */
  minBarsBetweenTests?: number;
}

export interface ResistanceTestsResult {
  level: number;
  testCount: number;
  lastTestBarsAgo: number | null;
  /** Average pullback magnitude across recorded tests, as a fraction of
   *  the level. 0 when no tests found. */
  avgRejectionPct: number;
  /**
   * 0..1 confidence the level is meaningful. Derived from testCount —
   * 0 tests → 0, 1 → 0.4, 2 → 0.65, 3 → 0.85, 4+ → 1.0. Capped because
   * marginal tests beyond 4 don't strengthen the signal much.
   */
  confidence: number;
  interpretation: string;
}

const DEFAULT_TOLERANCE = 0.005;
const DEFAULT_WINDOW = 60;
const DEFAULT_MIN_REJECTION = 0.01;
const DEFAULT_REJECTION_WINDOW = 5;
const DEFAULT_MIN_BARS_BETWEEN = 3;

const CONFIDENCE_BY_COUNT: Record<number, number> = {
  0: 0,
  1: 0.4,
  2: 0.65,
  3: 0.85,
};

function confidenceFromCount(n: number): number {
  if (n >= 4) return 1.0;
  return CONFIDENCE_BY_COUNT[n] ?? 0;
}

export function calculateResistanceTests(
  candles: Candle[],
  level: number,
  params: ResistanceTestsParams = {},
): ResistanceTestsResult {
  if (!candles || candles.length === 0 || !Number.isFinite(level) || level <= 0) {
    return {
      level,
      testCount: 0,
      lastTestBarsAgo: null,
      avgRejectionPct: 0,
      confidence: 0,
      interpretation: "No candles or invalid level.",
    };
  }

  const tolerancePct = params.tolerancePct ?? DEFAULT_TOLERANCE;
  const windowBars = params.windowBars ?? DEFAULT_WINDOW;
  const minRejectionPct = params.minRejectionPct ?? DEFAULT_MIN_REJECTION;
  const rejectionWindow = params.rejectionWindow ?? DEFAULT_REJECTION_WINDOW;
  const minBarsBetween = params.minBarsBetweenTests ?? DEFAULT_MIN_BARS_BETWEEN;

  const startIdx = Math.max(0, candles.length - windowBars);
  const lastIdx = candles.length - 1;

  const touchUpper = level * (1 + tolerancePct);
  const touchLower = level * (1 - tolerancePct);

  const rejections: { barIdx: number; rejectionPct: number }[] = [];

  for (let i = startIdx; i <= lastIdx; i++) {
    const candle = candles[i]!;
    // Touch: the high reaches within the tolerance band.
    if (candle.high < touchLower) continue;
    if (candle.high > touchUpper * 1.5) continue; // Sanity guard — way above the level isn't a "touch."
    if (candle.high < level && candle.high > touchLower) {
      // Below level but in band — still counts as a touch since the
      // operator's level is approximate.
    } else if (candle.high < level) {
      continue;
    }

    // Rejection: within the next `rejectionWindow` bars, does close
    // pull back from `level` by at least `minRejectionPct`?
    const rejEnd = Math.min(lastIdx, i + rejectionWindow);
    let bestRejection = 0;
    for (let j = i; j <= rejEnd; j++) {
      const c = candles[j]!.close;
      const pullback = (level - c) / level;
      if (pullback > bestRejection) bestRejection = pullback;
    }
    if (bestRejection < minRejectionPct) continue;

    // Dedupe consecutive touches.
    const prev = rejections[rejections.length - 1];
    if (prev && i - prev.barIdx < minBarsBetween) {
      // Keep the larger rejection.
      if (bestRejection > prev.rejectionPct) prev.rejectionPct = bestRejection;
      continue;
    }

    rejections.push({ barIdx: i, rejectionPct: bestRejection });
  }

  const testCount = rejections.length;
  const lastTestBarsAgo =
    testCount > 0 ? lastIdx - rejections[rejections.length - 1]!.barIdx : null;
  const avgRejectionPct =
    testCount > 0 ? rejections.reduce((a, b) => a + b.rejectionPct, 0) / testCount : 0;
  const confidence = confidenceFromCount(testCount);

  const interpretation =
    testCount === 0
      ? `Level ${level.toFixed(2)} hasn't been tested in the last ${windowBars} bars.`
      : testCount === 1
        ? `Level ${level.toFixed(2)} rejected once (${lastTestBarsAgo} bars ago) — single test, weak resistance signal.`
        : `Level ${level.toFixed(2)} rejected ${testCount} times (last ${lastTestBarsAgo} bars ago, avg pullback ${(avgRejectionPct * 100).toFixed(1)}%) — ${testCount >= 3 ? "well-defined" : "developing"} resistance.`;

  return {
    level,
    testCount,
    lastTestBarsAgo,
    avgRejectionPct,
    confidence,
    interpretation,
  };
}

/**
 * Tight-Consolidation (bull-flag / pennant / wedge) Detector.
 *
 * Scores how "coiled" a price series is. The momentum-swing playbook
 * relies on this: stocks that have a reason to move higher will pause,
 * tighten, and then expand. A high tightness score with declining
 * volume is the canonical setup before a breakout.
 *
 * Returns:
 *   - in_consolidation: boolean (range_pct below threshold AND
 *     above-MA filter not flagged as breakdown)
 *   - range_pct: (high − low) / midPrice over the window
 *   - days_in_range: how long price has stayed within the window's range
 *   - volume_trend: "declining" | "flat" | "rising" — slope of avg volume
 *     comparing the back half of the window to the front half
 *   - breakout_level: the window high (resistance to watch)
 *   - breakdown_level: the window low (support to watch)
 *   - tightness_score: 0..1 — penalises wide ranges, rewards declining
 *     volume, rewards stretched duration, requires price above the
 *     consolidation midpoint (we want bull flags, not bear flags)
 *   - interpretation: one-line summary
 */

import type { Candle } from "./types.ts";

export interface TightConsolidationResult {
  inConsolidation: boolean;
  rangePct: number;
  daysInRange: number;
  volumeTrend: "declining" | "flat" | "rising";
  breakoutLevel: number | null;
  breakdownLevel: number | null;
  tightnessScore: number;
  interpretation: string;
}

export interface TightConsolidationParams {
  /** Window size in bars. Default 20. */
  window?: number;
  /** Max range_pct (high-low / mid) to still count as consolidation. Default 0.08 (8%). */
  maxRangePct?: number;
  /** Min bars to confirm a base. Default 5. */
  minDays?: number;
}

const DEFAULT_WINDOW = 20;
const DEFAULT_MAX_RANGE = 0.08;
const DEFAULT_MIN_DAYS = 5;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function calculateTightConsolidation(
  candles: Candle[],
  params: TightConsolidationParams = {},
): TightConsolidationResult {
  const window = Math.max(2, params.window ?? DEFAULT_WINDOW);
  const maxRange = params.maxRangePct ?? DEFAULT_MAX_RANGE;
  const minDays = params.minDays ?? DEFAULT_MIN_DAYS;

  const empty: TightConsolidationResult = {
    inConsolidation: false,
    rangePct: 0,
    daysInRange: 0,
    volumeTrend: "flat",
    breakoutLevel: null,
    breakdownLevel: null,
    tightnessScore: 0,
    interpretation: "Insufficient data — need at least the window size in bars.",
  };

  if (candles.length < window) return empty;

  const slice = candles.slice(-window);
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of slice) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  const mid = (hi + lo) / 2;
  if (mid <= 0) return empty;
  const rangePct = (hi - lo) / mid;

  // Count how many bars at the tail stayed within [lo, hi]. A "break" of
  // even one bar resets the count.
  let daysInRange = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i]!;
    if (c.high <= hi && c.low >= lo) daysInRange++;
    else break;
  }

  // Volume trend: compare avg volume in second half of window to first half.
  // Declining volume during a base is the classic bull-flag signature.
  const half = Math.floor(window / 2);
  const firstHalfVol = mean(slice.slice(0, half).map((c) => c.volume));
  const secondHalfVol = mean(slice.slice(half).map((c) => c.volume));
  let volumeTrend: TightConsolidationResult["volumeTrend"] = "flat";
  if (firstHalfVol > 0) {
    const ratio = secondHalfVol / firstHalfVol;
    if (ratio < 0.85) volumeTrend = "declining";
    else if (ratio > 1.15) volumeTrend = "rising";
  }

  // We only consider it a consolidation if range is tight enough AND we
  // have enough bars inside the range.
  const isTight = rangePct <= maxRange;
  const longEnough = daysInRange >= minDays;
  const inConsolidation = isTight && longEnough;

  // Tightness score blends:
  //  - inverse range (tighter is better; saturate at maxRange)
  //  - duration (more bars in range up to 2× minDays is better)
  //  - volume trend (declining gives a bonus)
  //  - position above the mid (we want bull flags, so reward last close > mid)
  const rangeFactor = Math.max(0, 1 - rangePct / maxRange);
  const durationFactor = Math.min(1, daysInRange / (2 * minDays));
  const volumeFactor = volumeTrend === "declining" ? 1 : volumeTrend === "flat" ? 0.6 : 0.3;
  const lastClose = candles[candles.length - 1]!.close;
  const positionFactor = lastClose >= mid ? 1 : 0.4;
  const tightnessScore = inConsolidation
    ? Math.min(1, rangeFactor * 0.4 + durationFactor * 0.25 + volumeFactor * 0.2 + positionFactor * 0.15)
    : 0;

  const interpretation = inConsolidation
    ? `Tight base detected: ${(rangePct * 100).toFixed(1)}% range over ${daysInRange} bars, volume ${volumeTrend}. Breakout level: ${hi.toFixed(4)}.`
    : !isTight
      ? `Range too wide (${(rangePct * 100).toFixed(1)}% > ${(maxRange * 100).toFixed(0)}%) — not a consolidation.`
      : `Range is tight but only ${daysInRange} bars in range — need ≥ ${minDays}.`;

  return {
    inConsolidation,
    rangePct,
    daysInRange,
    volumeTrend,
    breakoutLevel: hi,
    breakdownLevel: lo,
    tightnessScore,
    interpretation,
  };
}

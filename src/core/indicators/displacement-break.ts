/**
 * Displacement Break of Structure
 *
 * The "displacement rule" refines a plain close-through break of structure: a
 * one-candle poke that closes just past a prior swing is a WEAK break that often
 * fails. A HIGH-PROBABILITY ("real") break requires the breaking leg to be at
 * least `minRatio` x the size of the prior swing leg — true displacement.
 *
 * Distinct from smc-patterns.ts: change-of-character there is a pure close-through
 * test (no magnitude gate), and its liquidity sweep is volatility-gated. This
 * primitive adds the leg-magnitude ratio filter neither of those applies.
 */

import type { Candle } from "./types.ts";

export interface DisplacementBreakResult {
  break: "bullish" | "bearish" | "none";
  valid: boolean;
  ratio: number | null;
  breakLeg: number | null;
  priorLeg: number | null;
  brokenLevel: number | null;
  minRatio: number;
  pivotWindow: number;
  interpretation: string;
}

interface Pivot {
  index: number;
  price: number;
  kind: "high" | "low";
}

function detectPivots(candles: Candle[], window: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = window; i < candles.length - window; i++) {
    const h = candles[i]!.high;
    const l = candles[i]!.low;
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= h) isHigh = false;
      if (candles[j]!.low <= l) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, price: h, kind: "high" });
    if (isLow) pivots.push({ index: i, price: l, kind: "low" });
  }
  return pivots;
}

export function calculateDisplacementBreak(
  candles: Candle[],
  opts?: { pivotWindow?: number; minRatio?: number },
): DisplacementBreakResult {
  const pivotWindow = opts?.pivotWindow ?? 2;
  const minRatio = opts?.minRatio ?? 1.5;

  const neutral: DisplacementBreakResult = {
    break: "none",
    valid: false,
    ratio: null,
    breakLeg: null,
    priorLeg: null,
    brokenLevel: null,
    minRatio,
    pivotWindow,
    interpretation: "Insufficient data for displacement break",
  };

  if (candles.length < pivotWindow * 2 + 3) return neutral;

  const pivots = detectPivots(candles, pivotWindow);
  if (pivots.length < 2) return neutral;

  const lastClose = candles[candles.length - 1]!.close;

  const lastPivotLow = [...pivots].reverse().find((p) => p.kind === "low") ?? null;
  const lastPivotHigh = [...pivots].reverse().find((p) => p.kind === "high") ?? null;

  let direction: "bullish" | "bearish" | "none" = "none";
  let brokenPivot: Pivot | null = null;

  // Bearish: latest close below the most recent pivot low.
  if (lastPivotLow != null && lastClose < lastPivotLow.price) {
    direction = "bearish";
    brokenPivot = lastPivotLow;
  }
  // Bullish: latest close above the most recent pivot high.
  // If both fire (rare), prefer the one with the more recent broken pivot.
  if (lastPivotHigh != null && lastClose > lastPivotHigh.price) {
    if (direction === "none" || (brokenPivot != null && lastPivotHigh.index > brokenPivot.index)) {
      direction = "bullish";
      brokenPivot = lastPivotHigh;
    }
  }

  if (direction === "none" || brokenPivot == null) {
    return {
      break: "none",
      valid: false,
      ratio: null,
      breakLeg: null,
      priorLeg: null,
      brokenLevel: null,
      minRatio,
      pivotWindow,
      interpretation:
        "No break of structure — latest close has not exceeded the most recent swing high or low.",
    };
  }

  // Prior leg: the most recent completed swing leg before the break — the
  // absolute distance between the two most recent pivots preceding the break.
  let priorLeg: number | null = null;
  if (pivots.length >= 2) {
    const a = pivots[pivots.length - 1]!;
    const b = pivots[pivots.length - 2]!;
    priorLeg = Math.abs(a.price - b.price);
  }

  // Break leg: from the broken pivot to the breaking extreme since that pivot.
  let extreme = direction === "bearish" ? Infinity : -Infinity;
  for (let i = brokenPivot.index + 1; i < candles.length; i++) {
    if (direction === "bearish") {
      const lo = candles[i]!.low;
      if (lo < extreme) extreme = lo;
    } else {
      const hi = candles[i]!.high;
      if (hi > extreme) extreme = hi;
    }
  }
  const breakLeg =
    extreme === Infinity || extreme === -Infinity ? null : Math.abs(brokenPivot.price - extreme);

  const ratio = priorLeg != null && priorLeg > 0 && breakLeg != null ? breakLeg / priorLeg : null;

  const valid = ratio != null && ratio >= minRatio;

  const round = (x: number, n: number) => parseFloat(x.toFixed(n));
  const ratioRounded = ratio == null ? null : round(ratio, 2);
  const breakLegRounded = breakLeg == null ? null : round(breakLeg, 8);
  const priorLegRounded = priorLeg == null ? null : round(priorLeg, 8);

  let interpretation: string;
  const dirWord = direction === "bearish" ? "bearish" : "bullish";
  if (valid) {
    interpretation =
      `Valid ${dirWord} displacement break: the breaking leg is ${ratioRounded}x the prior swing ` +
      `(>= ${minRatio}x), indicating a real, high-probability break of structure driven by displacement.`;
  } else if (ratio != null) {
    interpretation =
      `Weak ${dirWord} break: close pierced the swing level but the breaking leg is only ${ratioRounded}x ` +
      `the prior swing (< ${minRatio}x) — likely a one-candle poke that often fails, not true displacement.`;
  } else {
    interpretation = `${dirWord} break detected but displacement ratio is undefined (prior swing leg has zero size).`;
  }

  return {
    break: direction,
    valid,
    ratio: ratioRounded,
    breakLeg: breakLegRounded,
    priorLeg: priorLegRounded,
    brokenLevel: round(brokenPivot.price, 8),
    minRatio,
    pivotWindow,
    interpretation,
  };
}

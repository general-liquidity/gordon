/**
 * Structure-Break Conviction — the "two-breaker-structure" / MSS-trap filter.
 *
 * A single market-structure-shift (breaking the LAST swing level) is frequently
 * a trap: price merely retraces to a nearer key level and then continues the
 * prevailing trend. Conviction comes from breaking through TWO (or more)
 * *significant* structure-making swing levels in a row.
 *
 * For a bearish reversal of an up-move, the significant levels are the prevailing
 * uptrend's HIGHER LOWS (each pivot low above the previous one). Closing below
 * just the most recent (highest) higher-low = a single break = TRAP. Closing
 * below two of them = a confirmed, high-conviction bearish break. Bullish mirror
 * uses the downtrend's LOWER HIGHS.
 *
 * Distinct from displacement-break.ts (single break gated on leg MAGNITUDE) and
 * smc-patterns.ts change-of-character (single close-through, no count). This
 * primitive gates on the COUNT of significant levels taken out.
 */

import type { Candle } from "./types.ts";

export interface StructureBreakConvictionResult {
  break: "bullish" | "bearish" | "none";
  conviction: "high" | "trap" | "none";
  valid: boolean;
  levelsBroken: number;
  brokenLevels: number[];
  minLevels: number;
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

const round = (x: number, n: number) => parseFloat(x.toFixed(n));

export function calculateStructureBreakConviction(
  candles: Candle[],
  opts?: { pivotWindow?: number; minLevels?: number }
): StructureBreakConvictionResult {
  const pivotWindow = opts?.pivotWindow ?? 2;
  const minLevels = opts?.minLevels ?? 2;

  const neutral: StructureBreakConvictionResult = {
    break: "none",
    conviction: "none",
    valid: false,
    levelsBroken: 0,
    brokenLevels: [],
    minLevels,
    pivotWindow,
    interpretation: "Insufficient data for structure-break conviction",
  };

  if (candles.length < pivotWindow * 2 + 3) return neutral;

  const pivots = detectPivots(candles, pivotWindow);
  const pivotLows = pivots.filter((p) => p.kind === "low");
  const pivotHighs = pivots.filter((p) => p.kind === "high");
  if (pivotLows.length === 0 && pivotHighs.length === 0) return neutral;

  const lastClose = candles[candles.length - 1]!.close;

  // The prevailing uptrend's run of ascending HIGHER LOWS (most recent backward,
  // while each newer low sits above the next-older one).
  const higherLowRun: Pivot[] = [];
  for (let k = pivotLows.length - 1; k >= 0; k--) {
    const p = pivotLows[k]!;
    if (higherLowRun.length === 0) {
      higherLowRun.unshift(p);
    } else if (higherLowRun[0]!.price > p.price) {
      higherLowRun.unshift(p);
    } else {
      break;
    }
  }

  // The prevailing downtrend's run of descending LOWER HIGHS.
  const lowerHighRun: Pivot[] = [];
  for (let k = pivotHighs.length - 1; k >= 0; k--) {
    const p = pivotHighs[k]!;
    if (lowerHighRun.length === 0) {
      lowerHighRun.unshift(p);
    } else if (lowerHighRun[0]!.price < p.price) {
      lowerHighRun.unshift(p);
    } else {
      break;
    }
  }

  // Bearish: count higher-lows the close has dropped below, newest first.
  const bearBroken: number[] = [];
  for (let k = higherLowRun.length - 1; k >= 0; k--) {
    if (higherLowRun[k]!.price > lastClose) bearBroken.push(round(higherLowRun[k]!.price, 8));
    else break;
  }

  // Bullish: count lower-highs the close has risen above, newest first.
  const bullBroken: number[] = [];
  for (let k = lowerHighRun.length - 1; k >= 0; k--) {
    if (lowerHighRun[k]!.price < lastClose) bullBroken.push(round(lowerHighRun[k]!.price, 8));
    else break;
  }

  let direction: "bullish" | "bearish" | "none" = "none";
  let brokenLevels: number[] = [];
  if (bearBroken.length === 0 && bullBroken.length === 0) {
    return {
      break: "none",
      conviction: "none",
      valid: false,
      levelsBroken: 0,
      brokenLevels: [],
      minLevels,
      pivotWindow,
      interpretation:
        "No structure break — close has not taken out any significant swing level.",
    };
  }
  if (bearBroken.length >= bullBroken.length) {
    direction = "bearish";
    brokenLevels = bearBroken;
  } else {
    direction = "bullish";
    brokenLevels = bullBroken;
  }

  const levelsBroken = brokenLevels.length;
  const valid = levelsBroken >= minLevels;
  const conviction: "high" | "trap" | "none" = valid ? "high" : "trap";

  const dirWord = direction === "bearish" ? "bearish" : "bullish";
  const levelType = direction === "bearish" ? "higher-lows" : "lower-highs";
  let interpretation: string;
  if (valid) {
    interpretation =
      `High-conviction ${dirWord} structure break: close has taken out ${levelsBroken} significant ${levelType} ` +
      `(>= ${minLevels}), a genuine market-structure shift rather than a single-level fakeout.`;
  } else {
    interpretation =
      `Single-level ${dirWord} break (the "MSS trap"): close pierced only the most recent ${levelType.slice(0, -1)} ` +
      `(${levelsBroken} of the required ${minLevels}). Often just a retracement to a nearer key level before the ` +
      `prevailing trend continues — low conviction for a reversal.`;
  }

  return {
    break: direction,
    conviction,
    valid,
    levelsBroken,
    brokenLevels,
    minLevels,
    pivotWindow,
    interpretation,
  };
}

/**
 * Market Profile single prints, tails, and poor highs/lows.
 *
 * Steidlmayer TPO structure that `marketProfile.ts` doesn't surface — it stops
 * at POC / value-area / day-type. This reads the same TPO histogram and extracts
 * the *structural* features traders act on:
 *
 *   - Single print: a price level the auction touched in only ONE time-bracket
 *     (TPO count == 1) with multi-TPO prices both ABOVE and BELOW it — a vertical
 *     move through "unfair" prices. Per the canonical definition (mypivots),
 *     single-TPO levels at the profile EXTREMES are NOT single prints — they are
 *     tails (below). `totalSinglePrints` therefore counts mid-range levels only.
 *     Single prints tend to get revisited ("filled") on a later rotation, so the
 *     mid-range zones act as magnet targets.
 *   - Buying / selling tail: a contiguous run of single-TPO levels at the LOW /
 *     HIGH extreme — responsive rejection of price away from the extreme (a
 *     "finished" auction). The longer the tail, the stronger the rejection.
 *   - Poor high / poor low: the extreme bin touched by 2+ TPOs (no tail) —
 *     "unfinished" business at the extreme, prone to being exceeded/revisited.
 *
 * Pure; delegates the TPO build to computeMarketProfile and never throws.
 */

import { computeMarketProfile, type MarketProfileInput } from "./marketProfile.ts";

export interface SinglePrintsInput extends MarketProfileInput {
  /** TPO count at an extreme bin to call the high/low "poor" (unfinished). Default 2. */
  poorThreshold?: number;
}

export type SinglePrintLocation = "buying_tail" | "selling_tail" | "mid_range";

export interface SinglePrintZone {
  priceLow: number;
  priceHigh: number;
  midpoint: number;
  /** Number of contiguous single-print levels in this run. */
  length: number;
  location: SinglePrintLocation;
}

export interface SinglePrintsResult {
  zones: SinglePrintZone[];
  /** Consecutive single prints up from the low (0 = no buying tail). */
  buyingTailLength: number;
  /** Consecutive single prints down from the high (0 = no selling tail). */
  sellingTailLength: number;
  /** High touched by ≥ poorThreshold TPOs — unfinished, prone to revisit. */
  poorHigh: boolean;
  poorLow: boolean;
  /** Midpoints of mid-range single-print zones — fast-move gaps that tend to fill. */
  midRangeTargets: number[];
  pointOfControl: number | null;
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
  /** Count of TRUE (mid-range) single-print levels — excludes tail levels. */
  totalSinglePrints: number;
  interpretation: string;
}

const round = (x: number): number => parseFloat(x.toFixed(6));

export function computeSinglePrints(input: SinglePrintsInput): SinglePrintsResult {
  const poorThreshold = Math.max(2, Math.floor(input.poorThreshold ?? 2));
  const mp = computeMarketProfile(input);

  const base: Omit<SinglePrintsResult, "interpretation"> = {
    zones: [],
    buyingTailLength: 0,
    sellingTailLength: 0,
    poorHigh: false,
    poorLow: false,
    midRangeTargets: [],
    pointOfControl: mp.pointOfControl,
    valueAreaHigh: mp.valueAreaHigh,
    valueAreaLow: mp.valueAreaLow,
    totalSinglePrints: 0,
  };

  const sortedPrices = Array.from(mp.tpoCountsByPrice.keys()).sort((a, b) => a - b);
  const n = sortedPrices.length;
  if (n < 2) {
    return { ...base, interpretation: "no single-print structure (insufficient profile)" };
  }
  const countsArr = sortedPrices.map((p) => mp.tpoCountsByPrice.get(p)!);

  // Contiguous runs of count === 1.
  const zones: SinglePrintZone[] = [];
  const midRangeTargets: number[] = [];
  let totalSinglePrints = 0;
  let i = 0;
  while (i < n) {
    if (countsArr[i] !== 1) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < n && countsArr[j + 1] === 1) j += 1;
    const priceLow = sortedPrices[i]!;
    const priceHigh = sortedPrices[j]!;
    const length = j - i + 1;
    const location: SinglePrintLocation =
      i === 0 ? "buying_tail" : j === n - 1 ? "selling_tail" : "mid_range";
    const midpoint = round((priceLow + priceHigh) / 2);
    zones.push({
      priceLow: round(priceLow),
      priceHigh: round(priceHigh),
      midpoint,
      length,
      location,
    });
    // Per the canonical definition, only mid-range runs are "single prints";
    // extreme runs are tails (captured by buying/sellingTailLength).
    if (location === "mid_range") {
      midRangeTargets.push(midpoint);
      totalSinglePrints += length;
    }
    i = j + 1;
  }

  // Tail lengths read directly from the extremes (robust to a single run that
  // spans the whole range on a pure trend day).
  let buyingTailLength = 0;
  while (buyingTailLength < n && countsArr[buyingTailLength] === 1) buyingTailLength += 1;
  let sellingTailLength = 0;
  while (sellingTailLength < n && countsArr[n - 1 - sellingTailLength] === 1)
    sellingTailLength += 1;

  const poorLow = countsArr[0]! >= poorThreshold;
  const poorHigh = countsArr[n - 1]! >= poorThreshold;

  const parts: string[] = [];
  if (buyingTailLength > 0)
    parts.push(`buying tail ${buyingTailLength} print(s) at ${round(sortedPrices[0]!)}`);
  if (sellingTailLength > 0)
    parts.push(`selling tail ${sellingTailLength} print(s) at ${round(sortedPrices[n - 1]!)}`);
  if (poorLow) parts.push(`poor low (unfinished, ${countsArr[0]} TPOs at the extreme)`);
  if (poorHigh) parts.push(`poor high (unfinished, ${countsArr[n - 1]} TPOs at the extreme)`);
  if (midRangeTargets.length > 0) {
    parts.push(
      `${midRangeTargets.length} mid-range single-print zone(s) as fill target(s): ${midRangeTargets.join(", ")}`,
    );
  }
  const interpretation = parts.length > 0 ? parts.join("; ") : "no notable single-print structure";

  return {
    ...base,
    zones,
    buyingTailLength,
    sellingTailLength,
    poorHigh,
    poorLow,
    midRangeTargets,
    totalSinglePrints,
    interpretation,
  };
}

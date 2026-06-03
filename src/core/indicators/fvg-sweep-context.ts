/**
 * Fair-Value-Gap Sweep Context — grades each FVG by its relationship to a
 * liquidity sweep, the single biggest filter separating high-probability gaps
 * from gaps "created to fail."
 *
 * The rule (from the 6-FVG-secrets framing): a FVG that forms AFTER a liquidity
 * sweep — i.e. the displacement that opened the gap came straight out of taking
 * a prior swing low (bullish) / high (bearish) — is high-probability and mostly
 * respected ("post_sweep"). A FVG that forms with NO preceding sweep is just an
 * impulse in open space, mostly disrespected and prone to inversion ("pre_sweep").
 *
 * Distinct from fvg.ts, which only detects 3-candle gaps + midpoint-fill state
 * with no sweep context, and from detectLiquiditySweeps, which flags sweeps but
 * never links them to a gap. This primitive joins the two.
 */

import type { Candle } from "./types.ts";

export type FvgQuality = "post_sweep" | "pre_sweep";

export interface ClassifiedFvg {
  direction: "bullish" | "bearish";
  top: number;
  bottom: number;
  midpoint: number;
  startBar: number;
  quality: FvgQuality;
  /** The prior swing level that was swept (null for pre_sweep gaps). */
  sweptLevel: number | null;
}

export interface FvgSweepContextResult {
  bullish: ClassifiedFvg[];
  bearish: ClassifiedFvg[];
  nearestBullish: ClassifiedFvg | null;
  nearestBearish: ClassifiedFvg | null;
  count: number;
  pivotWindow: number;
  lookback: number;
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

export function calculateFvgSweepContext(
  candles: Candle[],
  opts?: { pivotWindow?: number; lookback?: number }
): FvgSweepContextResult {
  const pivotWindow = opts?.pivotWindow ?? 2;
  const lookback = opts?.lookback ?? 10;

  const neutral: FvgSweepContextResult = {
    bullish: [],
    bearish: [],
    nearestBullish: null,
    nearestBearish: null,
    count: 0,
    pivotWindow,
    lookback,
    interpretation: "Insufficient data for FVG sweep-context classification",
  };

  if (candles.length < 4) return neutral;

  const pivots = detectPivots(candles, pivotWindow);
  const pivotLows = pivots.filter((p) => p.kind === "low");
  const pivotHighs = pivots.filter((p) => p.kind === "high");

  const lastClose = candles[candles.length - 1]!.close;

  const bullish: ClassifiedFvg[] = [];
  const bearish: ClassifiedFvg[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const a = candles[i - 1]!;
    const c = candles[i + 1]!;
    const start = i - 1;
    const windowStart = Math.max(0, start - lookback);

    // Bullish FVG: gap between candle (i-1) high and candle (i+1) low.
    if (c.low > a.high) {
      const top = c.low;
      const bottom = a.high;
      const mid = (top + bottom) / 2;
      // Filled if a later candle traded back through the midpoint.
      let filled = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k]!.low <= mid) {
          filled = true;
          break;
        }
      }
      if (filled) continue;

      // post_sweep if a prior pivot low (within the lookback) was breached by a
      // candle between it and the gap impulse — i.e. sell-side liquidity was
      // taken right before the up-displacement.
      let sweptLevel: number | null = null;
      for (const p of pivotLows) {
        if (p.index < windowStart || p.index > start) continue;
        for (let k = p.index + 1; k <= i + 1; k++) {
          if (candles[k]!.low < p.price) {
            sweptLevel = p.price;
            break;
          }
        }
        if (sweptLevel != null) break;
      }
      bullish.push({
        direction: "bullish",
        top: round(top, 8),
        bottom: round(bottom, 8),
        midpoint: round(mid, 8),
        startBar: start,
        quality: sweptLevel != null ? "post_sweep" : "pre_sweep",
        sweptLevel: sweptLevel == null ? null : round(sweptLevel, 8),
      });
    }

    // Bearish FVG: gap between candle (i-1) low and candle (i+1) high.
    if (c.high < a.low) {
      const top = a.low;
      const bottom = c.high;
      const mid = (top + bottom) / 2;
      let filled = false;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k]!.high >= mid) {
          filled = true;
          break;
        }
      }
      if (filled) continue;

      let sweptLevel: number | null = null;
      for (const p of pivotHighs) {
        if (p.index < windowStart || p.index > start) continue;
        for (let k = p.index + 1; k <= i + 1; k++) {
          if (candles[k]!.high > p.price) {
            sweptLevel = p.price;
            break;
          }
        }
        if (sweptLevel != null) break;
      }
      bearish.push({
        direction: "bearish",
        top: round(top, 8),
        bottom: round(bottom, 8),
        midpoint: round(mid, 8),
        startBar: start,
        quality: sweptLevel != null ? "post_sweep" : "pre_sweep",
        sweptLevel: sweptLevel == null ? null : round(sweptLevel, 8),
      });
    }
  }

  // Nearest unfilled gap to current price in each direction.
  const nearestBullish =
    bullish
      .filter((g) => g.top <= lastClose)
      .sort((x, y) => lastClose - x.top - (lastClose - y.top))[0] ??
    bullish[bullish.length - 1] ??
    null;
  const nearestBearish =
    bearish
      .filter((g) => g.bottom >= lastClose)
      .sort((x, y) => x.bottom - lastClose - (y.bottom - lastClose))[0] ??
    bearish[bearish.length - 1] ??
    null;

  const total = bullish.length + bearish.length;
  let interpretation: string;
  if (total === 0) {
    interpretation = "No active (unfilled) fair-value gaps detected.";
  } else {
    const postCount =
      bullish.filter((g) => g.quality === "post_sweep").length +
      bearish.filter((g) => g.quality === "post_sweep").length;
    interpretation =
      `${total} active FVG(s): ${postCount} post_sweep (high-probability — formed straight out of a ` +
      `liquidity sweep, mostly respected) and ${total - postCount} pre_sweep (lower-probability — ` +
      `formed in open space with no preceding sweep, prone to being disrespected/inverted).`;
  }

  return {
    bullish,
    bearish,
    nearestBullish,
    nearestBearish,
    count: total,
    pivotWindow,
    lookback,
    interpretation,
  };
}

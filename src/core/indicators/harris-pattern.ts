/**
 * Michael Harris "DAX" 4-bar overlapping-extension price pattern.
 *
 * Port of `total_signal_vectorized` from master-algorithmic-trading-main
 * (01_MichaelHarris_DAXPattern.ipynb). A pure price-action pattern over 4
 * consecutive candles (i-3..i): a strict, interleaved high/low chain that
 * encodes a tightly-stacked sequence of overlapping bars resolving in one
 * direction.
 *
 * BUY (signal = 2): a strictly descending chain interleaving the latest bar's
 *   high/low with the prior three bars' extremes:
 *     high[i]   > high[i-1] > low[i]    > high[i-2]
 *             > low[i-1]  > high[i-3] > low[i-2] > low[i-3]
 *
 * SELL (signal = 1): the exact mirror (strictly ascending):
 *     low[i]    < low[i-1]  < high[i]   < low[i-2]
 *             < high[i-1] < low[i-3]  < high[i-2] < high[i-3]
 *
 * Distinct from existing detectors:
 *   - `candlestick-patterns.ts` — single/triple CANDLE shapes (body/shadow
 *     geometry). Harris is a pure high/low ordering chain, no body logic.
 *   - `lmw-patterns.ts` / `three-mountains-rivers.ts` — multi-week smoothed
 *     extrema grammars. Harris is a fixed 4-bar raw-price window.
 *
 * Pure function. First 3 bars are always 0 (insufficient history).
 */

import type { Candle } from "./types.ts";

export interface HarrisPatternResult {
  /** Per-bar signal aligned to input candles: 0 none / 2 buy / 1 sell. */
  signals: (0 | 1 | 2)[];
  /** Signal on the latest bar. */
  current: 0 | 1 | 2;
  buyCount: number;
  sellCount: number;
  interpretation: string;
}

/**
 * Detect the Harris DAX 4-bar pattern over a candle series.
 */
export function calculateHarrisPattern(candles: Candle[]): HarrisPatternResult {
  const n = candles.length;
  const signals: (0 | 1 | 2)[] = new Array(n).fill(0);

  if (n < 4) {
    return {
      signals,
      current: 0,
      buyCount: 0,
      sellCount: 0,
      interpretation: "Insufficient data for Harris pattern (need ≥4 candles).",
    };
  }

  let buyCount = 0;
  let sellCount = 0;

  for (let i = 3; i < n; i++) {
    const c0 = candles[i]!;
    const c1 = candles[i - 1]!;
    const c2 = candles[i - 2]!;
    const c3 = candles[i - 3]!;

    const buy =
      c0.high > c1.high &&
      c1.high > c0.low &&
      c0.low > c2.high &&
      c2.high > c1.low &&
      c1.low > c3.high &&
      c3.high > c2.low &&
      c2.low > c3.low;

    if (buy) {
      signals[i] = 2;
      buyCount++;
      continue;
    }

    const sell =
      c0.low < c1.low &&
      c1.low < c0.high &&
      c0.high < c2.low &&
      c2.low < c1.high &&
      c1.high < c3.low &&
      c3.low < c2.high &&
      c2.high < c3.high;

    if (sell) {
      signals[i] = 1;
      sellCount++;
    }
  }

  const current = signals[n - 1]!;
  const currentLabel =
    current === 2
      ? "BUY signal on latest bar"
      : current === 1
        ? "SELL signal on latest bar"
        : "no signal on latest bar";

  const interpretation = `Harris DAX 4-bar pattern over ${n} bars: ${buyCount} buy, ${sellCount} sell (${currentLabel}).`;

  return { signals, current, buyCount, sellCount, interpretation };
}

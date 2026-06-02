/**
 * Stochastic Oscillator (%K/%D) — classic price-based
 *
 * Distinct from Stochastic RSI (stochastic-rsi.ts), which applies the stochastic
 * formula to RSI values. This is the raw price version: it locates the close
 * within the recent high-low range.
 *
 * Formula:
 *   raw %K = 100 * (close - lowestLow(kPeriod)) / (highestHigh(kPeriod) - lowestLow(kPeriod))
 *   %K     = SMA(raw %K, kSmooth)   (slow %K)
 *   %D     = SMA(%K, dPeriod)       (signal)
 *
 * Defaults: kPeriod=14, kSmooth=3, dPeriod=3 (fast_k=14, slow_k=3, slow_d=3).
 * Flat-range bar (highestHigh == lowestLow) → null (avoids div0).
 * Signals: %K > 80 overbought / %K < 20 oversold / else neutral.
 */

import type { Candle } from "./types.ts";

export interface StochasticResult {
  k: (number | null)[];
  d: (number | null)[];
  current: { k: number | null; d: number | null };
  signal: "overbought" | "oversold" | "neutral";
  interpretation: string;
}

function round(x: number, n: number): number {
  return parseFloat(x.toFixed(n));
}

/**
 * Simple moving average over a series that may contain nulls.
 * Emits a value only when the full window is non-null; otherwise null.
 */
function smaNullable(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      if (v == null) {
        ok = false;
        break;
      }
      sum += v;
    }
    out.push(ok ? sum / period : null);
  }
  return out;
}

export function calculateStochastic(
  candles: Candle[],
  params?: { kPeriod?: number; kSmooth?: number; dPeriod?: number },
): StochasticResult {
  const kPeriod = params?.kPeriod ?? 14;
  const kSmooth = params?.kSmooth ?? 3;
  const dPeriod = params?.dPeriod ?? 3;

  const n = candles.length;
  const minRequired = kPeriod + kSmooth + dPeriod - 2;

  if (n < minRequired) {
    return {
      k: candles.map(() => null),
      d: candles.map(() => null),
      current: { k: null, d: null },
      signal: "neutral",
      interpretation: `Insufficient data for Stochastic (need ${minRequired} bars, have ${n})`,
    };
  }

  // Step 1: raw %K
  const rawK: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (i < kPeriod - 1) {
      rawK.push(null);
      continue;
    }
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const c = candles[j]!;
      if (c.high > highestHigh) highestHigh = c.high;
      if (c.low < lowestLow) lowestLow = c.low;
    }
    const range = highestHigh - lowestLow;
    if (range === 0) {
      rawK.push(null); // flat-range bar → undefined position
      continue;
    }
    const close = candles[i]!.close;
    rawK.push((100 * (close - lowestLow)) / range);
  }

  // Step 2: smoothed %K = SMA(raw %K, kSmooth)
  const kRaw = smaNullable(rawK, kSmooth);

  // Step 3: %D = SMA(%K, dPeriod)
  const dRaw = smaNullable(kRaw, dPeriod);

  // Round non-null outputs
  const k = kRaw.map((v) => (v == null ? null : round(v, 2)));
  const d = dRaw.map((v) => (v == null ? null : round(v, 2)));

  const currentK = k[k.length - 1] ?? null;
  const currentD = d[d.length - 1] ?? null;

  let signal: "overbought" | "oversold" | "neutral" = "neutral";
  if (currentK !== null) {
    if (currentK > 80) signal = "overbought";
    else if (currentK < 20) signal = "oversold";
  }

  let interpretation: string;
  if (currentK === null) {
    interpretation = "Insufficient data for Stochastic";
  } else {
    const kStr = currentK.toFixed(1);
    const dStr = currentD === null ? "N/A" : currentD.toFixed(1);
    if (signal === "overbought") {
      interpretation = `Stochastic overbought (%K: ${kStr}, %D: ${dStr}) - close near top of ${kPeriod}-bar range`;
    } else if (signal === "oversold") {
      interpretation = `Stochastic oversold (%K: ${kStr}, %D: ${dStr}) - close near bottom of ${kPeriod}-bar range`;
    } else {
      interpretation = `Stochastic neutral (%K: ${kStr}, %D: ${dStr})`;
    }
  }

  return {
    k,
    d,
    current: { k: currentK, d: currentD },
    signal,
    interpretation,
  };
}

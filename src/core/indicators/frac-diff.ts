/**
 * Fractional Differentiation (López de Prado, fixed-width window method)
 *
 * Makes a price series stationary while preserving maximum memory. Weights come
 * from the binomial recursion w_0 = 1; w_k = −w_{k-1}·(d − k + 1)/k, truncated
 * once |w_k| < threshold. d ∈ (0,1] is typical (d=1 → ordinary differencing;
 * d=0 → identity).
 */

import type { Candle } from "./types.ts";

export interface FracDiffResult {
  values: (number | null)[];
  current: number | null;
  d: number;
  windowSize: number;
  weightsUsed: number;
  interpretation: string;
}

function fracDiffWeights(d: number, threshold: number): number[] {
  const weights: number[] = [1];
  let k = 1;
  while (true) {
    const next = -weights[k - 1]! * ((d - k + 1) / k);
    if (Math.abs(next) < threshold) break;
    weights.push(next);
    k++;
  }
  return weights;
}

export function calculateFracDiff(
  candles: Candle[],
  opts: { d?: number; threshold?: number } = {},
): FracDiffResult {
  const d = opts.d ?? 0.5;
  const threshold = opts.threshold ?? 1e-5;

  if (candles.length < 2) {
    return {
      values: [],
      current: null,
      d,
      windowSize: 0,
      weightsUsed: 0,
      interpretation: "Insufficient data for fractional differentiation (need >= 2 candles).",
    };
  }

  const closes = candles.map((c) => c.close);
  const weights = fracDiffWeights(d, threshold);
  const K = weights.length - 1;

  const values: (number | null)[] = new Array(closes.length).fill(null);
  for (let t = K; t < closes.length; t++) {
    let acc = 0;
    for (let kk = 0; kk <= K; kk++) {
      acc += weights[kk]! * closes[t - kk]!;
    }
    values[t] = acc;
  }

  const lastRaw = values[values.length - 1];
  const current = lastRaw == null ? null : Number(lastRaw.toFixed(8));

  let interpretation: string;
  if (d === 0) {
    interpretation = `d=0 returns the identity series (window ${weights.length}); no differencing applied.`;
  } else if (d >= 1) {
    interpretation = `d=${d} is at/above full differencing; series is stationary but memory is largely removed.`;
  } else {
    interpretation = `d=${d} fractionally differences the series over a ${weights.length}-point window, balancing stationarity against retained memory.`;
  }

  return {
    values,
    current,
    d,
    windowSize: weights.length,
    weightsUsed: weights.length,
    interpretation,
  };
}

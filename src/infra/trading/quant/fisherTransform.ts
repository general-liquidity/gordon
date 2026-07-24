/**
 * Fisher / Inverse Fisher Transform (GORDON_FISHER_TRANSFORM).
 *
 * From TSaM Ch 11 (Ehlers's contribution). The Fisher Transform maps
 * a roughly sine-like price distribution onto an approximately Gaussian
 * one, sharpening turning points compared with RSI or stochastic. Useful
 * for identifying overbought/oversold extremes where prices are about
 * to reverse rather than continue.
 *
 *   X[t] = 0.5 · (2 · ((P[t] - MinL) / (MaxH - MinL) - 0.5)) + 0.5 · X[t-1]
 *   Y[t] = 0.5 · ln((1 + X[t]) / (1 - X[t]))
 *
 * Where MinL/MaxH are the lowest low and highest high over a lookback.
 * X is clamped to (-0.999, 0.999) to avoid ln-of-zero blowup.
 *
 * The Inverse Fisher Transform is also exposed — applied to a normalized
 * RSI it produces a bipolar [-1, +1] oscillator that snaps to extremes,
 * useful as a discrete entry/exit trigger.
 */

export interface FisherInput {
  prices: ReadonlyArray<number>;
  /** Lookback for the high/low channel. Default 10. */
  period?: number;
}

export interface FisherResult {
  /** Fisher Transform series, aligned with prices (NaN during warmup). */
  fisher: number[];
  /** Trigger line (Fisher lagged by one). */
  trigger: number[];
  currentFisher: number;
  currentTrigger: number;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_PERIOD = 10;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function computeFisherTransform(input: FisherInput): FisherResult {
  const period = input.period ?? DEFAULT_PERIOD;
  const prices = input.prices;
  const n = prices.length;
  const fisher: number[] = new Array(n).fill(Number.NaN);
  const trigger: number[] = new Array(n).fill(Number.NaN);

  if (n < period) {
    return {
      fisher,
      trigger,
      currentFisher: Number.NaN,
      currentTrigger: Number.NaN,
      sampleSize: n,
      reasoning: `need at least ${period} prices, got ${n}`,
    };
  }

  let x = 0;
  for (let i = period - 1; i < n; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (prices[j]! < lo) lo = prices[j]!;
      if (prices[j]! > hi) hi = prices[j]!;
    }
    const range = hi - lo;
    const norm = range > 0 ? (prices[i]! - lo) / range - 0.5 : 0;
    x = clamp(0.5 * 2 * norm + 0.5 * x, -0.999, 0.999);
    fisher[i] = 0.5 * Math.log((1 + x) / (1 - x));
    if (i > period - 1) trigger[i] = fisher[i - 1]!;
  }

  const currentFisher = fisher[n - 1]!;
  const currentTrigger = trigger[n - 1]!;
  return {
    fisher,
    trigger,
    currentFisher,
    currentTrigger,
    sampleSize: n,
    reasoning: `Fisher ${Number.isFinite(currentFisher) ? currentFisher.toFixed(4) : "n/a"}, trigger ${Number.isFinite(currentTrigger) ? currentTrigger.toFixed(4) : "n/a"}`,
  };
}

export interface InverseFisherInput {
  /** Series to transform — typically a normalized RSI or any [-1,1] series. */
  values: ReadonlyArray<number>;
  /** Optional smoothing weight passed through the inverse function. Default 0.1. */
  scale?: number;
}

export interface InverseFisherResult {
  /** Bipolar [-1, +1] series. */
  inverse: number[];
  currentValue: number;
  sampleSize: number;
}

const DEFAULT_INV_SCALE = 0.1;

export function computeInverseFisher(input: InverseFisherInput): InverseFisherResult {
  const scale = input.scale ?? DEFAULT_INV_SCALE;
  const out: number[] = [];
  for (const v of input.values) {
    const y = scale * v;
    const e = Math.exp(2 * y);
    out.push((e - 1) / (e + 1));
  }
  return {
    inverse: out,
    currentValue: out.length > 0 ? out[out.length - 1]! : Number.NaN,
    sampleSize: input.values.length,
  };
}

export function fisherToPayload(result: FisherResult): Record<string, unknown> {
  return {
    kind: "fisher_transform.computed",
    currentFisher: Number.isFinite(result.currentFisher)
      ? Number(result.currentFisher.toFixed(5))
      : null,
    currentTrigger: Number.isFinite(result.currentTrigger)
      ? Number(result.currentTrigger.toFixed(5))
      : null,
    sampleSize: result.sampleSize,
  };
}

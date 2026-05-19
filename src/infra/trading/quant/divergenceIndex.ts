/**
 * Divergence Index — Appel (GORDON_DIVERGENCE_INDEX).
 *
 * From TSaM Ch 9. Volatility-adjusted MACD-like indicator with stdev-
 * scaled bands. The numerator is the difference between fast and slow
 * SMAs; the denominator is the variance of price changes over the slow
 * period, so the index self-normalizes across volatility regimes:
 *
 *   DI[t] = (fastMA[t] - slowMA[t]) / Var(Δp, slowPeriod)
 *   band[t] = stdev(DI, slowPeriod) · factor
 *
 *   Buy:    DI < -band AND price trend is up
 *   Sell:   DI > +band AND price trend is down
 *   Exit:   DI crosses zero
 *
 * Bands move with volatility (wider when DI itself is volatile),
 * keeping the false-signal rate roughly constant across regimes.
 */

export const DIVERGENCE_INDEX_FLAG_ENV = "GORDON_DIVERGENCE_INDEX";

export function isDivergenceIndexEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DIVERGENCE_INDEX_FLAG_ENV] === "1" || env[DIVERGENCE_INDEX_FLAG_ENV] === "true";
}

export interface DivergenceIndexInput {
  prices: ReadonlyArray<number>;
  fastPeriod?: number;
  slowPeriod?: number;
  /** Stdev multiplier for the entry bands. Default 1.0. */
  bandFactor?: number;
}

export type DivergenceSignal = "buy" | "sell" | "exit" | "none";

export interface DivergenceIndexResult {
  divergenceIndex: number[];
  upperBand: number[];
  lowerBand: number[];
  currentDi: number;
  currentUpper: number;
  currentLower: number;
  currentSignal: DivergenceSignal;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_FAST = 10;
const DEFAULT_SLOW = 40;
const DEFAULT_FACTOR = 1.0;

function sma(values: ReadonlyArray<number>, end: number, period: number): number {
  const start = Math.max(0, end - period + 1);
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i++) {
    sum += values[i]!;
    count++;
  }
  return count > 0 ? sum / count : Number.NaN;
}

function variance(values: ReadonlyArray<number>, end: number, period: number): number {
  const start = Math.max(0, end - period + 1);
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i++) {
    sum += values[i]!;
    count++;
  }
  if (count < 2) return 0;
  const mean = sum / count;
  let ss = 0;
  for (let i = start; i <= end; i++) {
    ss += (values[i]! - mean) * (values[i]! - mean);
  }
  return ss / (count - 1);
}

export function computeDivergenceIndex(input: DivergenceIndexInput): DivergenceIndexResult {
  const fast = input.fastPeriod ?? DEFAULT_FAST;
  const slow = input.slowPeriod ?? DEFAULT_SLOW;
  const factor = input.bandFactor ?? DEFAULT_FACTOR;
  const prices = input.prices;
  const n = prices.length;
  const di: number[] = new Array(n).fill(Number.NaN);
  const upper: number[] = new Array(n).fill(Number.NaN);
  const lower: number[] = new Array(n).fill(Number.NaN);

  if (n < slow + 1) {
    return {
      divergenceIndex: di,
      upperBand: upper,
      lowerBand: lower,
      currentDi: Number.NaN,
      currentUpper: Number.NaN,
      currentLower: Number.NaN,
      currentSignal: "none",
      sampleSize: n,
      reasoning: `need at least ${slow + 1} prices, got ${n}`,
    };
  }

  const diffs: number[] = [];
  for (let i = 1; i < n; i++) diffs.push(prices[i]! - prices[i - 1]!);

  for (let i = slow - 1; i < n; i++) {
    const f = sma(prices, i, fast);
    const s = sma(prices, i, slow);
    const v = variance(diffs, i - 1, slow);
    if (v > 0) di[i] = (f - s) / v;
  }

  for (let i = slow * 2 - 1; i < n; i++) {
    const v = variance(di, i, slow);
    const sigma = Math.sqrt(Math.max(v, 0));
    upper[i] = sigma * factor;
    lower[i] = -sigma * factor;
  }

  let currentSignal: DivergenceSignal = "none";
  const dNow = di[n - 1]!;
  const dPrev = di[n - 2]!;
  const uNow = upper[n - 1]!;
  const lNow = lower[n - 1]!;
  if ([dNow, dPrev, uNow, lNow].every(Number.isFinite)) {
    const upTrend = sma(prices, n - 1, slow) > sma(prices, n - 2, slow);
    if (dNow < lNow && upTrend) currentSignal = "buy";
    else if (dNow > uNow && !upTrend) currentSignal = "sell";
    else if ((dPrev <= 0 && dNow > 0) || (dPrev >= 0 && dNow < 0)) currentSignal = "exit";
  }

  return {
    divergenceIndex: di,
    upperBand: upper,
    lowerBand: lower,
    currentDi: dNow,
    currentUpper: uNow,
    currentLower: lNow,
    currentSignal,
    sampleSize: n,
    reasoning: `DI ${Number.isFinite(dNow) ? dNow.toFixed(4) : "n/a"} vs [${Number.isFinite(lNow) ? lNow.toFixed(4) : "n/a"}, ${Number.isFinite(uNow) ? uNow.toFixed(4) : "n/a"}] → ${currentSignal}`,
  };
}

export function divergenceIndexToPayload(result: DivergenceIndexResult): Record<string, unknown> {
  return {
    kind: "divergence_index.computed",
    currentDi: Number.isFinite(result.currentDi) ? Number(result.currentDi.toFixed(5)) : null,
    currentSignal: result.currentSignal,
    sampleSize: result.sampleSize,
  };
}

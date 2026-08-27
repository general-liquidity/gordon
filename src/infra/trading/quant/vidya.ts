/**
 * VIDYA — Chande's Variable Index Dynamic Average (GORDON_VIDYA).
 *
 * Alternative adaptive moving average from TSaM Ch 17. Like KAMA, VIDYA
 * varies its effective speed each period; unlike KAMA, the speed scales
 * with the *ratio* of short-window to long-window stdev rather than with
 * the efficiency ratio:
 *
 *   k[t] = stdev(returns, fast) / stdev(returns, slow)
 *   VIDYA[t] = α · k[t] · price[t] + (1 - α · k[t]) · VIDYA[t-1]
 *
 * Where α is a fixed base smoothing constant (default 0.20, equivalent
 * to a 9-period EMA). Capping `α · k` at 1 keeps the recurrence stable.
 * Higher relative volatility slows the trend; lower relative volatility
 * speeds it up.
 */

export interface VidyaInput {
  prices: ReadonlyArray<number>;
  /** Short stdev window. Default 9. */
  fastPeriod?: number;
  /** Long stdev window. Default 30. */
  slowPeriod?: number;
  /** Base smoothing constant α. Default 0.20. */
  baseAlpha?: number;
}

export interface VidyaResult {
  vidya: number[];
  effectiveAlpha: number[];
  currentVidya: number;
  currentAlpha: number;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_FAST = 9;
const DEFAULT_SLOW = 30;
const DEFAULT_BASE_ALPHA = 0.2;

function rollingStdev(values: ReadonlyArray<number>, end: number, period: number): number {
  const start = Math.max(0, end - period + 1);
  const window = values.slice(start, end + 1);
  if (window.length < 2) return 0;
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  let ss = 0;
  for (const v of window) ss += (v - mean) * (v - mean);
  return Math.sqrt(ss / (window.length - 1));
}

export function computeVidya(input: VidyaInput): VidyaResult {
  const prices = input.prices;
  const fast = input.fastPeriod ?? DEFAULT_FAST;
  const slow = input.slowPeriod ?? DEFAULT_SLOW;
  const base = input.baseAlpha ?? DEFAULT_BASE_ALPHA;
  const n = prices.length;
  const out: number[] = new Array(n).fill(Number.NaN);
  const alphas: number[] = new Array(n).fill(Number.NaN);

  if (n < slow + 1) {
    return {
      vidya: out,
      effectiveAlpha: alphas,
      currentVidya: Number.NaN,
      currentAlpha: Number.NaN,
      sampleSize: n,
      reasoning: `need at least ${slow + 1} prices, got ${n}`,
    };
  }

  // Compute returns once.
  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push(prices[i]! - prices[i - 1]!);

  out[slow] = prices[slow]!;
  for (let i = slow + 1; i < n; i++) {
    const sFast = rollingStdev(returns, i - 1, fast);
    const sSlow = rollingStdev(returns, i - 1, slow);
    const k = sSlow > 0 ? sFast / sSlow : 1;
    const alpha = Math.min(1, base * k);
    alphas[i] = alpha;
    out[i] = alpha * prices[i]! + (1 - alpha) * out[i - 1]!;
  }

  const currentVidya = out[n - 1]!;
  const currentAlpha = alphas[n - 1]!;
  return {
    vidya: out,
    effectiveAlpha: alphas,
    currentVidya,
    currentAlpha,
    sampleSize: n,
    reasoning: `VIDYA ${currentVidya.toFixed(4)}, effective α ${currentAlpha.toFixed(3)}`,
  };
}

export function vidyaToPayload(result: VidyaResult): Record<string, unknown> {
  return {
    kind: "vidya.computed",
    currentVidya: Number.isFinite(result.currentVidya)
      ? Number(result.currentVidya.toFixed(5))
      : null,
    currentAlpha: Number.isFinite(result.currentAlpha)
      ? Number(result.currentAlpha.toFixed(5))
      : null,
    sampleSize: result.sampleSize,
  };
}

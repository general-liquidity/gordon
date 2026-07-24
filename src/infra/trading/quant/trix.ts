/**
 * TRIX — Triple Exponential Smoothing (GORDON_TRIX).
 *
 * From TSaM Ch 7 (Hutson, 1983). Three cascaded exponential smoothings
 * with the same constant, then the percentage-rate-of-change of the
 * final smoothed series:
 *
 *   E1[t] = E1[t-1] + α · (p[t] - E1[t-1])
 *   E2[t] = E2[t-1] + α · (E1[t] - E2[t-1])
 *   E3[t] = E3[t-1] + α · (E2[t] - E3[t-1])
 *   TRIX[t] = (E3[t] - E3[t-1]) / E3[t-1]
 *
 * Signal-line crossover (3-day MA of TRIX) generates entry/exit. TRIX's
 * triple smoothing kills most high-frequency noise while the percentage-
 * change step keeps the indicator responsive — less lag than a single
 * MA of comparable smoothness.
 */

export interface TrixInput {
  prices: ReadonlyArray<number>;
  /** Equivalent EMA period for the smoothing constant α = 2/(n+1). Default 9. */
  period?: number;
  /** Signal-line smoothing period (simple MA of TRIX). Default 3. */
  signalPeriod?: number;
}

export type TrixCross = "bullish" | "bearish" | "none";

export interface TrixResult {
  trix: number[];
  signal: number[];
  currentTrix: number;
  currentSignal: number;
  lastCross: TrixCross;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_PERIOD = 9;
const DEFAULT_SIGNAL = 3;

function emaSeries(values: ReadonlyArray<number>, alpha: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length === 0) return out;
  out[0] = values[0]!;
  for (let i = 1; i < values.length; i++) {
    out[i] = out[i - 1]! + alpha * (values[i]! - out[i - 1]!);
  }
  return out;
}

export function computeTrix(input: TrixInput): TrixResult {
  const period = input.period ?? DEFAULT_PERIOD;
  const signalPeriod = input.signalPeriod ?? DEFAULT_SIGNAL;
  const alpha = 2 / (period + 1);
  const prices = input.prices;
  const n = prices.length;

  if (n < period * 3) {
    return {
      trix: new Array(n).fill(Number.NaN),
      signal: new Array(n).fill(Number.NaN),
      currentTrix: Number.NaN,
      currentSignal: Number.NaN,
      lastCross: "none",
      sampleSize: n,
      reasoning: `need at least ${period * 3} prices, got ${n}`,
    };
  }

  const e1 = emaSeries(prices, alpha);
  const e2 = emaSeries(e1, alpha);
  const e3 = emaSeries(e2, alpha);
  const trix: number[] = new Array(n).fill(Number.NaN);
  for (let i = 1; i < n; i++) {
    if (e3[i - 1]! !== 0) trix[i] = (e3[i]! - e3[i - 1]!) / e3[i - 1]!;
  }

  const signal: number[] = new Array(n).fill(Number.NaN);
  for (let i = signalPeriod - 1; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - signalPeriod + 1; j <= i; j++) {
      if (Number.isFinite(trix[j]!)) {
        sum += trix[j]!;
        count++;
      }
    }
    if (count > 0) signal[i] = sum / count;
  }

  let lastCross: TrixCross = "none";
  for (let i = n - 1; i > 1; i--) {
    const tPrev = trix[i - 1]!;
    const sPrev = signal[i - 1]!;
    const tNow = trix[i]!;
    const sNow = signal[i]!;
    if ([tPrev, sPrev, tNow, sNow].some((v) => !Number.isFinite(v))) continue;
    if (tPrev <= sPrev && tNow > sNow) {
      lastCross = "bullish";
      break;
    }
    if (tPrev >= sPrev && tNow < sNow) {
      lastCross = "bearish";
      break;
    }
  }

  const currentTrix = trix[n - 1]!;
  const currentSignal = signal[n - 1]!;
  return {
    trix,
    signal,
    currentTrix,
    currentSignal,
    lastCross,
    sampleSize: n,
    reasoning: `TRIX ${Number.isFinite(currentTrix) ? currentTrix.toFixed(6) : "n/a"}, signal ${Number.isFinite(currentSignal) ? currentSignal.toFixed(6) : "n/a"}, last cross: ${lastCross}`,
  };
}

export function trixToPayload(result: TrixResult): Record<string, unknown> {
  return {
    kind: "trix.computed",
    currentTrix: Number.isFinite(result.currentTrix) ? Number(result.currentTrix.toFixed(6)) : null,
    currentSignal: Number.isFinite(result.currentSignal) ? Number(result.currentSignal.toFixed(6)) : null,
    lastCross: result.lastCross,
    sampleSize: result.sampleSize,
  };
}

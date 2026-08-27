/**
 * True Strength Index (TSI) — William Blau's double-smoothed momentum oscillator.
 *
 * TSI = 100 · EMA_s(EMA_r(Δclose)) / EMA_s(EMA_r(|Δclose|))
 *
 * Two-stage EMA smoothing (long r=25, short s=13) of price change, normalized by
 * the same double-smoothing of absolute price change → a [−100, 100] momentum
 * line that's far less noisy than raw momentum. Above 0 = positive momentum,
 * below 0 = negative; a signal-line (EMA of TSI) crossover is the trade trigger
 * (MACD-like). Distinct from RSI (avg gain/loss) and the existing oscillators.
 * Pure; never throws.
 */

/** EMA over a series that may have leading nulls; SMA-seeded over the first `period` non-nulls. */
function emaSeries(arr: (number | null)[], period: number): (number | null)[] {
  const n = arr.length;
  const out: (number | null)[] = new Array(n).fill(null);
  const k = 2 / (period + 1);
  let seeded = false;
  let ema = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (!seeded) {
      sum += v;
      count++;
      if (count === period) {
        ema = sum / period;
        out[i] = ema;
        seeded = true;
      }
    } else {
      ema = v * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

export interface TSIResult {
  /** TSI line aligned to closes; null during warmup. */
  values: (number | null)[];
  /** Signal line (EMA of TSI). */
  signalValues: (number | null)[];
  current: number | null;
  signal: number | null;
  /** Above/below the zero line = positive/negative momentum. */
  zeroLine: "bullish" | "bearish" | "neutral";
  /** TSI/signal-line cross on the last bar. */
  crossover: "bullish" | "bearish" | "none";
  interpretation: string;
}

export interface TSIInput {
  longPeriod?: number; // first EMA (default 25)
  shortPeriod?: number; // second EMA (default 13)
  signalPeriod?: number; // signal-line EMA (default 13)
}

export function calculateTSI(closes: number[], input: TSIInput = {}): TSIResult {
  const longP = Math.max(2, Math.floor(input.longPeriod ?? 25));
  const shortP = Math.max(2, Math.floor(input.shortPeriod ?? 13));
  const signalP = Math.max(2, Math.floor(input.signalPeriod ?? 13));
  const n = closes.length;

  const empty: TSIResult = {
    values: [],
    signalValues: [],
    current: null,
    signal: null,
    zeroLine: "neutral",
    crossover: "none",
    interpretation: `insufficient data — need ≥ ${longP + shortP + 1} closes, got ${n}`,
  };
  if (n < longP + shortP + 1) return empty;

  // Momentum and |momentum| (m[0]=0).
  const m: number[] = new Array(n).fill(0);
  const absM: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    m[i] = closes[i]! - closes[i - 1]!;
    absM[i] = Math.abs(m[i]!);
  }

  const dsM = emaSeries(emaSeries(m, longP), shortP); // double-smoothed momentum
  const dsAbs = emaSeries(emaSeries(absM, longP), shortP); // double-smoothed |momentum|

  const values: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const a = dsM[i];
    const b = dsAbs[i];
    if (a != null && b != null && b !== 0) {
      values[i] = parseFloat(((100 * a) / b).toFixed(4));
    }
  }
  const signalValues = emaSeries(values, signalP);

  const lastIdx = (arr: (number | null)[]): number => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return i;
    return -1;
  };
  const ci = lastIdx(values);
  const si = lastIdx(signalValues);
  const current = ci >= 0 ? values[ci]! : null;
  const signal = si >= 0 ? signalValues[si]! : null;

  if (current === null) return { ...empty, values, signalValues };

  const zeroLine: TSIResult["zeroLine"] =
    current > 1 ? "bullish" : current < -1 ? "bearish" : "neutral";

  // Crossover on the last bar where both TSI and signal are defined.
  let crossover: TSIResult["crossover"] = "none";
  if (si >= 1 && ci >= 1) {
    const prevT = values[ci - 1];
    const prevS = signalValues[si - 1];
    if (prevT != null && prevS != null && signal !== null) {
      if (prevT <= prevS && current > signal) crossover = "bullish";
      else if (prevT >= prevS && current < signal) crossover = "bearish";
    }
  }

  const interpretation =
    crossover === "bullish"
      ? `TSI ${current} crossed ABOVE signal (${signal}) — bullish momentum trigger${zeroLine === "bearish" ? " (still below zero — early)" : ""}`
      : crossover === "bearish"
        ? `TSI ${current} crossed BELOW signal (${signal}) — bearish momentum trigger${zeroLine === "bullish" ? " (still above zero — early)" : ""}`
        : `TSI ${current} (${zeroLine}); signal ${signal ?? "n/a"}`;

  return { values, signalValues, current, signal, zeroLine, crossover, interpretation };
}

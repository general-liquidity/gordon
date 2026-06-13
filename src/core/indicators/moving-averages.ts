/**
 * Moving-average family: WMA, DEMA, TEMA, TRIMA.
 *
 * - WMA   Weighted MA: linear weights 1..n, heavier on recent bars.
 * - DEMA  Double EMA: 2*EMA - EMA(EMA) — reduced lag.
 * - TEMA  Triple EMA: 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA)) — minimal lag.
 * - TRIMA Triangular MA: SMA of an SMA — double-smoothed, weights peak in the
 *         middle of the window.
 *
 * All take number[] (closes) and return an aligned (number | null)[] with a
 * null warmup prefix, matching the indicators house style.
 */

/**
 * Internal EMA helper returning an aligned series with null warmup.
 * Seeds the first value with the SMA of the first `period` points, as in ema.ts.
 */
function emaSeries(data: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = data.map(() => null);
  // Index of the first non-null input value.
  let start = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== null) {
      start = i;
      break;
    }
  }
  if (start === -1 || data.length - start < period) return out;

  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += data[i]!;
  let ema = sum / period;
  out[start + period - 1] = ema;

  for (let i = start + period; i < data.length; i++) {
    if (data[i] === null) continue;
    ema = (data[i]! - ema) * multiplier + ema;
    out[i] = ema;
  }
  return out;
}

/**
 * Weighted Moving Average. Linear weights 1..period (most recent = period).
 *
 *   WMA = sum(price[k] * weight[k]) / sum(weights),  weights = 1..n
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period (default 14)
 * @returns Aligned WMA series (null during warmup)
 */
export function calculateWMA(closes: number[], period: number = 14): (number | null)[] {
  if (closes.length < period || period < 1) return closes.map(() => null);

  const denom = (period * (period + 1)) / 2;
  const out: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let weighted = 0;
    let w = 1;
    for (let j = i - period + 1; j <= i; j++) {
      weighted += closes[j]! * w;
      w += 1;
    }
    out.push(weighted / denom);
  }

  return out;
}

/**
 * Double Exponential Moving Average.  DEMA = 2*EMA - EMA(EMA).
 *
 * @param closes - Array of closing prices
 * @param period - EMA period (default 14)
 * @returns Aligned DEMA series (null during warmup)
 */
export function calculateDEMA(closes: number[], period: number = 14): (number | null)[] {
  if (closes.length < period || period < 1) return closes.map(() => null);

  const ema1 = emaSeries(closes, period);
  const ema2 = emaSeries(ema1, period);

  return closes.map((_, i) => {
    if (ema1[i] === null || ema2[i] === null) return null;
    return parseFloat((2 * ema1[i]! - ema2[i]!).toFixed(4));
  });
}

/**
 * Triple Exponential Moving Average.
 *   TEMA = 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA)).
 *
 * @param closes - Array of closing prices
 * @param period - EMA period (default 14)
 * @returns Aligned TEMA series (null during warmup)
 */
export function calculateTEMA(closes: number[], period: number = 14): (number | null)[] {
  if (closes.length < period || period < 1) return closes.map(() => null);

  const ema1 = emaSeries(closes, period);
  const ema2 = emaSeries(ema1, period);
  const ema3 = emaSeries(ema2, period);

  return closes.map((_, i) => {
    if (ema1[i] === null || ema2[i] === null || ema3[i] === null) return null;
    return parseFloat((3 * ema1[i]! - 3 * ema2[i]! + ema3[i]!).toFixed(4));
  });
}

/**
 * Triangular Moving Average. SMA of an SMA (double smoothing).
 * For period n, uses an inner window of ceil(n/2) and an outer window of
 * floor(n/2)+1, the standard TA-Lib split for even/odd periods.
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period (default 14)
 * @returns Aligned TRIMA series (null during warmup)
 */
export function calculateTRIMA(closes: number[], period: number = 14): (number | null)[] {
  if (closes.length < period || period < 1) return closes.map(() => null);

  let firstLen: number;
  let secondLen: number;
  if (period % 2 === 0) {
    firstLen = period / 2;
    secondLen = period / 2 + 1;
  } else {
    firstLen = Math.ceil(period / 2);
    secondLen = Math.ceil(period / 2);
  }

  const sma = (data: (number | null)[], len: number): (number | null)[] => {
    const out: (number | null)[] = data.map(() => null);
    for (let i = 0; i < data.length; i++) {
      if (i < len - 1) continue;
      let sum = 0;
      let ok = true;
      for (let j = i - len + 1; j <= i; j++) {
        if (data[j] === null) {
          ok = false;
          break;
        }
        sum += data[j]!;
      }
      if (ok) out[i] = sum / len;
    }
    return out;
  };

  const inner = sma(closes as (number | null)[], firstLen);
  const outer = sma(inner, secondLen);

  return outer.map((v) => (v === null ? null : parseFloat(v.toFixed(4))));
}

/**
 * Momentum & Rate of Change (ROC)
 * Two of the simplest momentum oscillators, both comparing the current close
 * to the close `period` bars ago.
 *
 *   Momentum = close − close[t−period]            (absolute price change)
 *   ROC      = (close / close[t−period] − 1)·100   (percent change)
 *
 * Both return aligned (number | null)[] with a null warmup prefix of length
 * `period`, matching the indicators house style.
 */

/**
 * Calculate Momentum (absolute change vs `period` bars ago).
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period (default 10)
 * @returns Aligned Momentum series (null during warmup)
 */
export function calculateMomentum(closes: number[], period: number = 10): (number | null)[] {
  if (closes.length <= period || period < 1) return closes.map(() => null);

  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      out.push(null);
      continue;
    }
    out.push(parseFloat((closes[i]! - closes[i - period]!).toFixed(4)));
  }
  return out;
}

/**
 * Calculate Rate of Change (percent change vs `period` bars ago).
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period (default 10)
 * @returns Aligned ROC series (null during warmup)
 */
export function calculateROC(closes: number[], period: number = 10): (number | null)[] {
  if (closes.length <= period || period < 1) return closes.map(() => null);

  const out: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      out.push(null);
      continue;
    }
    const prev = closes[i - period]!;
    if (prev === 0) {
      out.push(null);
      continue;
    }
    out.push(parseFloat(((closes[i]! / prev - 1) * 100).toFixed(4)));
  }
  return out;
}

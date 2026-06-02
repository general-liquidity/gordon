/**
 * Hull Moving Average (HMA)
 * A low-lag, smooth moving average from Alan Hull. Combines a fast and a slow
 * WMA to cancel lag, then smooths the result with a √n WMA:
 *
 *   HMA = WMA( 2·WMA(closes, floor(n/2)) − WMA(closes, n), round(√n) )
 *
 * The HMA hugs price far more tightly than a same-period WMA while staying
 * smooth — useful as a fast trend filter.
 */

import { calculateWMA } from "./moving-averages.ts";

/**
 * Calculate the Hull Moving Average.
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period (default 16)
 * @returns Aligned HMA series (null during warmup)
 */
export function calculateHMA(closes: number[], period: number = 16): (number | null)[] {
  if (closes.length < period || period < 2) return closes.map(() => null);

  const half = Math.floor(period / 2);
  const sqrtLen = Math.round(Math.sqrt(period));

  const wmaHalf = calculateWMA(closes, half);
  const wmaFull = calculateWMA(closes, period);

  // raw = 2·WMA(n/2) − WMA(n), aligned with closes (null where either is null).
  const raw: (number | null)[] = closes.map((_, i) => {
    const h = wmaHalf[i];
    const f = wmaFull[i];
    if (h == null || f == null) return null;
    return 2 * h - f;
  });

  // Smooth the non-null tail with a √n WMA, then re-align to the full length.
  let start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] != null) {
      start = i;
      break;
    }
  }
  if (start === -1 || raw.length - start < sqrtLen) return closes.map(() => null);

  const rawTail = raw.slice(start).map((v) => v!);
  const smoothedTail = calculateWMA(rawTail, sqrtLen);

  const out: (number | null)[] = closes.map(() => null);
  for (let i = 0; i < smoothedTail.length; i++) {
    out[start + i] = smoothedTail[i] ?? null;
  }
  return out;
}

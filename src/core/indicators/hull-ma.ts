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

// ── Hull Suite variants (InSilico) — EHMA and THMA ──────────────────────────
// Full-length internal MAs (partial window during warmup) so the nested
// 2·MA(n/2)−MA(n) composition stays simple; the first `period` outputs are
// nulled for honesty, matching calculateHMA's warmup convention.

function emaFull(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.length > 0 ? values[0]! : 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0]! : alpha * values[i]! + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

function wmaFull(values: number[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - period + 1);
    let wsum = 0;
    let wtot = 0;
    for (let k = start; k <= i; k++) {
      const w = k - start + 1;
      wsum += values[k]! * w;
      wtot += w;
    }
    out.push(wtot > 0 ? wsum / wtot : values[i]!);
  }
  return out;
}

const r6 = (x: number): number => parseFloat(x.toFixed(6));

/**
 * Exponential Hull Moving Average (EHMA, Raudys et al.):
 *   EHMA = EMA( 2·EMA(closes, n/2) − EMA(closes, n), round(√n) )
 * Slower/smoother than HMA by default.
 */
export function calculateEHMA(closes: number[], period: number = 16): (number | null)[] {
  if (closes.length < period || period < 2) return closes.map(() => null);
  const half = Math.max(1, Math.floor(period / 2));
  const sq = Math.max(1, Math.round(Math.sqrt(period)));
  const eHalf = emaFull(closes, half);
  const eFull = emaFull(closes, period);
  const raw = closes.map((_, i) => 2 * eHalf[i]! - eFull[i]!);
  const smoothed = emaFull(raw, sq);
  return smoothed.map((v, i) => (i < period ? null : r6(v)));
}

/**
 * Triple Hull Moving Average (THMA / 3HMA):
 *   THMA = WMA( 3·WMA(closes, n/3) − WMA(closes, n/2) − WMA(closes, n), n )
 */
export function calculateTHMA(closes: number[], period: number = 16): (number | null)[] {
  if (closes.length < period || period < 2) return closes.map(() => null);
  const p3 = Math.max(1, Math.floor(period / 3));
  const p2 = Math.max(1, Math.floor(period / 2));
  const w3 = wmaFull(closes, p3);
  const w2 = wmaFull(closes, p2);
  const w1 = wmaFull(closes, period);
  const raw = closes.map((_, i) => 3 * w3[i]! - w2[i]! - w1[i]!);
  const smoothed = wmaFull(raw, period);
  return smoothed.map((v, i) => (i < period ? null : r6(v)));
}

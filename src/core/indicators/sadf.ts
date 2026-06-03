/**
 * Supremum Augmented Dickey-Fuller (SADF) — Phillips-Shi-Yu rolling
 * explosiveness / bubble test.
 *
 * For each endpoint t we run an ADF regression over every
 * backward-expanding window [start..t] (start from 0..t-minWindow) and
 * take the SUPREMUM of the ADF t-statistic. We use the RIGHT tail:
 * β>0 in Δy_τ = α + β·y_{τ-1} + Σ δ_i Δy_{τ-i} + ε signals an
 * explosive (super-unit-root) root, i.e. bubble behaviour — distinct
 * from ordinary non-stationarity (left-tail unit-root rejection).
 *
 * ADF stat = β / SE(β); SE from OLS residual variance × diag((X'X)^-1).
 * Cost is O(n^2) regressions, so candles are capped to the most recent
 * ~300 and minWindow defaults to ~20.
 */

import { transpose, multiply, multiplyVector, invert } from "../alpha/matrix.ts";
import type { Candle } from "./types.ts";

export interface SadfResult {
  sadf: number; // supremum ADF t-stat at the final endpoint
  series: (number | null)[]; // rolling SADF per endpoint, null until minWindow
  isExplosive: boolean; // sadf > ~1.5 right-tail heuristic
  minWindow: number;
  interpretation: string;
}

const MAX_CANDLES = 300;
const DEFAULT_MIN_WINDOW = 20;
const EXPLOSIVE_THRESHOLD = 1.5;

function neutral(minWindow: number, series: (number | null)[]): SadfResult {
  return {
    sadf: 0,
    series,
    isExplosive: false,
    minWindow,
    interpretation: "Insufficient data for SADF — neutral.",
  };
}

/**
 * ADF t-stat (β/SE) on a price segment, right-tail oriented. Returns
 * null when the design is degenerate / singular / too short.
 */
function adfTStat(segment: number[], lags: number): number | null {
  // Δy_τ = α + β·y_{τ-1} + Σ_{i=1..lags} δ_i Δy_{τ-i} + ε
  // Build dependent Δy and regressors for τ from (lags+1)..(L-1).
  const L = segment.length;
  const start = lags + 1;
  const nObs = L - start;
  if (nObs < lags + 3) return null;

  const diffs: number[] = [];
  for (let i = 1; i < L; i++) diffs.push(segment[i]! - segment[i - 1]!);
  // diffs[k] = segment[k+1]-segment[k]; Δy_τ corresponds to diffs[τ-1].

  const y: number[] = [];
  const X: number[][] = [];
  for (let tau = start; tau < L; tau++) {
    y.push(diffs[tau - 1]!);
    const row: number[] = [1, segment[tau - 1]!];
    for (let i = 1; i <= lags; i++) row.push(diffs[tau - 1 - i]!);
    X.push(row);
  }

  const k = X[0]!.length;
  const Xt = transpose(X);
  const XtX = multiply(Xt, X);
  const XtXinv = invert(XtX);
  if (XtXinv == null) return null;

  const Xty = multiplyVector(Xt, y);
  const beta = multiplyVector(XtXinv, Xty);

  // Residual variance s^2 = RSS / (nObs - k).
  let rss = 0;
  for (let r = 0; r < nObs; r++) {
    let pred = 0;
    for (let c = 0; c < k; c++) pred += X[r]![c]! * beta[c]!;
    const e = y[r]! - pred;
    rss += e * e;
  }
  const dof = nObs - k;
  if (dof <= 0) return null;
  const s2 = rss / dof;

  // β is the coefficient on y_{τ-1} → index 1. SE = sqrt(s2 * diag_1).
  const varBeta = s2 * XtXinv[1]![1]!;
  if (!Number.isFinite(varBeta) || varBeta <= 0) return null;
  const se = Math.sqrt(varBeta);
  const t = beta[1]! / se;
  return Number.isFinite(t) ? t : null;
}

export function calculateSadf(
  candles: Candle[],
  opts?: { minWindow?: number; lags?: number },
): SadfResult {
  const minWindow = Math.max(8, opts?.minWindow ?? DEFAULT_MIN_WINDOW);
  const lags = Math.max(0, opts?.lags ?? 0);

  if (candles.length < minWindow + 5) {
    return neutral(
      minWindow,
      candles.map(() => null),
    );
  }

  const recent =
    candles.length > MAX_CANDLES ? candles.slice(candles.length - MAX_CANDLES) : candles;
  const prices = recent.map((c) => c.close);
  const n = prices.length;

  const series: (number | null)[] = new Array(n).fill(null);

  for (let t = minWindow - 1; t < n; t++) {
    let sup = -Infinity;
    // Backward-expanding windows [start..t], start from 0..(t-minWindow+1).
    for (let s = 0; s <= t - minWindow + 1; s++) {
      const segment = prices.slice(s, t + 1);
      const stat = adfTStat(segment, lags);
      if (stat != null && stat > sup) sup = stat;
    }
    series[t] = Number.isFinite(sup) ? Number(sup.toFixed(4)) : null;
  }

  const last = series[n - 1];
  const sadf = last == null ? 0 : last;
  const isExplosive = sadf > EXPLOSIVE_THRESHOLD;

  let interpretation: string;
  if (isExplosive) {
    interpretation = `SADF ${sadf.toFixed(2)} exceeds the right-tail bubble threshold — explosive / super-unit-root behaviour detected.`;
  } else if (sadf > 0) {
    interpretation = `SADF ${sadf.toFixed(2)} is positive but sub-threshold — no clear explosive regime.`;
  } else {
    interpretation = `SADF ${sadf.toFixed(2)} is non-positive — consistent with stationary / mean-reverting behaviour.`;
  }

  return {
    sadf: Number(sadf.toFixed(4)),
    series,
    isExplosive,
    minWindow,
    interpretation,
  };
}

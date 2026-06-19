/**
 * Generalized variance / "Gram volume" crash detector (Sudjianto, "the geometry
 * of a market crash").
 *
 * Over a rolling window, build the correlation matrix R of a basket of return
 * series and compute the "volume" √det(R) ∈ [0, 1]:
 *   - R = identity (uncorrelated, fully diversified) → det = 1 → volume = 1.
 *   - correlations → 1 (a crash: everything moves together) → R loses rank →
 *     det → 0 → volume → 0.
 * det(R) = ∏λ (product of eigenvalues = generalized variance), so a SINGLE
 * near-linear-dependency (one tiny eigenvalue) zeroes the volume even while the
 * average pairwise correlation, the participation ratio (Σλ)²/Σλ², and the
 * absorption ratio λ₁/Σλ barely move — that's the edge over `correlationBreakdown`
 * / `effectiveN` / `pcaConcentration`.
 *
 * Because the diversified baseline of det(R) shrinks with basket size k, the
 * crash signal is a SHARP DROP in the volume relative to its own recent level,
 * not an absolute threshold — so the regime is read off the volume's z-score.
 *
 * det computed via Cholesky (det = ∏Lᵢᵢ²); a Cholesky failure means R is not
 * positive-definite (rank collapse) → volume 0, which is itself the signal.
 * Pure; never throws.
 */

import { choleskyDecomposition } from "../../../core/alpha/matrix.ts";

export interface GeneralizedVarianceInput {
  /** k aligned return series (each same length). */
  returns: number[][];
  /** Rolling window length in bars. Default 60. */
  window?: number;
}

export interface GeneralizedVarianceResult {
  /** √det(R) per window end, aligned to the series length; null before window-1. */
  values: (number | null)[];
  /** log det(R) per window (−Infinity floored to LOGDET_FLOOR on rank collapse). */
  logDet: (number | null)[];
  current: number | null;
  currentLogDet: number | null;
  /** Current volume's z-score vs its own trailing distribution (negative = collapsing). */
  volumeZ: number | null;
  regime: "diversified" | "normal" | "stressed" | "crash" | "insufficient";
  trend: "collapsing" | "expanding" | "stable";
  nSeries: number;
  window: number;
  interpretation: string;
}

const LOGDET_FLOOR = -50;
const round = (x: number, p = 6): number => parseFloat(x.toFixed(p));

/** log(det) of a symmetric PD matrix via Cholesky; null if not PD (rank-deficient). */
function choleskyLogDet(M: number[][]): number | null {
  const L = choleskyDecomposition(M);
  if (L === null) return null; // not PD → det ≈ 0
  let logDet = 0;
  for (let i = 0; i < L.length; i++) logDet += 2 * Math.log(L[i]![i]!);
  return logDet;
}

/** Pearson correlation matrix of the k column-series over [start, end). */
function correlationMatrix(series: number[][], start: number, end: number): number[][] {
  const k = series.length;
  const len = end - start;
  const means = new Array(k).fill(0);
  const stds = new Array(k).fill(0);
  for (let a = 0; a < k; a++) {
    let m = 0;
    for (let t = start; t < end; t++) m += series[a]![t]!;
    m /= len;
    means[a] = m;
    let v = 0;
    for (let t = start; t < end; t++) {
      const d = series[a]![t]! - m;
      v += d * d;
    }
    stds[a] = Math.sqrt(v / len);
  }
  const R: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let a = 0; a < k; a++) {
    R[a]![a] = 1;
    for (let b = a + 1; b < k; b++) {
      let cov = 0;
      for (let t = start; t < end; t++) cov += (series[a]![t]! - means[a]) * (series[b]![t]! - means[b]);
      cov /= len;
      const denom = stds[a]! * stds[b]!;
      const r = denom > 0 ? cov / denom : 0; // constant series → treat as uncorrelated
      R[a]![b] = r;
      R[b]![a] = r;
    }
  }
  return R;
}

export function computeGeneralizedVariance(input: GeneralizedVarianceInput): GeneralizedVarianceResult {
  const series = (input.returns ?? []).filter((s) => Array.isArray(s));
  const k = series.length;
  const window = Math.max(2, Math.floor(input.window ?? 60));
  const n = k > 0 ? Math.min(...series.map((s) => s.length)) : 0;

  const empty = (reason: string): GeneralizedVarianceResult => ({
    values: [],
    logDet: [],
    current: null,
    currentLogDet: null,
    volumeZ: null,
    regime: "insufficient",
    trend: "stable",
    nSeries: k,
    window,
    interpretation: reason,
  });
  if (k < 2) return empty("need ≥ 2 return series");
  if (n < window) return empty(`need ≥ ${window} aligned observations, got ${n}`);

  const values: (number | null)[] = new Array(n).fill(null);
  const logDet: (number | null)[] = new Array(n).fill(null);
  for (let end = window; end <= n; end++) {
    const R = correlationMatrix(series, end - window, end);
    const ld = choleskyLogDet(R);
    const i = end - 1;
    if (ld === null) {
      values[i] = 0;
      logDet[i] = LOGDET_FLOOR;
    } else {
      logDet[i] = round(Math.max(ld, LOGDET_FLOOR), 4);
      values[i] = round(Math.exp(ld / 2), 6); // √det = exp(logDet/2)
    }
  }

  const current = values[n - 1] ?? null;
  const currentLogDet = logDet[n - 1] ?? null;

  // Volume z-score vs its own trailing distribution (the crash = a sharp drop).
  const vol = values.filter((v): v is number => v !== null);
  let volumeZ: number | null = null;
  if (vol.length >= 5 && current !== null) {
    const hist = vol.slice(0, -1); // exclude current
    const m = hist.reduce((s, x) => s + x, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((s, x) => s + (x - m) * (x - m), 0) / hist.length);
    volumeZ = sd > 0 ? round((current - m) / sd, 3) : 0;
  }

  let regime: GeneralizedVarianceResult["regime"] = "normal";
  if (volumeZ !== null) {
    if (volumeZ <= -2) regime = "crash";
    else if (volumeZ <= -1) regime = "stressed";
    else if (volumeZ >= 1) regime = "diversified";
  }

  // Trend: current vs the volume a few valid points back.
  let trend: GeneralizedVarianceResult["trend"] = "stable";
  if (vol.length >= 4 && current !== null) {
    const back = vol[Math.max(0, vol.length - 4)]!;
    const chg = (current - back) / Math.abs(back || 1e-9);
    trend = chg < -0.05 ? "collapsing" : chg > 0.05 ? "expanding" : "stable";
  }

  const interpretation =
    current === null
      ? "insufficient data"
      : regime === "crash"
        ? `Gram volume ${current} COLLAPSED (z=${volumeZ}) — correlations converging, diversification gone (crash regime)`
        : regime === "stressed"
          ? `Gram volume ${current} dropping (z=${volumeZ}) — correlations rising, ${trend}`
          : regime === "diversified"
            ? `Gram volume ${current} high (z=${volumeZ}) — basket well-diversified`
            : `Gram volume ${current} (z=${volumeZ ?? "n/a"}, ${trend})`;

  return { values, logDet, current, currentLogDet, volumeZ, regime, trend, nSeries: k, window, interpretation };
}

/**
 * Generalized impulse response (Pesaran-Shin) + speed-of-adjustment.
 *
 * From Alexander-Heck 2020. For two cointegrated price series, fit a bivariate
 * VECM(1), then trace the ORDER-INVARIANT generalized impulse (Pesaran-Shin
 * 1998) of a 1-σ shock to each market and measure how fast the cointegration
 * SPREAD re-converges — "minutes-to-convergence." The asymmetry (spread
 * re-equilibrates faster after one market's shock than the other's) is a
 * directional lead-lag / absorption read that complements `price_discovery`.
 *
 * Generalized (vs Cholesky) shock: a 1-σ shock to market j is the column
 * Ω·eⱼ/√Ωⱼⱼ, so shocking market 1 also moves market 2 by ρ·σ₂ contemporaneously.
 * Forward-simulate the fitted VECM (errors zero after t=0), tracking the spread
 * until |z| ≤ convergenceFrac·|z₀|. Pure; never throws. Only meaningful when
 * cointegrated — verify with adf_test / johansen first.
 */

import { invert, transpose, multiply, multiplyVector } from "../../../core/alpha/matrix.ts";

export interface GeneralizedImpulseInput {
  series1: number[];
  series2: number[];
  label1?: string;
  label2?: string;
  /** Fraction of the initial spread shock to call "converged". Default 0.1 (90% reverted). */
  convergenceFrac?: number;
  /** Max bars to simulate. Default 60. */
  maxHorizon?: number;
  applyLog?: boolean;
}

export interface GeneralizedImpulseResult {
  label1: string;
  label2: string;
  beta: number;
  alpha1: number;
  alpha2: number;
  /** Bars for the spread to re-converge after a shock to each market (null = no convergence within horizon). */
  barsToConverge1: number | null;
  barsToConverge2: number | null;
  converged1: boolean;
  converged2: boolean;
  /** Label of the shock that re-converges faster (system absorbs it quicker), or "symmetric"/"none". */
  fasterAbsorbed: string;
  confidence: "high" | "low";
  sampleSize: number;
  interpretation: string;
}

const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));

function mean(a: number[]): number {
  let s = 0;
  for (const x of a) s += x;
  return a.length > 0 ? s / a.length : 0;
}
function variance(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return s / (a.length - 1);
}
function covariance(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i]! - ma) * (b[i]! - mb);
  return a.length > 1 ? s / (a.length - 1) : 0;
}

/** β = (XᵀX)⁻¹ Xᵀy. Returns null if singular. */
function multipleOLS(X: number[][], y: number[]): number[] | null {
  try {
    const Xt = transpose(X);
    const XtX = multiply(Xt, X);
    const XtXinv = invert(XtX);
    if (!XtXinv) return null;
    const Xty = multiplyVector(Xt, y);
    return multiplyVector(XtXinv, Xty);
  } catch {
    return null;
  }
}

const MIN_OBS = 40;

export function computeGeneralizedImpulse(input: GeneralizedImpulseInput): GeneralizedImpulseResult {
  const label1 = input.label1 ?? "market1";
  const label2 = input.label2 ?? "market2";
  const convFrac = input.convergenceFrac && input.convergenceFrac > 0 && input.convergenceFrac < 1 ? input.convergenceFrac : 0.1;
  const maxHorizon = Math.max(5, Math.floor(input.maxHorizon ?? 60));
  const tx = (v: number[]): number[] => (input.applyLog ? v.map((x) => Math.log(x)) : v.slice());
  const y1 = tx(input.series1);
  const y2 = tx(input.series2);
  const n = Math.min(y1.length, y2.length);

  const low = (reason: string): GeneralizedImpulseResult => ({
    label1, label2, beta: 0, alpha1: 0, alpha2: 0,
    barsToConverge1: null, barsToConverge2: null, converged1: false, converged2: false,
    fasterAbsorbed: "none", confidence: "low", sampleSize: n, interpretation: reason,
  });
  if (n < MIN_OBS) return low(`need ≥ ${MIN_OBS} aligned observations, got ${n}`);

  const a1 = y1.slice(0, n);
  const a2 = y2.slice(0, n);

  // Cointegrating relation + spread.
  const m1 = mean(a1);
  const m2 = mean(a2);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = a2[i]! - m2;
    sxx += dx * dx;
    sxy += dx * (a1[i]! - m1);
  }
  const beta = sxx !== 0 ? sxy / sxx : 1;
  const c = m1 - beta * m2;
  const z = a1.map((v, i) => v - c - beta * a2[i]!);

  // VECM(1): Δyᵢ_t = μ + αᵢ·z[t−1] + gᵢ1·Δy1[t−1] + gᵢ2·Δy2[t−1] + εᵢ. Rows t=2..n−1.
  const X: number[][] = [];
  const dY1: number[] = [];
  const dY2: number[] = [];
  for (let t = 2; t < n; t++) {
    const dy1Lag = a1[t - 1]! - a1[t - 2]!;
    const dy2Lag = a2[t - 1]! - a2[t - 2]!;
    X.push([1, z[t - 1]!, dy1Lag, dy2Lag]);
    dY1.push(a1[t]! - a1[t - 1]!);
    dY2.push(a2[t]! - a2[t - 1]!);
  }
  const b1 = multipleOLS(X, dY1);
  const b2 = multipleOLS(X, dY2);
  if (!b1 || !b2) return low("VECM regression singular");

  const [, alpha1, g11, g12] = b1;
  const [, alpha2, g21, g22] = b2;

  // Residual covariance.
  const e1 = dY1.map((y, i) => y - (b1[0]! + b1[1]! * X[i]![1]! + b1[2]! * X[i]![2]! + b1[3]! * X[i]![3]!));
  const e2 = dY2.map((y, i) => y - (b2[0]! + b2[1]! * X[i]![1]! + b2[2]! * X[i]![2]! + b2[3]! * X[i]![3]!));
  const s1 = Math.sqrt(variance(e1));
  const s2 = Math.sqrt(variance(e2));
  const rho = s1 > 0 && s2 > 0 ? covariance(e1, e2) / (s1 * s2) : 0;

  // Forward-simulate the generalized impulse for a shock to market j.
  const simulate = (shockMarket: 1 | 2): number | null => {
    // Pesaran-Shin 1-σ generalized shock: column Ω·eⱼ/√Ωⱼⱼ.
    const e0 = shockMarket === 1 ? [s1, rho * s2] : [rho * s1, s2];
    let yy1 = e0[0]!;
    let yy2 = e0[1]!;
    let dy1Prev = e0[0]!;
    let dy2Prev = e0[1]!;
    const z0 = yy1 - beta! * yy2;
    if (z0 === 0) return null;
    let zPrev = z0;
    for (let t = 1; t <= maxHorizon; t++) {
      const d1 = alpha1! * zPrev + g11! * dy1Prev + g12! * dy2Prev;
      const d2 = alpha2! * zPrev + g21! * dy1Prev + g22! * dy2Prev;
      yy1 += d1;
      yy2 += d2;
      const zt = yy1 - beta! * yy2;
      if (Math.abs(zt) <= convFrac * Math.abs(z0)) return t;
      if (!Number.isFinite(zt) || Math.abs(zt) > 1e6 * Math.abs(z0)) return null; // diverging
      dy1Prev = d1;
      dy2Prev = d2;
      zPrev = zt;
    }
    return null; // did not converge within horizon
  };

  const bars1 = simulate(1);
  const bars2 = simulate(2);
  const converged1 = bars1 !== null;
  const converged2 = bars2 !== null;

  let fasterAbsorbed = "none";
  if (converged1 && converged2) {
    if (bars1! < bars2!) fasterAbsorbed = label1;
    else if (bars2! < bars1!) fasterAbsorbed = label2;
    else fasterAbsorbed = "symmetric";
  } else if (converged1) fasterAbsorbed = label1;
  else if (converged2) fasterAbsorbed = label2;

  const confidence: "high" | "low" = converged1 || converged2 ? "high" : "low";
  const interpretation =
    !converged1 && !converged2
      ? "spread does not re-converge within horizon — verify the series are cointegrated (adf_test / johansen) first"
      : `spread re-converges in ${bars1 ?? ">horizon"} bar(s) after a ${label1} shock vs ${bars2 ?? ">horizon"} after a ${label2} shock` +
        (fasterAbsorbed === "symmetric"
          ? " (symmetric absorption)"
          : fasterAbsorbed !== "none"
            ? ` — ${fasterAbsorbed} shocks are absorbed faster`
            : "");

  return {
    label1, label2,
    beta: round(beta!),
    alpha1: round(alpha1!),
    alpha2: round(alpha2!),
    barsToConverge1: bars1,
    barsToConverge2: bars2,
    converged1, converged2,
    fasterAbsorbed,
    confidence,
    sampleSize: n,
    interpretation,
  };
}

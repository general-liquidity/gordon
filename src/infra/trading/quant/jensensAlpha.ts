/**
 * Jensen's alpha with Newey-West (HAC) significance.
 *
 * The core quant signal-validation test: regress a strategy's returns on a
 * factor universe and ask whether the INTERCEPT (alpha) is statistically ≠ 0
 * after the known factors are stripped out. A significant positive intercept =
 * real edge; an intercept that vanishes into the noise = disguised beta.
 *
 *   rₜ = α + Σ βᵢ·factorᵢₜ + εₜ
 *
 * Critically, financial residuals autocorrelate, so raw OLS standard errors
 * understate uncertainty and FLATTER the signal. This uses Newey-West HAC
 * (heteroskedasticity-and-autocorrelation-consistent) standard errors via the
 * Bartlett-kernel sandwich V = (XᵀX)⁻¹ Ω (XᵀX)⁻¹, Ω = Σ eₜ²xₜxₜᵀ +
 * Σ_l w_l Σ eₜe_{t-l}(xₜx_{t-l}ᵀ + x_{t-l}xₜᵀ), w_l = 1 − l/(L+1).
 *
 * Distinct from `hidden-beta-verifier` (which-factor-leaks) and `asymmetric_beta`
 * (up/down beta) — this tests the alpha INTERCEPT's significance, HAC-robust.
 * Pure; never throws.
 */

import { invert, multiply } from "../../../core/alpha/matrix.ts";
import { normalCdf } from "../../../core/numerics/index.ts";

const round = (x: number, p = 6): number => parseFloat(x.toFixed(p));

/** Two-sided p-value from a t-stat under the normal (HAC asymptotic) approximation. */
const twoSidedP = (t: number): number => round(2 * normalCdf(-Math.abs(t)), 4);

export interface JensensAlphaInput {
  /** Strategy / asset return series. */
  returns: number[];
  /** Factor return series (each aligned to `returns`); ≥1 required. */
  factors: number[][];
  /** Optional factor labels. */
  factorNames?: string[];
  /** Newey-West lag truncation. Default: max(1, floor(4·(n/100)^(2/9))). */
  lags?: number;
}

export interface JensensAlphaCoef {
  name: string;
  coef: number;
  tStat: number;
  pValue: number;
}

export interface JensensAlphaResult {
  /** The intercept = Jensen's alpha (per-period). */
  alpha: number;
  alphaTStat: number;
  /** HAC (Newey-West) two-sided p-value for alpha ≠ 0. */
  alphaPValue: number;
  /** Raw OLS p-value for alpha — shown so the HAC correction is visible. */
  alphaPValueOLS: number;
  /** Factor loadings (betas) with HAC significance. */
  betas: JensensAlphaCoef[];
  rSquared: number;
  adjRSquared: number;
  lags: number;
  sampleSize: number;
  verdict: "significant_alpha" | "insignificant_alpha" | "negative_alpha" | "insufficient";
  interpretation: string;
}

const MIN_OBS = 30;

export function computeJensensAlpha(input: JensensAlphaInput): JensensAlphaResult {
  const y = input.returns ?? [];
  const factors = (input.factors ?? []).filter((f) => Array.isArray(f));
  const k = factors.length;
  const p = k + 1; // intercept + factors
  const n = k > 0 ? Math.min(y.length, ...factors.map((f) => f.length)) : 0;

  const insufficient = (reason: string): JensensAlphaResult => ({
    alpha: 0,
    alphaTStat: 0,
    alphaPValue: 1,
    alphaPValueOLS: 1,
    betas: [],
    rSquared: 0,
    adjRSquared: 0,
    lags: 0,
    sampleSize: n,
    verdict: "insufficient",
    interpretation: reason,
  });
  if (k < 1) return insufficient("need ≥ 1 factor series");
  if (n < MIN_OBS || n - p < 10)
    return insufficient(`need ≥ ${MIN_OBS} aligned obs with n − params ≥ 10, got n=${n}`);

  // Design matrix rows x_t = [1, f1_t, …, fk_t].
  const X: number[][] = [];
  for (let t = 0; t < n; t++) {
    const row = [1];
    for (let j = 0; j < k; j++) row.push(factors[j]![t]!);
    X.push(row);
  }

  // XᵀX (p×p) and Xᵀy (p).
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let t = 0; t < n; t++) {
    const xt = X[t]!;
    for (let i = 0; i < p; i++) {
      Xty[i] += xt[i]! * y[t]!;
      for (let j = 0; j < p; j++) XtX[i]![j]! += xt[i]! * xt[j]!;
    }
  }
  const XtXinv = invert(XtX);
  if (!XtXinv) return insufficient("regression singular (collinear factors)");

  const beta = new Array(p).fill(0);
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) beta[i] += XtXinv[i]![j]! * Xty[j]!;

  // Residuals, R².
  const e = new Array(n).fill(0);
  let rss = 0;
  for (let t = 0; t < n; t++) {
    let fit = 0;
    for (let i = 0; i < p; i++) fit += X[t]![i]! * beta[i];
    e[t] = y[t]! - fit;
    rss += e[t] * e[t];
  }
  const ybar = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let tss = 0;
  for (let t = 0; t < n; t++) tss += (y[t]! - ybar) * (y[t]! - ybar);
  const rSquared = tss > 0 ? 1 - rss / tss : 0;
  const adjR = tss > 0 ? 1 - ((1 - rSquared) * (n - 1)) / (n - p) : 0;
  const sigma2 = rss / (n - p);

  // Newey-West HAC meat Ω = Σ eₜ²xₜxₜᵀ + Σ_l w_l Σ eₜe_{t-l}(xₜx_{t-l}ᵀ + x_{t-l}xₜᵀ).
  const L = Math.max(1, Math.min(input.lags ?? Math.floor(4 * (n / 100) ** (2 / 9)), n - 2));
  const omega: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let t = 0; t < n; t++) {
    const xt = X[t]!;
    const e2 = e[t] * e[t];
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) omega[i]![j]! += e2 * xt[i]! * xt[j]!;
  }
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);
    for (let t = l; t < n; t++) {
      const xt = X[t]!;
      const xtl = X[t - l]!;
      const g = w * e[t] * e[t - l];
      for (let i = 0; i < p; i++)
        for (let j = 0; j < p; j++) {
          omega[i]![j]! += g * (xt[i]! * xtl[j]! + xtl[i]! * xt[j]!);
        }
    }
  }
  const vHac = multiply(multiply(XtXinv, omega), XtXinv); // (XᵀX)⁻¹ Ω (XᵀX)⁻¹
  const hacSE = (i: number): number => Math.sqrt(Math.max(vHac[i]![i]!, 0));
  const olsSE = (i: number): number => Math.sqrt(Math.max(sigma2 * XtXinv[i]![i]!, 0));

  const alpha = beta[0];
  const aHacSE = hacSE(0);
  const alphaTStat = aHacSE > 0 ? alpha / aHacSE : 0;
  const alphaPValue = twoSidedP(alphaTStat);
  const aOlsSE = olsSE(0);
  const alphaPValueOLS = twoSidedP(aOlsSE > 0 ? alpha / aOlsSE : 0);

  const betas: JensensAlphaCoef[] = [];
  for (let j = 0; j < k; j++) {
    const se = hacSE(j + 1);
    const t = se > 0 ? beta[j + 1] / se : 0;
    betas.push({
      name: input.factorNames?.[j] ?? `factor${j + 1}`,
      coef: round(beta[j + 1]),
      tStat: round(t, 3),
      pValue: twoSidedP(t),
    });
  }

  const verdict: JensensAlphaResult["verdict"] =
    alpha < 0 && alphaPValue < 0.05
      ? "negative_alpha"
      : alpha > 0 && alphaPValue < 0.05
        ? "significant_alpha"
        : "insignificant_alpha";

  const interpretation =
    verdict === "significant_alpha"
      ? `α=${round(alpha)} per period, HAC t=${round(alphaTStat, 2)} (p=${alphaPValue}) — REAL alpha survives the factors${alphaPValueOLS < alphaPValue ? ` (raw OLS p=${alphaPValueOLS} overstated it)` : ""}`
      : verdict === "negative_alpha"
        ? `α=${round(alpha)} significantly NEGATIVE (HAC p=${alphaPValue}) — the strategy destroys value after factors`
        : `α=${round(alpha)} not significant (HAC p=${alphaPValue}) — no edge beyond the factors (disguised beta / noise)${alphaPValueOLS < 0.05 ? `; raw OLS p=${alphaPValueOLS} would have fooled you` : ""}`;

  return {
    alpha: round(alpha),
    alphaTStat: round(alphaTStat, 3),
    alphaPValue,
    alphaPValueOLS,
    betas,
    rSquared: round(rSquared, 4),
    adjRSquared: round(adjR, 4),
    lags: L,
    sampleSize: n,
    verdict,
    interpretation,
  };
}

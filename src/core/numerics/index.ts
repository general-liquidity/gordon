/**
 * Shared special-functions module — one tested `@stdlib`-backed home for the
 * transcendentals that were hand-transcribed ~10+ times across the codebase
 * (normal CDF / PPF, erf, gammaln, incomplete-beta, Student-t, chi-square).
 *
 * SPEC Win #1 (`docs/library-adoption/SPEC.md` + `30-trading-infra.md`,
 * Cluster A). The standard-normal CDF / erf alone is hand-rolled across the
 * trading-infra region in two Abramowitz-&-Stegun variants (26.2.17 and
 * 7.1.26), each carrying its own magic constants and sitting under the entire
 * option-pricing surface plus every hypothesis-test p-value.
 *
 * These wrappers preserve the EXACT signatures of the hand-rolled callers so a
 * future migration is a one-line import swap:
 *   - `normalCdf(x, mu=0, sigma=1)`     ← blackScholesGreeks.normalCDF / vpin.normalCdf
 *   - `studentTTwoSidedPValue(t, df)`   ← linearRegression.studentTTwoSidedPValue
 *   - `incompleteBeta(x, a, b)`         ← linearRegression.incompleteBeta (a,b,x → x,a,b!)
 *   - `gammaln(x)`                      ← linearRegression / conditional-distribution-test
 *   - `chiSquarePValue(x, k)`           ← conditional-distribution-test.chiSquareSf
 *
 * `@stdlib` is exact to double precision; the A&S polynomials differ by ~1e-7,
 * so the parity test (`numerics.test.ts`) asserts agreement within 1e-6.
 *
 * Pure compute. No I/O. Deterministic.
 *
 * @stdlib API notes:
 *   - Sub-packages export a single function via CommonJS `export =`; imported
 *     here as default imports (Bun + `moduleResolution: bundler`).
 *   - `betainc(x, a, b, regularized?, upper?)` — arg order is (x, a, b), NOT
 *     the Numerical-Recipes (a, b, x). Defaults to the REGULARIZED lower tail,
 *     which is exactly Gordon's `incompleteBeta`.
 *   - `normalCdf` / `normalPpf` / `chiSquareCdf` / `tCdf` take the distribution
 *     parameters positionally (value first, then params).
 */

import stdlibNormalCdf from "@stdlib/stats-base-dists-normal-cdf";
import stdlibNormalQuantile from "@stdlib/stats-base-dists-normal-quantile";
import stdlibErf from "@stdlib/math-base-special-erf";
import stdlibErfInv from "@stdlib/math-base-special-erfinv";
import stdlibGammaln from "@stdlib/math-base-special-gammaln";
import stdlibBetainc from "@stdlib/math-base-special-betainc";
import stdlibTCdf from "@stdlib/stats-base-dists-t-cdf";
import stdlibChiSquareCdf from "@stdlib/stats-base-dists-chisquare-cdf";

/**
 * Standard-normal (or general normal) cumulative distribution function Φ.
 * Drop-in for the hand-rolled A&S `normalCDF` / `normalCdf` copies
 * (blackScholesGreeks, vpin, twoSampleTest, riskModelValidation, …).
 *
 * @param x - value to evaluate the CDF at
 * @param mu - mean (default 0)
 * @param sigma - standard deviation (default 1)
 */
export function normalCdf(x: number, mu = 0, sigma = 1): number {
  return stdlibNormalCdf(x, mu, sigma);
}

/**
 * Normal inverse-CDF (quantile / percent-point function).
 *
 * @param p - probability in [0, 1]
 * @param mu - mean (default 0)
 * @param sigma - standard deviation (default 1)
 */
export function normalPpf(p: number, mu = 0, sigma = 1): number {
  return stdlibNormalQuantile(p, mu, sigma);
}

/** Error function erf(x). */
export function erf(x: number): number {
  return stdlibErf(x);
}

/** Inverse error function erf⁻¹(x), defined on (-1, 1). */
export function erfInv(x: number): number {
  return stdlibErfInv(x);
}

/** Natural log of the gamma function, ln Γ(x). */
export function gammaln(x: number): number {
  return stdlibGammaln(x);
}

/**
 * Regularized lower incomplete beta function Iₓ(a, b).
 *
 * NOTE the argument order: `(x, a, b)` matches `@stdlib`. The hand-rolled
 * `linearRegression.incompleteBeta(a, b, x)` takes the params first — callers
 * migrating must reorder. The mathematical result is identical.
 *
 * @param x - upper limit of integration, in [0, 1]
 * @param a - first shape parameter (> 0)
 * @param b - second shape parameter (> 0)
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  return stdlibBetainc(x, a, b);
}

/**
 * Student-t cumulative distribution function — P(T ≤ t) for `df` degrees of
 * freedom.
 */
export function studentTCdf(t: number, df: number): number {
  return stdlibTCdf(t, df);
}

/**
 * Two-sided p-value for a t-statistic with `df` degrees of freedom:
 *   p = 2 · (1 − F_t(|t|; df)) = I_{df/(df+t²)}(df/2, 1/2).
 *
 * Matches `linearRegression.studentTTwoSidedPValue` — returns null for
 * non-positive df or non-finite t.
 */
export function studentTTwoSidedPValue(t: number, df: number): number | null {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return null;
  return 2 * (1 - stdlibTCdf(Math.abs(t), df));
}

/** Chi-square cumulative distribution function with `k` degrees of freedom. */
export function chiSquareCdf(x: number, k: number): number {
  return stdlibChiSquareCdf(x, k);
}

/**
 * Upper-tail (survival) p-value of the chi-square distribution: 1 − F(x; k).
 * Drop-in for `conditional-distribution-test.chiSquareSf` and the closed-form
 * χ² survival in `riskModelValidation`.
 */
export function chiSquarePValue(x: number, k: number): number {
  if (x <= 0) return 1;
  return 1 - stdlibChiSquareCdf(x, k);
}

/**
 * Black-Scholes-Merton Pricing + Greeks (GORDON_BLACK_SCHOLES_GREEKS).
 *
 * Port of Black & Scholes (1973), "The Pricing of Options and Corporate
 * Liabilities", Journal of Political Economy 81(3), 637-654. Continuous-
 * compounding form with Merton's continuous-dividend extension (q).
 *
 * European option on a single underlying paying continuous dividend yield
 * q with risk-free rate r and Black-Scholes volatility σ. T in years.
 *
 *   d1 = [ln(S/K) + (r − q + σ²/2) T] / (σ √T)
 *   d2 = d1 − σ √T
 *
 *   Call price:  C = S e^(−qT) N(d1) − K e^(−rT) N(d2)
 *   Put price:   P = K e^(−rT) N(−d2) − S e^(−qT) N(−d1)
 *
 * Greeks (per 1 unit move unless noted):
 *   Δ_call = e^(−qT) N(d1)
 *   Δ_put  = e^(−qT) (N(d1) − 1) = −e^(−qT) N(−d1)
 *
 *   Γ_call = Γ_put = e^(−qT) φ(d1) / (S σ √T)
 *
 *   ν      = S e^(−qT) φ(d1) √T               (per 1.0 vol change; ÷100 for 1%)
 *
 *   Θ_call = −S e^(−qT) φ(d1) σ / (2 √T)
 *            − r K e^(−rT) N(d2)
 *            + q S e^(−qT) N(d1)              (per year; ÷365 for per day)
 *
 *   Θ_put  = −S e^(−qT) φ(d1) σ / (2 √T)
 *            + r K e^(−rT) N(−d2)
 *            − q S e^(−qT) N(−d1)
 *
 *   ρ_call = K T e^(−rT) N(d2)                (per 1.0 rate change; ÷100 for 1%)
 *   ρ_put  = −K T e^(−rT) N(−d2)
 *
 * Second-order cross-Greeks (the "vanna chart" family — how Δ is reshaped by
 * vol and time, the forces behind dealer hedging flow):
 *   Vanna  = ∂Δ/∂σ = ∂ν/∂S = −e^(−qT) φ(d1) d2/σ          (call = put)
 *   Vomma  = ∂ν/∂σ = ν · d1 d2/σ                            (call = put)
 *   Charm_call = q e^(−qT) N(d1)  − e^(−qT) φ(d1) [2(r−q)T − d2 σ√T]/(2 T σ√T)
 *   Charm_put  = −q e^(−qT) N(−d1) − e^(−qT) φ(d1) [2(r−q)T − d2 σ√T]/(2 T σ√T)
 *            (charm = ∂Δ/∂t, delta decay per YEAR of calendar time; ÷365 for day)
 *
 * Where N(·) is the standard-normal CDF and φ(·) is the PDF.
 *
 * This primitive returns the full bundle in raw natural units (per 1.0
 * change in vol/rate, per year for theta). Callers wanting "per 1%" or
 * "per day" conventions divide accordingly — the `*ToPayload` helper
 * emits both forms for clarity.
 *
 * Numeric robustness:
 *   - Uses the Abramowitz-Stegun 26.2.17 rational approximation for N(·)
 *     (same approach as `barrierTradingThresholds.ts` and Giller port).
 *     Worst-case error ~7.5e-8, sufficient for all practical pricing.
 *   - At T = 0, returns intrinsic value and undefined Greeks (NaN). Caller
 *     should treat expired options separately.
 *   - At σ = 0 or near-zero, d1/d2 diverge — primitive throws to prevent
 *     spurious infinite Greeks. Caller should bound σ above ε.
 *
 * Verified against Hull (2017) "Options, Futures, and Other Derivatives"
 * Ch 15 example values to 4 decimal places in the test suite.
 *
 * Pure compute. No I/O. Deterministic.
 */

import { normalCdf } from "../../../core/numerics/index.ts";

export const BLACK_SCHOLES_GREEKS_FLAG_ENV = "GORDON_BLACK_SCHOLES_GREEKS";

export function isBlackScholesGreeksEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[BLACK_SCHOLES_GREEKS_FLAG_ENV] === "1" ||
    env[BLACK_SCHOLES_GREEKS_FLAG_ENV] === "true"
  );
}

export type OptionType = "call" | "put";

export interface BSInput {
  /** Spot price of underlying. */
  spot: number;
  /** Strike price. */
  strike: number;
  /** Time to expiry in years. */
  timeYears: number;
  /** Continuously-compounded risk-free rate. e.g. 0.05 = 5%. */
  rate: number;
  /** Annualized volatility (σ). e.g. 0.20 = 20%. Must be > 0. */
  volatility: number;
  /** Continuous dividend yield (q). Default 0. */
  dividendYield?: number;
  /** "call" or "put". */
  optionType: OptionType;
}

export interface BSResult {
  /** Option fair value. */
  price: number;
  /** d1 from the BS formula. */
  d1: number;
  /** d2 = d1 − σ √T. */
  d2: number;
  /** Delta: ∂Price/∂Spot. */
  delta: number;
  /** Gamma: ∂²Price/∂Spot² (same for call/put). */
  gamma: number;
  /** Vega: ∂Price/∂σ (per 1.0 vol change — divide by 100 for "per 1%"). */
  vega: number;
  /** Theta: ∂Price/∂t (per year — divide by 365 for "per day"). */
  theta: number;
  /** Rho: ∂Price/∂r (per 1.0 rate change — divide by 100 for "per 1%"). */
  rho: number;
  /** Vanna: ∂Δ/∂σ = ∂ν/∂S (per 1.0 vol change). Same for call/put. */
  vanna: number;
  /** Charm: ∂Δ/∂t — delta decay per YEAR of calendar time (÷365 for per day). */
  charm: number;
  /** Vomma (volga): ∂ν/∂σ — vega convexity (per 1.0 vol change). Same call/put. */
  vomma: number;
  reasoning: string;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard-normal PDF φ(x). */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Standard-normal CDF N(x) — shared `@stdlib`-backed implementation. */
function normalCDF(x: number): number {
  return normalCdf(x);
}

export function computeBlackScholesGreeks(input: BSInput): BSResult {
  const S = input.spot;
  const K = input.strike;
  const T = input.timeYears;
  const r = input.rate;
  const sigma = input.volatility;
  const q = input.dividendYield ?? 0;

  if (!Number.isFinite(S) || S <= 0) {
    throw new Error("spot must be positive and finite");
  }
  if (!Number.isFinite(K) || K <= 0) {
    throw new Error("strike must be positive and finite");
  }
  if (!Number.isFinite(T) || T < 0) {
    throw new Error("timeYears must be non-negative and finite");
  }
  if (!Number.isFinite(r)) throw new Error("rate must be finite");
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new Error("volatility must be positive (use ε if zero is intended)");
  }
  if (!Number.isFinite(q)) throw new Error("dividendYield must be finite");

  // Expired option: return intrinsic, NaN Greeks
  if (T === 0) {
    const intrinsic =
      input.optionType === "call"
        ? Math.max(S - K, 0)
        : Math.max(K - S, 0);
    return {
      price: intrinsic,
      d1: NaN,
      d2: NaN,
      delta: NaN,
      gamma: NaN,
      vega: NaN,
      theta: NaN,
      rho: NaN,
      vanna: NaN,
      charm: NaN,
      vomma: NaN,
      reasoning: `T=0; intrinsic ${intrinsic.toFixed(4)}; Greeks undefined`,
    };
  }

  const sqrtT = Math.sqrt(T);
  const sigSqrtT = sigma * sqrtT;
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / sigSqrtT;
  const d2 = d1 - sigSqrtT;

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const NmD1 = normalCDF(-d1);
  const NmD2 = normalCDF(-d2);
  const phid1 = normalPDF(d1);

  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);

  let price: number;
  let delta: number;
  let theta: number;
  let rho: number;

  if (input.optionType === "call") {
    price = S * eqT * Nd1 - K * erT * Nd2;
    delta = eqT * Nd1;
    theta =
      -(S * eqT * phid1 * sigma) / (2 * sqrtT) -
      r * K * erT * Nd2 +
      q * S * eqT * Nd1;
    rho = K * T * erT * Nd2;
  } else {
    price = K * erT * NmD2 - S * eqT * NmD1;
    delta = eqT * (Nd1 - 1); // = -eqT * NmD1
    theta =
      -(S * eqT * phid1 * sigma) / (2 * sqrtT) +
      r * K * erT * NmD2 -
      q * S * eqT * NmD1;
    rho = -K * T * erT * NmD2;
  }

  const gamma = (eqT * phid1) / (S * sigSqrtT);
  const vega = S * eqT * phid1 * sqrtT;

  // Second-order cross-Greeks. vanna + vomma are call/put symmetric; charm
  // carries the option-type carry term (q·N(±d1)).
  const vanna = -eqT * phid1 * (d2 / sigma);
  const vomma = vega * ((d1 * d2) / sigma);
  // charm = ∂Δ/∂t (calendar time forward = −∂Δ/∂T), per year.
  const charmCommon = (eqT * phid1 * (2 * (r - q) * T - d2 * sigSqrtT)) / (2 * T * sigSqrtT);
  const charm =
    input.optionType === "call"
      ? q * eqT * Nd1 - charmCommon
      : -q * eqT * NmD1 - charmCommon;

  const reasoning =
    `BS ${input.optionType.toUpperCase()}: S=${S}, K=${K}, T=${T.toFixed(4)}, ` +
    `r=${r.toFixed(4)}, σ=${sigma.toFixed(4)}, q=${q.toFixed(4)}; ` +
    `price=${price.toFixed(4)}, Δ=${delta.toFixed(4)}, Γ=${gamma.toFixed(6)}, ` +
    `ν=${vega.toFixed(4)}, Θ=${theta.toFixed(4)}/yr, ρ=${rho.toFixed(4)}`;

  return { price, d1, d2, delta, gamma, vega, theta, rho, vanna, charm, vomma, reasoning };
}

export function blackScholesGreeksToPayload(
  result: BSResult,
  optionType: OptionType,
): Record<string, unknown> {
  const finite = (x: number, decimals: number): number | null =>
    Number.isFinite(x) ? Number(x.toFixed(decimals)) : null;
  return {
    kind: "black_scholes_greeks.computed",
    optionType,
    price: finite(result.price, 6),
    delta: finite(result.delta, 6),
    gamma: finite(result.gamma, 8),
    // Conventional "per 1% vol" / "per day" / "per 1% rate" forms
    vegaPerOneVol: finite(result.vega, 6),
    vegaPerPercent: finite(result.vega / 100, 6),
    thetaPerYear: finite(result.theta, 6),
    thetaPerDay: finite(result.theta / 365, 6),
    rhoPerOneRate: finite(result.rho, 6),
    rhoPerPercent: finite(result.rho / 100, 6),
    d1: finite(result.d1, 6),
    d2: finite(result.d2, 6),
    vannaPerOneVol: finite(result.vanna, 6),
    vannaPerPercent: finite(result.vanna / 100, 8),
    charmPerYear: finite(result.charm, 6),
    charmPerDay: finite(result.charm / 365, 8),
    vomma: finite(result.vomma, 6),
  };
}

// ============================================================================
// Implied-volatility inversion
// ============================================================================

export interface ImpliedVolInput {
  /** Observed option premium to invert. */
  marketPrice: number;
  /** Spot price of underlying. */
  spot: number;
  /** Strike price. */
  strike: number;
  /** Time to expiry in years. */
  timeToExpiry: number;
  /** Continuously-compounded risk-free rate. e.g. 0.05 = 5%. */
  riskFreeRate: number;
  /** Continuous dividend yield (q). Default 0. */
  dividendYield?: number;
  /** "call" or "put". */
  optionType: OptionType;
}

export interface ImpliedVolResult {
  /** Recovered annualized volatility, or null if not invertible. */
  iv: number | null;
  /** Which solver succeeded (or "failed"). */
  method: "newton" | "bisection" | "failed";
  /** Total iterations consumed across the solve. */
  iterations: number;
  interpretation: string;
}

const IV_SIGMA_MIN = 1e-6;
const IV_SIGMA_MAX = 5.0;
const IV_TOL = 1e-8;
const IV_MAX_ITERS = 100;

function clampSigma(s: number): number {
  if (s < IV_SIGMA_MIN) return IV_SIGMA_MIN;
  if (s > IV_SIGMA_MAX) return IV_SIGMA_MAX;
  return s;
}

/**
 * Invert an observed option price to its Black-Scholes implied volatility.
 *
 * Newton-Raphson on price(sigma) - marketPrice using the module's own pricer
 * + vega, with a bisection fallback bracketing sigma in [1e-6, 5.0]. Returns
 * iv=null / method "failed" when the price is below intrinsic value, any
 * input is non-positive/non-finite, or neither solver converges.
 *
 * Boundary-only validation: never throws. Reuses computeBlackScholesGreeks
 * for both price and vega (no reimplementation of pricing math).
 */
export function impliedVolatility(input: ImpliedVolInput): ImpliedVolResult {
  const S = input.spot;
  const K = input.strike;
  const T = input.timeToExpiry;
  const r = input.riskFreeRate;
  const q = input.dividendYield ?? 0;
  const target = input.marketPrice;
  const optionType = input.optionType;

  const fail = (why: string, iters = 0): ImpliedVolResult => ({
    iv: null,
    method: "failed",
    iterations: iters,
    interpretation: `IV inversion failed: ${why}`,
  });

  if (!Number.isFinite(target) || target < 0) return fail("non-finite or negative market price");
  if (!Number.isFinite(S) || S <= 0) return fail("spot must be positive and finite");
  if (!Number.isFinite(K) || K <= 0) return fail("strike must be positive and finite");
  if (!Number.isFinite(T) || T <= 0) return fail("timeToExpiry must be positive and finite");
  if (!Number.isFinite(r)) return fail("riskFreeRate must be finite");
  if (!Number.isFinite(q)) return fail("dividendYield must be finite");

  // No-arbitrage lower bound. Below the discounted intrinsic the price is
  // not attainable by any sigma >= 0 - inversion has no solution.
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  const lowerBound =
    optionType === "call"
      ? Math.max(S * eqT - K * erT, 0)
      : Math.max(K * erT - S * eqT, 0);
  if (target < lowerBound - 1e-9) {
    return fail(
      `market price ${target.toFixed(6)} below intrinsic lower bound ${lowerBound.toFixed(6)}`,
    );
  }

  const greeksAt = (sigma: number): { price: number; vega: number } => {
    const g = computeBlackScholesGreeks({
      spot: S,
      strike: K,
      timeYears: T,
      rate: r,
      volatility: sigma,
      dividendYield: q,
      optionType,
    });
    return { price: g.price, vega: g.vega };
  };
  const priceAt = (sigma: number): number => greeksAt(sigma).price;

  let iterations = 0;

  // Newton-Raphson. Seed near a typical vol; clamp each step into the band.
  let sigma = 0.2;
  for (let i = 0; i < IV_MAX_ITERS; i++) {
    iterations++;
    const { price, vega } = greeksAt(sigma);
    const diff = price - target;
    if (Math.abs(diff) < IV_TOL) {
      const iv = parseFloat(clampSigma(sigma).toFixed(8));
      return {
        iv,
        method: "newton",
        iterations,
        interpretation: `Implied vol ${(iv * 100).toFixed(2)}% (Newton, ${iterations} iters) for ${optionType} @ K=${K}, T=${T.toFixed(4)}`,
      };
    }
    if (!Number.isFinite(vega) || vega < 1e-12) break; // vega vanished - hand off to bisection
    const next = clampSigma(sigma - diff / vega);
    if (!Number.isFinite(next)) break;
    sigma = next;
  }

  // Bisection fallback over the full band. f(sigma) = price(sigma) - target is
  // monotone increasing in sigma, so a sign change brackets the root.
  let lo = IV_SIGMA_MIN;
  let hi = IV_SIGMA_MAX;
  let fLo = priceAt(lo) - target;
  const fHi = priceAt(hi) - target;
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) {
    return fail(
      `target price not bracketed by sigma in [${IV_SIGMA_MIN}, ${IV_SIGMA_MAX}] (no convergence)`,
      iterations,
    );
  }

  for (let i = 0; i < IV_MAX_ITERS; i++) {
    iterations++;
    const mid = 0.5 * (lo + hi);
    const fMid = priceAt(mid) - target;
    if (Math.abs(fMid) < IV_TOL || (hi - lo) * 0.5 < IV_TOL) {
      const iv = parseFloat(clampSigma(mid).toFixed(8));
      return {
        iv,
        method: "bisection",
        iterations,
        interpretation: `Implied vol ${(iv * 100).toFixed(2)}% (bisection, ${iterations} iters) for ${optionType} @ K=${K}, T=${T.toFixed(4)}`,
      };
    }
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return fail(`no convergence within ${IV_MAX_ITERS} bisection iterations`, iterations);
}

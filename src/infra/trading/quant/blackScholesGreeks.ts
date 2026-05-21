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
  reasoning: string;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard-normal PDF φ(x). */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard-normal CDF N(x). Abramowitz & Stegun 26.2.17 rational
 * approximation. Worst-case absolute error ~7.5e-8.
 */
function normalCDF(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  // Constants
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const t = 1 / (1 + p * ax);
  const poly = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t;
  const cdfPositive = 1 - normalPDF(ax) * poly;
  return sign > 0 ? cdfPositive : 1 - cdfPositive;
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

  const reasoning =
    `BS ${input.optionType.toUpperCase()}: S=${S}, K=${K}, T=${T.toFixed(4)}, ` +
    `r=${r.toFixed(4)}, σ=${sigma.toFixed(4)}, q=${q.toFixed(4)}; ` +
    `price=${price.toFixed(4)}, Δ=${delta.toFixed(4)}, Γ=${gamma.toFixed(6)}, ` +
    `ν=${vega.toFixed(4)}, Θ=${theta.toFixed(4)}/yr, ρ=${rho.toFixed(4)}`;

  return { price, d1, d2, delta, gamma, vega, theta, rho, reasoning };
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
  };
}

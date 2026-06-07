/**
 * Avellaneda-Stoikov (2008) market-making calibration helpers.
 *
 * The core finite-horizon A-S model (reservation skew −qγσ²(T−t) + spread
 * γσ²(T−t)+(2/γ)ln(1+γ/k)) lives in `inventory-adjusted-spread.ts`. This adds the
 * two pieces that module assumes as operator inputs:
 *
 *   1. computeASIntensityCalibration — derives the fill-intensity constants
 *      A, k of λ(δ)=A·exp(−kδ) from order-flow statistics (eqs 9-12), so the
 *      spread/optimal-depth tools run on measured parameters, not guesses.
 *   2. computeASStationaryReservation — the infinite-horizon (no terminal T)
 *      stationary reservation prices (§2.3), for always-on market-making where
 *      there is no natural horizon.
 *
 * Formulas verified verbatim against the paper. Pure; never throws.
 */

export interface ASIntensityInput {
  /** Total volume traded over the day. */
  dailyVolume: number;
  /** Average market-order size that day. */
  avgOrderSize: number;
  /** Power-law size exponent α (order-size density ∝ x^(−1−α); ≈ 1.3–1.5). */
  sizeExponentAlpha: number;
  /** Log-impact slope κ in Δp = κ·ln(Q) (price move per unit log-size). */
  impactCoef: number;
}

export interface ASIntensityResult {
  /** Λ = market-order frequency = dailyVolume / avgOrderSize. */
  marketOrderFrequency: number;
  /** A in λ(δ)=A·exp(−kδ);  A = Λ/α. */
  A: number;
  /** k in λ(δ)=A·exp(−kδ);  k = α/κ (κ = the Δp=κ·ln(Q) slope). */
  k: number;
  interpretation: string;
}

const round = (x: number, p = 6): number => parseFloat(x.toFixed(p));

export function computeASIntensityCalibration(input: ASIntensityInput): ASIntensityResult {
  const { dailyVolume, avgOrderSize, sizeExponentAlpha: alpha, impactCoef: kappa } = input;
  if (!(avgOrderSize > 0) || !(alpha > 0) || !(kappa > 0) || !(dailyVolume > 0)) {
    return {
      marketOrderFrequency: 0,
      A: 0,
      k: 0,
      interpretation: "invalid inputs (need dailyVolume, avgOrderSize, α, κ all > 0)",
    };
  }
  const lambda = dailyVolume / avgOrderSize; // Λ
  const A = lambda / alpha;
  const k = alpha / kappa; // k = α/κ where κ is the Δp=κ·ln(Q) slope
  return {
    marketOrderFrequency: round(lambda, 4),
    A: round(A, 4),
    k: round(k, 6),
    interpretation:
      `λ(δ)=A·exp(−kδ): Λ=${round(lambda, 2)} (vol/order-size), A=${round(A, 2)}, k=${round(k, 4)}. ` +
      `Feed A,k into inventory_adjusted_spread / optimalLimitDepth (κ = the Δp=κ·ln(Q) impact slope).`,
  };
}

export interface ASStationaryInput {
  /** Mid price s. */
  midPrice: number;
  /** Inventory q (positive = long). */
  inventory: number;
  /** Risk-aversion γ. */
  gamma: number;
  /** Volatility σ. */
  sigma: number;
  /** Max inventory the agent may hold. */
  qMax: number;
}

export interface ASStationaryResult {
  /** Ask-side reservation price (null when at the short cap, diverges). */
  reservationAsk: number | null;
  /** Bid-side reservation price (null when at the long cap, diverges). */
  reservationBid: number | null;
  /** Mid of the two reservations (null if either side capped). */
  reservationMid: number | null;
  /** reservationMid − s: inventory skew (negative when long → quote down to sell). */
  inventorySkew: number | null;
  omega: number;
  valid: boolean;
  /** True when |q| has reached the cap and one side's reservation diverges. */
  atCap: boolean;
  interpretation: string;
}

export function computeASStationaryReservation(input: ASStationaryInput): ASStationaryResult {
  const { midPrice: s, inventory: q, gamma: g, sigma: sig, qMax } = input;
  const invalid = (reason: string): ASStationaryResult => ({
    reservationAsk: null,
    reservationBid: null,
    reservationMid: null,
    inventorySkew: null,
    omega: 0,
    valid: false,
    atCap: false,
    interpretation: reason,
  });
  if (!(g > 0) || !(sig > 0) || !(qMax > 0)) {
    return invalid("invalid inputs (need gamma, sigma, qMax all > 0)");
  }

  const g2s2 = g * g * sig * sig; // γ²σ²
  const omega = 0.5 * g2s2 * (qMax + 1) * (qMax + 1); // ω = ½γ²σ²(qmax+1)²
  const denom = 2 * omega - g2s2 * q * q; // 2ω − γ²σ²q²
  if (denom <= 0) {
    return { ...invalid(`inventory q=${q} beyond cap (2ω − γ²σ²q² ≤ 0)`), omega: round(omega), atCap: true, valid: false };
  }

  // r̃ᵃ = s + (1/γ)·ln(1 + (1−2q)·γ²σ²/denom);  r̃ᵇ uses (−1−2q).
  const askArg = 1 + ((1 - 2 * q) * g2s2) / denom;
  const bidArg = 1 + ((-1 - 2 * q) * g2s2) / denom;
  const EPS = 1e-12;
  const askValid = askArg > EPS;
  const bidValid = bidArg > EPS;
  const reservationAsk = askValid ? round(s + (1 / g) * Math.log(askArg)) : null;
  const reservationBid = bidValid ? round(s + (1 / g) * Math.log(bidArg)) : null;
  const atCap = !askValid || !bidValid || Math.abs(q) >= qMax;
  const reservationMid =
    reservationAsk !== null && reservationBid !== null ? round((reservationAsk + reservationBid) / 2) : null;
  const inventorySkew = reservationMid !== null ? round(reservationMid - s) : null;

  const interpretation =
    reservationMid !== null
      ? `stationary reservation: ask ${reservationAsk}, bid ${reservationBid}, mid ${reservationMid} ` +
        `(skew ${inventorySkew} vs s=${s}; ${q > 0 ? "long → quote down to sell" : q < 0 ? "short → quote up to buy" : "flat"})`
      : `at inventory cap (q=${q}, qMax=${qMax}) — ${!bidValid ? "bid" : "ask"} reservation diverges; stop quoting that side`;

  return {
    reservationAsk,
    reservationBid,
    reservationMid,
    inventorySkew,
    omega: round(omega),
    valid: reservationMid !== null,
    atCap,
    interpretation,
  };
}

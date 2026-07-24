/**
 * Cartea-Jaimungal Optimal Execution with Drift Signal — CJ1.
 *
 * Closed-form optimal trading speed when the operator has a constant
 * drift estimate μ for the asset's mid-price during the execution
 * horizon. Wraps a momentum/drift signal into a Hamilton-Jacobi-Bellman
 * (HJB) framework that produces analytically optimal trading speed,
 * generalizing TWAP and Almgren-Chriss in the presence of a directional
 * view.
 *
 * Model (Cartea, Jaimungal, Penalva 2015, Sec 6.5 / Drissi 2024 Sec 5):
 *   dS_t = μ dt + σ dW_t                (midprice with constant drift)
 *   dQ_t = -ν_t dt                       (inventory dynamics)
 *   Execution price per share = S_t + k·ν_t     (linear temporary impact)
 *   Objective: max E[X_T + Q_T·S_T − α·Q_T² − ∫ φ·Q_t² dt]
 *
 *   α = terminal liquidation penalty (large → forced liquidation)
 *   φ = running inventory penalty (≥0, urgency to flatten)
 *   k = linear impact coefficient
 *
 * Closed form (for fixed-direction execution, side ∈ {BUY,SELL}):
 *   τ = T - t                            (time remaining)
 *   κ = √(φ/k)                           (effective urgency rate)
 *   ν*_AC(t, q) = baseline Almgren-Chriss speed
 *   ν*(t, q, μ) = ν*_AC(t, q) + drift_adjustment(μ, k, τ) × sign(side)
 *
 * For φ = 0 (no running penalty), ν*_AC reduces to TWAP: q/τ.
 * For μ = 0 (no drift), reduces to standard Almgren-Chriss.
 *
 * Sign convention: returns trading SPEED (>0 always). The agent
 * interprets speed as buying or selling rate based on `side`.
 *
 * Pedigree: Cartea & Jaimungal (2015), "Algorithmic and High-Frequency
 * Trading," CUP. Drissi (2024) Oxford lecture notes, Section 5.
 *
 * Deferred extensions: stochastic mean-reverting drift (Casgrain-
 * Jaimungal 2019), transient impact (CJ2), non-linear impact, multi-
 * asset. See harness-deferred-wiring.md.
 */

export type Side = "BUY" | "SELL";

export interface CarteaJaimungalSignalInput {
  /** Time remaining in the execution horizon (positive, same units as drift). */
  timeRemaining: number;
  /** Inventory remaining to execute (positive — quantity yet to fill). */
  inventoryRemaining: number;
  /** BUY or SELL — direction of the parent order. */
  side: Side;
  /**
   * Drift estimate (units: price change per unit time). Positive μ means
   * the operator expects the mid-price to rise. Set 0 for the no-signal
   * baseline (which reduces to TWAP / Almgren-Chriss).
   */
  driftEstimate: number;
  /** Linear temporary-impact coefficient k. Must be > 0. */
  impactCoef: number;
  /**
   * Running inventory penalty φ (≥0). 0 = no urgency, reduces to TWAP.
   * Higher φ = stronger urgency to flatten (Almgren-Chriss with risk
   * aversion). Default 0.
   */
  runningPenalty?: number;
}

export interface CarteaJaimungalSignalResult {
  /** Optimal trading speed (units per time). Always ≥ 0; combine with `side` for direction. */
  tradingSpeed: number;
  /** Baseline AC/TWAP speed (no drift). */
  baselineSpeed: number;
  /** Drift adjustment (signed: positive = "trade faster", negative = "trade slower"). */
  driftAdjustment: number;
  /** Effective urgency rate κ = √(φ/k). 0 when φ=0 (pure TWAP baseline). */
  urgencyRate: number;
  /** Implied finish time (inventoryRemaining / tradingSpeed) assuming constant speed. */
  impliedFinishTime: number;
  reasoning: string;
}

function sideMultiplier(side: Side): number {
  return side === "BUY" ? 1 : -1;
}

export function computeCarteaJaimungalSignalSpeed(
  input: CarteaJaimungalSignalInput,
): CarteaJaimungalSignalResult {
  if (input.timeRemaining <= 0) {
    throw new Error("timeRemaining must be > 0");
  }
  if (input.inventoryRemaining < 0) {
    throw new Error("inventoryRemaining must be ≥ 0");
  }
  if (input.impactCoef <= 0) {
    throw new Error("impactCoef must be > 0");
  }
  const phi = input.runningPenalty ?? 0;
  if (phi < 0) {
    throw new Error("runningPenalty must be ≥ 0");
  }

  const tau = input.timeRemaining;
  const q = input.inventoryRemaining;
  const k = input.impactCoef;

  const urgencyRate = phi > 0 ? Math.sqrt(phi / k) : 0;

  // Almgren-Chriss baseline. When φ=0, reduces to TWAP: q/τ.
  // When φ>0, baseline = κ · coth(κ · τ) · q.
  let baselineSpeed: number;
  if (urgencyRate === 0) {
    baselineSpeed = q / tau;
  } else {
    const kappaTau = urgencyRate * tau;
    // coth(x) = cosh(x)/sinh(x); stable form avoids overflow at large x.
    const coth = kappaTau > 30 ? 1 : (Math.exp(2 * kappaTau) + 1) / (Math.exp(2 * kappaTau) - 1);
    baselineSpeed = urgencyRate * coth * q;
  }

  // Drift adjustment. For constant drift μ over horizon τ:
  //   φ = 0:  adjustment = μ / (2k)
  //   φ > 0:  adjustment = μ/(2k) · (1 − sech(κτ))   [bounded form]
  // sech(κτ) → 0 as κτ → ∞, so high-urgency limits drift influence.
  // For a BUY, positive μ (price rising) → speed UP (positive adjustment).
  // For a SELL, positive μ (price rising) → speed DOWN (negative adjustment).
  const driftMagnitude = input.driftEstimate / (2 * k);
  let driftBoundedness: number;
  if (urgencyRate === 0) {
    driftBoundedness = 1;
  } else {
    const kappaTau = urgencyRate * tau;
    const sech = kappaTau > 30 ? 0 : 2 / (Math.exp(kappaTau) + Math.exp(-kappaTau));
    driftBoundedness = 1 - sech;
  }
  const driftAdjustment = driftMagnitude * driftBoundedness * sideMultiplier(input.side);

  // Combine. Floor speed at 0 — negative speed would mean reversing the
  // parent intent, which the caller did not authorize.
  const tradingSpeed = Math.max(0, baselineSpeed + driftAdjustment);
  const impliedFinishTime = tradingSpeed > 0 ? q / tradingSpeed : Infinity;

  const reasoning =
    `CJ ${input.side} q=${q.toFixed(2)} τ=${tau.toFixed(2)}: ` +
    `baseline=${baselineSpeed.toFixed(4)} (φ=${phi}, κ=${urgencyRate.toFixed(3)}) ` +
    `+ drift_adj=${driftAdjustment.toFixed(4)} (μ=${input.driftEstimate}, k=${k}) ` +
    `→ speed=${tradingSpeed.toFixed(4)}/unit_time, implied_finish=${impliedFinishTime.toFixed(2)}.`;

  return {
    tradingSpeed,
    baselineSpeed,
    driftAdjustment,
    urgencyRate,
    impliedFinishTime,
    reasoning,
  };
}

export function carteaJaimungalSignalToPayload(
  result: CarteaJaimungalSignalResult,
): Record<string, unknown> {
  return {
    kind: "cartea_jaimungal_signal.computed",
    tradingSpeed: Number(result.tradingSpeed.toFixed(6)),
    baselineSpeed: Number(result.baselineSpeed.toFixed(6)),
    driftAdjustment: Number(result.driftAdjustment.toFixed(6)),
    urgencyRate: Number(result.urgencyRate.toFixed(6)),
    impliedFinishTime: Number.isFinite(result.impliedFinishTime)
      ? Number(result.impliedFinishTime.toFixed(4))
      : null,
  };
}

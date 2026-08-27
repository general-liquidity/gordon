/**
 * Transient Market Impact (Obizhaeva-Wang) — CJ2.
 *
 * Computes residual market impact at time t given a history of fills,
 * under the exponential-decay model. Generalizes Gordon's existing
 * permanent sqrt-impact (`marketImpact.ts`) to a model where each fill's
 * price-push decays back toward the fundamental over a half-life.
 *
 * Model (Obizhaeva & Wang 2013):
 *   For a fill of signed size v_i at time t_i,
 *   residual impact at time t: η · v_i · exp(−λ·(t − t_i))
 *   where η is the per-share impact coefficient and λ = ln(2) / halfLife
 *   is the decay rate.
 *
 *   Total impact at time t: I(t) = η · Σ_i  v_i · exp(−λ·(t − t_i))
 *
 * Optional permanent component:
 *   I_perm(t) = η_perm · Σ_i v_i
 *   I_total(t) = I_perm(t) + I(t)
 *
 *   When η_perm = 0 (default), all impact is transient.
 *
 * Sign convention: signed size — positive = BUY (pushes price up),
 * negative = SELL (pushes price down). Resulting impact is signed in
 * the same direction.
 *
 * Pedigree: Obizhaeva & Wang (2013) "Optimal trading strategy and
 * supply/demand dynamics," Journal of Financial Markets. Treated as
 * the canonical transient-impact reference in Cartea-Jaimungal-Penalva
 * (2015) ch. 8 and Drissi (2024) Sec 8.
 *
 * Pure compute. No side effects, no I/O. Composes naturally with
 * `marketImpact.ts` capacitySweep + efficientTradingFrontier when a
 * more realistic decaying-impact cost model is needed.
 */

export interface Fill {
  /** Time of the fill (any consistent units — seconds, ms, "trade number"). */
  time: number;
  /**
   * Signed size. Positive = BUY (pushes price up); negative = SELL
   * (pushes price down). Absolute value is share/contract quantity.
   */
  signedSize: number;
}

export interface TransientImpactInput {
  /** Time at which to evaluate the residual impact. Must be ≥ all fill times. */
  now: number;
  /** History of fills. Order does not matter; the function sums over them. */
  fills: ReadonlyArray<Fill>;
  /**
   * Half-life of the transient-impact decay (same units as `time`/`now`).
   * Standard institutional half-lives: ~5-30 minutes for liquid equities,
   * seconds-to-minutes for crypto. Must be > 0.
   */
  halfLife: number;
  /** Per-share transient-impact coefficient (price units per share). Default 1. */
  transientCoef?: number;
  /** Per-share permanent-impact coefficient (price units per share). Default 0. */
  permanentCoef?: number;
}

export interface TransientImpactResult {
  /** Total impact at `now` = transientImpact + permanentImpact (signed, price units). */
  totalImpact: number;
  /** Residual transient component (decaying). */
  transientImpact: number;
  /** Cumulative permanent component (does not decay). */
  permanentImpact: number;
  /** Decay rate λ = ln(2) / halfLife. */
  decayRate: number;
  /** Number of fills with non-zero weight (age < ~5 half-lives). */
  effectiveFillCount: number;
  reasoning: string;
}

const LN2 = Math.log(2);

export function computeTransientImpact(input: TransientImpactInput): TransientImpactResult {
  if (input.halfLife <= 0) {
    throw new Error("halfLife must be > 0");
  }
  const transientCoef = input.transientCoef ?? 1;
  const permanentCoef = input.permanentCoef ?? 0;
  if (transientCoef < 0) {
    throw new Error("transientCoef must be ≥ 0");
  }
  if (permanentCoef < 0) {
    throw new Error("permanentCoef must be ≥ 0");
  }

  const decayRate = LN2 / input.halfLife;

  let transientSum = 0;
  let permanentSum = 0;
  let effectiveFillCount = 0;
  for (const fill of input.fills) {
    const age = input.now - fill.time;
    if (age < 0) {
      throw new Error(`Fill at time ${fill.time} is in the future relative to now=${input.now}`);
    }
    permanentSum += fill.signedSize;
    const weight = Math.exp(-decayRate * age);
    transientSum += fill.signedSize * weight;
    if (weight > 0.00674) {
      // > 5 half-lives → effectively decayed (exp(-5·ln2) ≈ 0.0312, exp(-7.4·ln2) ≈ 0.0067)
      effectiveFillCount++;
    }
  }

  const transientImpact = transientCoef * transientSum;
  const permanentImpact = permanentCoef * permanentSum;
  const totalImpact = transientImpact + permanentImpact;

  const reasoning =
    `Transient impact at t=${input.now.toFixed(2)} over ${input.fills.length} fills ` +
    `(${effectiveFillCount} effective, half-life=${input.halfLife}): ` +
    `transient=${transientImpact.toFixed(4)} + permanent=${permanentImpact.toFixed(4)} ` +
    `= total=${totalImpact.toFixed(4)} price units.`;

  return {
    totalImpact,
    transientImpact,
    permanentImpact,
    decayRate,
    effectiveFillCount,
    reasoning,
  };
}

export function transientImpactToPayload(result: TransientImpactResult): Record<string, unknown> {
  return {
    kind: "transient_impact.computed",
    totalImpact: Number(result.totalImpact.toFixed(6)),
    transientImpact: Number(result.transientImpact.toFixed(6)),
    permanentImpact: Number(result.permanentImpact.toFixed(6)),
    decayRate: Number(result.decayRate.toFixed(6)),
    effectiveFillCount: result.effectiveFillCount,
  };
}

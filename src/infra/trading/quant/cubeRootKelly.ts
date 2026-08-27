/**
 * Experimental Power-Law (Cube-Root) Kelly Position Sizing.
 *
 * Computes the position size for a given alpha and return variance using
 * Giller's power-law Kelly holding function:
 *
 *   h(α, σ²) = h₀ × (|α| / (2λσ²h₀))^β × sign(α)
 *
 * h₀ is the POSITION SCALE: the holding at which the power law and linear
 * Kelly agree. It is not cosmetic. `|α|/(2λσ²)` carries position units, and
 * raising a quantity with units to a fractional power is meaningless unless
 * it is first divided by a reference of the same units. Written without h₀
 * the expression is the h₀ = 1 special case with the unit silently assumed,
 * and because β ≤ 1 exponentiation then attenuates only above 1.0 and
 * AMPLIFIES everything below it: a linear Kelly of 0.01 became 0.215 (21.5x)
 * and 0.0001 became 0.046 (464x). With h₀ supplied, the ratio is 1.0 exactly
 * at h₀ and the curve attenuates above it, as intended.
 *
 * For β = 1 this is the classical Markowitz / linear-Kelly form. For β < 1
 * the holding function backs off from large signals — exactly the behaviour
 * required when returns are leptokurtotic (fat-tailed). Giller derives that
 * the optimal β under Laplace-distributed returns is ≈ 1/3 (cube-root
 * Kelly), and that this value is remarkably robust to the "ultra-violet
 * cut-off" used in the underlying integral.
 *
 * For β → 0 the function approaches a step function of height h₀ (sign of
 * alpha only). For β = 1 the function recovers linear Kelly. Choose β on tail
 * fatness: crypto markets are unambiguously fat-tailed (β < 1); equities
 * sit at roughly β ∈ [0.5, 0.7].
 *
 * Complements Gordon's existing `empiricalKelly.ts` which does bootstrap
 * cross-validation shrinkage but assumes the linear-Kelly shape.
 *
 * Source: Giller, "Essays on Trading Strategy" (2023), Essay 3.4.2.
 *
 * Pure compute. No I/O. This module is a research primitive and is not wired
 * into Gordon's live position-sizing path. There is deliberately no feature
 * flag for it: production adoption requires a separately reviewed choice of
 * position scale, cap, and calibration evidence rather than silently changing
 * the orders emitted by the existing empirical-Kelly path.
 */

export interface CubeRootKellyInput {
  /** Expected return (alpha). */
  alpha: number;
  /** Variance of returns (σ²). Must be positive. */
  returnVariance: number;
  /**
   * Position scale h₀, in the SAME units as the returned position. Required:
   * the power law is only dimensionally defined relative to a reference
   * holding. Set it to the holding the operator considers a full-size
   * position, so h₀ is the point where power-law and linear Kelly agree.
   */
  positionScale: number;
  /**
   * Maximum absolute position, in the SAME units as `positionScale`.
   * Required: this is a sizing function on a money path and the power law is
   * unbounded above, so the cap is not optional.
   */
  positionLimit: number;
  /** Kelly exponent β ∈ (0, 1]. Default 1/3 (cube-root Kelly per Giller's optimum). */
  exponent?: number;
  /** Market price of risk λ. Default 1/2 (asymptotic-Kelly = Markowitz). */
  riskAversion?: number;
}

export interface CubeRootKellyResult {
  /** Power-law Kelly position. */
  position: number;
  /** Equivalent linear Kelly position (β = 1) for comparison. */
  linearKellyPosition: number;
  /** Ratio position / linearKellyPosition — how much we are "backing off". */
  scaleFactor: number;
  /** Whether the position was clipped at the limit. */
  clipped: boolean;
  /** Exponent used. */
  exponentUsed: number;
  /** Position scale h₀ used, echoed so a reader can reproduce the number. */
  positionScaleUsed: number;
  reasoning: string;
}

const DEFAULT_EXPONENT = 1 / 3;
const DEFAULT_RISK_AVERSION = 0.5;

export function computeCubeRootKelly(input: CubeRootKellyInput): CubeRootKellyResult {
  const alpha = input.alpha;
  const variance = input.returnVariance;
  const beta = input.exponent ?? DEFAULT_EXPONENT;
  const lambda = input.riskAversion ?? DEFAULT_RISK_AVERSION;
  const scale = input.positionScale;
  const limit = input.positionLimit;

  if (variance <= 0) {
    throw new Error("returnVariance must be positive");
  }
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new Error("positionScale must be a positive finite number");
  }
  if (!Number.isFinite(limit)) {
    throw new Error("positionLimit must be finite");
  }
  if (beta <= 0 || beta > 1) {
    throw new Error("exponent must satisfy 0 < β ≤ 1");
  }
  if (lambda <= 0) {
    throw new Error("riskAversion must be positive");
  }
  if (limit < 0) {
    throw new Error("positionLimit must be non-negative");
  }

  const linearKelly = alpha / (2 * lambda * variance);
  const magnitude = Math.abs(linearKelly);

  // Divide by the scale before exponentiating, multiply back after: the
  // argument of the power is dimensionless and the result carries position
  // units. Skipping the scale is the h₀ = 1 assumption that turns the
  // function into an amplifier for every holding below one unit.
  let position = magnitude > 0 ? scale * (magnitude / scale) ** beta * Math.sign(alpha) : 0;
  let clipped = false;
  if (Math.abs(position) > limit) {
    position = limit * Math.sign(position);
    clipped = true;
  }

  // Scale factor relative to linear Kelly. Guard divide-by-zero for α = 0.
  const scaleFactor = Math.abs(linearKelly) > 0 ? position / linearKelly : 0;

  const reasoning =
    `α=${alpha.toFixed(6)}, σ²=${variance.toFixed(6)}, β=${beta.toFixed(3)}, h₀=${scale.toFixed(6)}; ` +
    `linear Kelly=${linearKelly.toFixed(6)}, power-law=${position.toFixed(6)}, ` +
    `scale=${scaleFactor.toFixed(3)}${clipped ? " (clipped)" : ""}`;

  return {
    position,
    linearKellyPosition: linearKelly,
    scaleFactor,
    clipped,
    exponentUsed: beta,
    positionScaleUsed: scale,
    reasoning,
  };
}

export function cubeRootKellyToPayload(result: CubeRootKellyResult): Record<string, unknown> {
  return {
    kind: "cube_root_kelly.computed",
    position: Number(result.position.toFixed(8)),
    linearKellyPosition: Number(result.linearKellyPosition.toFixed(8)),
    scaleFactor: Number(result.scaleFactor.toFixed(4)),
    exponent: Number(result.exponentUsed.toFixed(4)),
    positionScale: Number(result.positionScaleUsed.toFixed(8)),
    clipped: result.clipped,
  };
}

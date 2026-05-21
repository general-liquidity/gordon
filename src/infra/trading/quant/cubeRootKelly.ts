/**
 * Power-Law (Cube-Root) Kelly Position Sizing (GORDON_CUBE_ROOT_KELLY).
 *
 * Computes the position size for a given alpha and return variance using
 * Giller's power-law Kelly holding function:
 *
 *   h(α, σ²) = (|α| / (2λσ²))^β × sign(α)
 *
 * For β = 1 this is the classical Markowitz / linear-Kelly form. For β < 1
 * the holding function backs off from large signals — exactly the behaviour
 * required when returns are leptokurtotic (fat-tailed). Giller derives that
 * the optimal β under Laplace-distributed returns is ≈ 1/3 (cube-root
 * Kelly), and that this value is remarkably robust to the "ultra-violet
 * cut-off" used in the underlying integral.
 *
 * For β → 0 the function approaches a step function (sign of alpha only).
 * For β = 1 the function recovers linear Kelly. Choose β based on tail
 * fatness: crypto markets are unambiguously fat-tailed (β < 1); equities
 * sit at roughly β ∈ [0.5, 0.7].
 *
 * Complements Gordon's existing `empiricalKelly.ts` which does bootstrap
 * cross-validation shrinkage but assumes the linear-Kelly shape.
 *
 * Source: Giller, "Essays on Trading Strategy" (2023), Essay 3.4.2.
 *
 * Pure compute. No I/O.
 */

export const CUBE_ROOT_KELLY_FLAG_ENV = "GORDON_CUBE_ROOT_KELLY";

export function isCubeRootKellyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[CUBE_ROOT_KELLY_FLAG_ENV] === "1" ||
    env[CUBE_ROOT_KELLY_FLAG_ENV] === "true"
  );
}

export interface CubeRootKellyInput {
  /** Expected return (alpha). */
  alpha: number;
  /** Variance of returns (σ²). Must be positive. */
  returnVariance: number;
  /** Kelly exponent β ∈ (0, 1]. Default 1/3 (cube-root Kelly per Giller's optimum). */
  exponent?: number;
  /** Market price of risk λ. Default 1/2 (asymptotic-Kelly = Markowitz). */
  riskAversion?: number;
  /** Maximum absolute position. If positive, clips the result. Default Infinity. */
  positionLimit?: number;
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
  reasoning: string;
}

const DEFAULT_EXPONENT = 1 / 3;
const DEFAULT_RISK_AVERSION = 0.5;

export function computeCubeRootKelly(input: CubeRootKellyInput): CubeRootKellyResult {
  const alpha = input.alpha;
  const variance = input.returnVariance;
  const beta = input.exponent ?? DEFAULT_EXPONENT;
  const lambda = input.riskAversion ?? DEFAULT_RISK_AVERSION;
  const limit = input.positionLimit ?? Number.POSITIVE_INFINITY;

  if (variance <= 0) {
    throw new Error("returnVariance must be positive");
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

  let position = magnitude > 0 ? Math.pow(magnitude, beta) * Math.sign(alpha) : 0;
  let clipped = false;
  if (Math.abs(position) > limit) {
    position = limit * Math.sign(position);
    clipped = true;
  }

  // Scale factor relative to linear Kelly. Guard divide-by-zero for α = 0.
  const scaleFactor =
    Math.abs(linearKelly) > 0 ? position / linearKelly : 0;

  const reasoning =
    `α=${alpha.toFixed(6)}, σ²=${variance.toFixed(6)}, β=${beta.toFixed(3)}; ` +
    `linear Kelly=${linearKelly.toFixed(6)}, power-law=${position.toFixed(6)}, ` +
    `scale=${scaleFactor.toFixed(3)}${clipped ? " (clipped)" : ""}`;

  return {
    position,
    linearKellyPosition: linearKelly,
    scaleFactor,
    clipped,
    exponentUsed: beta,
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
    clipped: result.clipped,
  };
}

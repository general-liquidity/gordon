/**
 * Operator's Equation (GORDON_OPERATOR_EQUATION).
 *
 * Port of Ch 6 from Ryan Wright. Three competing voices a trader must
 * arbitrate on every decision:
 *
 *   Optimist  — edge model: "this setup has +0.40R expectancy"
 *   Pessimist — risk model: "you're already down 2.3% this week"
 *   Accountant — friction model: "round-trip costs 2.3 ticks"
 *
 * Compressed into a single equation:
 *
 *   Performance = (Expected Value × Optimal Exposure) − Friction
 *
 * EV is the average R-multiple per trade. Optimal exposure is position
 * size relative to risk capital. Friction is everything that eats edge
 * before it reaches the equity curve.
 *
 * Distinct from the individual sub-modules: this rolls up `pathDependentSizer`
 * (exposure), backtest expectancy stats (EV), and `frictionTracker` (friction)
 * into a single normalized score per trade or per strategy. Used as a derived
 * metric, not a primary control surface.
 *
 * Wright's diagnostic: traders fail by optimizing one variable while ignoring
 * the others. Edge-Chaser (high EV, no friction discipline), Size Junkie
 * (high exposure, no edge accuracy), Penny-Pincher (low friction, no
 * willingness to trade) — each model surfaces a different failure mode.
 */

export const OPERATOR_EQUATION_FLAG_ENV = "GORDON_OPERATOR_EQUATION";

export function isOperatorEquationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OPERATOR_EQUATION_FLAG_ENV] === "1" || env[OPERATOR_EQUATION_FLAG_ENV] === "true";
}

export interface OperatorEquationInput {
  /** Expected value per trade in R-multiples (e.g. 0.4 = +0.4R). */
  expectedValueR: number;
  /** Position size as a fraction of risk capital (e.g. 0.01 = 1%). */
  optimalExposureFraction: number;
  /** Friction per trade in R-multiples (e.g. 0.1 = 10% of one R eaten). */
  frictionR: number;
  /** Optional dollar risk capital — when provided, output also includes dollar performance. */
  riskCapitalUsd?: number;
}

export type FailureMode =
  | "none"
  | "edge_chaser"
  | "size_junkie"
  | "penny_pincher"
  | "negative_after_friction"
  | "underexposed";

export interface OperatorEquationResult {
  expectedValueR: number;
  optimalExposureFraction: number;
  frictionR: number;
  /** (EV × Exposure) − Friction, in R-units scaled by exposure. */
  performanceR: number;
  /** Same, expressed in dollars when riskCapitalUsd is provided. */
  performanceUsd: number | null;
  /** Friction as a fraction of gross expectancy. >0.4 = warning. */
  frictionRatio: number;
  /** Diagnostic of which variable is the operator's weak link. */
  failureMode: FailureMode;
  recommendation: string;
}

const EDGE_CHASER_FRICTION_RATIO = 0.4;
const SIZE_JUNKIE_EXPOSURE = 0.05;
const PENNY_PINCHER_EV_R = 0.05;
const UNDEREXPOSED_FRACTION = 0.002;

export function evaluateOperatorEquation(input: OperatorEquationInput): OperatorEquationResult {
  const gross = input.expectedValueR * input.optimalExposureFraction;
  const performanceR = gross - input.frictionR;
  const performanceUsd =
    input.riskCapitalUsd === undefined ? null : performanceR * input.riskCapitalUsd;

  const denomGross = Math.abs(gross);
  const frictionRatio = denomGross > 0 ? input.frictionR / denomGross : Number.POSITIVE_INFINITY;

  let failureMode: FailureMode = "none";
  let recommendation = "Three variables aligned — keep executing the system.";

  if (performanceR <= 0) {
    failureMode = "negative_after_friction";
    recommendation =
      "Net performance is non-positive after friction. Either edge is overstated, exposure is too low, or friction is eating the system.";
  } else if (frictionRatio >= EDGE_CHASER_FRICTION_RATIO) {
    failureMode = "edge_chaser";
    recommendation =
      "Friction eats a large share of gross edge. Trade less frequently or use limit orders more aggressively.";
  } else if (input.optimalExposureFraction >= SIZE_JUNKIE_EXPOSURE && input.expectedValueR <= 0.2) {
    failureMode = "size_junkie";
    recommendation =
      "Large exposure relative to modest edge. Reduce position size — Kelly assumes perfect knowledge of EV, which you don't have.";
  } else if (input.expectedValueR <= PENNY_PINCHER_EV_R && input.frictionR < gross * 0.05) {
    failureMode = "penny_pincher";
    recommendation =
      "Edge is marginal and friction is well-managed but performance is constrained by EV. Hunt for higher-quality setups instead of optimizing further on friction.";
  } else if (input.optimalExposureFraction <= UNDEREXPOSED_FRACTION) {
    failureMode = "underexposed";
    recommendation =
      "Exposure is sub-threshold. Even a real edge cannot compound at this size — bump base risk per trade closer to 0.5-1.0% of risk capital.";
  }

  return {
    expectedValueR: input.expectedValueR,
    optimalExposureFraction: input.optimalExposureFraction,
    frictionR: input.frictionR,
    performanceR,
    performanceUsd,
    frictionRatio,
    failureMode,
    recommendation,
  };
}

export function formatResult(result: OperatorEquationResult): string {
  const lines: string[] = [];
  lines.push(
    `Operator equation: EV ${result.expectedValueR.toFixed(2)}R × exposure ${(result.optimalExposureFraction * 100).toFixed(2)}% − friction ${result.frictionR.toFixed(3)}R = ${result.performanceR.toFixed(4)}R`,
  );
  if (result.performanceUsd !== null) {
    lines.push(`  Dollar performance/trade: $${result.performanceUsd.toFixed(2)}`);
  }
  if (result.failureMode !== "none") {
    lines.push(`  Failure mode: ${result.failureMode}`);
  }
  lines.push(`  ${result.recommendation}`);
  return lines.join("\n");
}

export function equationToPayload(result: OperatorEquationResult): Record<string, unknown> {
  return {
    kind: "operator_equation.evaluated",
    performanceR: Number(result.performanceR.toFixed(4)),
    performanceUsd:
      result.performanceUsd === null ? null : Number(result.performanceUsd.toFixed(2)),
    frictionRatio: Number.isFinite(result.frictionRatio)
      ? Number(result.frictionRatio.toFixed(3))
      : null,
    failureMode: result.failureMode,
  };
}

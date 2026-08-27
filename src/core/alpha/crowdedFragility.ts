/**
 * Crowded-Equilibrium Fragility Index (forward-looking, exit-first).
 *
 * A FORWARD-looking cascade-fragility score for a crowded trade, framed
 * as a prisoner's dilemma over the exit. The Aug-2007 quant-quake setup:
 * many funds hold the same crowded factor bet; the bet is fine while
 * everyone holds, but the door is small. The first to exit gets a good
 * price; the last eats the flush. That payoff structure makes "hold" an
 * unstable equilibrium - each participant's dominant move is to exit
 * first, and the synchronized rush IS the cascade.
 *
 * The index multiplies three independent conditions - all three are
 * required for a fragile equilibrium:
 *
 *   1. crowd concentration  - how one-sided the positioning is. Reuse
 *                             `crowdPositioning` netScore (signed [-1,+1]);
 *                             fragility uses its magnitude, flush direction
 *                             uses its sign.
 *   2. exit (il)liquidity   - crowded notional vs the depth/ADV available
 *                             to absorb the exit. A big position into a
 *                             thin door = many days to unwind = a wide,
 *                             slippage-heavy flush.
 *   3. shared-factor expo   - how correlated the crowded names are. If the
 *                             crowd is spread across uncorrelated bets, one
 *                             name's exit does not trigger the others'.
 *                             Shared factor exposure is what turns N exits
 *                             into ONE synchronized flush.
 *
 *   fragility = concentration x exitIlliquidity x sharedFactorExposure
 *
 * DISTINCT from the three existing detectors:
 *   - `crowdPositioning`   - single-asset contrarian SETUP (is the crowd
 *                            trapped?); this lifts it to a cross-sectional,
 *                            liquidity-aware CASCADE-fragility index.
 *   - `deleveraging-veto`  - fires DURING the flush (reactive per-cycle
 *                            oversold veto); this scores fragility BEFORE
 *                            the flush starts.
 *   - single-account cascade sims - one book's forced liquidation; this is
 *                            the complex-wide equilibrium.
 *
 * Pure function. Caller supplies the concentration score, the notional /
 * liquidity inputs, and the shared-factor estimate; no fetching, no
 * hardcoded universe.
 */

import type { CrowdPositioningVerdict } from "./crowdPositioning.ts";

export type FragilitySeverity = "stable" | "fragile" | "critical";
/** Direction of the eventual flush. Long-crowded exits DOWN, short-crowded UP. */
export type FlushDirection = "down" | "up" | null;

export interface CrowdedFragilityInputs {
  /**
   * Signed crowd-concentration score in [-1, +1] - reuse
   * `crowdPositioning` netScore. Positive = long-crowded (flush down),
   * negative = short-crowded (flush up). Fragility uses the magnitude.
   */
  crowdNetScore: number;
  /**
   * Aggregate notional held in the crowded trade, in the same unit as
   * `exitLiquidity`. Non-negative.
   */
  crowdedNotional: number;
  /**
   * Liquidity available to absorb the exit - average daily volume or book
   * depth, same unit as `crowdedNotional`. Must be > 0 to be usable; <= 0
   * is treated as a fully illiquid door.
   */
  exitLiquidity: number;
  /**
   * Shared-factor exposure of the crowded names in [0, 1]. 1 = the crowd
   * is one correlated bet (co-moves, exits together); 0 = independent
   * bets (no cross-contagion). Default 0.5 when not supplied.
   */
  sharedFactorExposure?: number;
}

export interface CrowdedFragilityOptions {
  /**
   * Max fraction of `exitLiquidity` that can be sold per day without
   * outsized impact. Sets the days-to-exit denominator. Default 0.20.
   */
  maxParticipationRate?: number;
  /**
   * Days-to-exit saturation scale (in days). illiquidity saturates as
   * days-to-exit grows past this. Default 3.
   */
  exitDaysScale?: number;
  /** fragilityScore at/above which severity is "fragile". Default 0.15. */
  fragileThreshold?: number;
  /** fragilityScore at/above which severity is "critical". Default 0.40. */
  criticalThreshold?: number;
}

export interface CrowdedFragilityResult {
  /** Cascade-fragility score in [0, 1]. Product of the three components. */
  fragilityScore: number;
  severity: FragilitySeverity;
  /** |crowdNetScore| clamped to [0, 1]. */
  concentration: number;
  /** Exit illiquidity in [0, 1] derived from days-to-exit. */
  exitIlliquidity: number;
  /** Shared-factor exposure used (echoes input or default). */
  sharedFactorExposure: number;
  /** Estimated days to fully unwind the crowded notional. */
  estimatedDaysToExit: number;
  /**
   * Prisoner's-dilemma first-mover advantage in [0, 1]: the incentive to
   * exit FIRST, = concentration x exitIlliquidity (independent of the
   * shared factor - the defect payoff exists pairwise before contagion).
   * High values mean "hold" is an unstable equilibrium.
   */
  firstMoverAdvantage: number;
  /** Expected flush direction from the sign of crowdNetScore. */
  expectedFlushDirection: FlushDirection;
  reasoning: string;
}

const DEFAULT_MAX_PARTICIPATION_RATE = 0.2;
const DEFAULT_EXIT_DAYS_SCALE = 3;
const DEFAULT_FRAGILE_THRESHOLD = 0.15;
const DEFAULT_CRITICAL_THRESHOLD = 0.4;

/** Concentration magnitude below which the flush direction is undefined. */
const DIRECTION_FLOOR = 0.05;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Compute the crowded-equilibrium fragility index. Pure function.
 */
export function computeCrowdedFragility(
  inputs: CrowdedFragilityInputs,
  options: CrowdedFragilityOptions = {},
): CrowdedFragilityResult {
  const maxParticipation = options.maxParticipationRate ?? DEFAULT_MAX_PARTICIPATION_RATE;
  const exitDaysScale = options.exitDaysScale ?? DEFAULT_EXIT_DAYS_SCALE;
  const fragileThreshold = options.fragileThreshold ?? DEFAULT_FRAGILE_THRESHOLD;
  const criticalThreshold = options.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD;

  const concentration = clamp01(Math.abs(inputs.crowdNetScore));
  const sharedFactorExposure = clamp01(inputs.sharedFactorExposure ?? 0.5);

  const notional = Math.max(
    0,
    Number.isFinite(inputs.crowdedNotional) ? inputs.crowdedNotional : 0,
  );
  const dailyCapacity = inputs.exitLiquidity > 0 ? inputs.exitLiquidity * maxParticipation : 0;

  let estimatedDaysToExit: number;
  let exitIlliquidity: number;
  if (dailyCapacity <= 0) {
    estimatedDaysToExit = notional > 0 ? Number.POSITIVE_INFINITY : 0;
    exitIlliquidity = notional > 0 ? 1 : 0;
  } else {
    estimatedDaysToExit = notional / dailyCapacity;
    exitIlliquidity = clamp01(1 - Math.exp(-estimatedDaysToExit / exitDaysScale));
  }

  const fragilityScore = concentration * exitIlliquidity * sharedFactorExposure;
  const firstMoverAdvantage = concentration * exitIlliquidity;

  let severity: FragilitySeverity;
  if (fragilityScore >= criticalThreshold) severity = "critical";
  else if (fragilityScore >= fragileThreshold) severity = "fragile";
  else severity = "stable";

  const expectedFlushDirection: FlushDirection =
    concentration < DIRECTION_FLOOR ? null : inputs.crowdNetScore > 0 ? "down" : "up";

  const reasoning = buildReasoning({
    severity,
    concentration,
    exitIlliquidity,
    sharedFactorExposure,
    estimatedDaysToExit,
    firstMoverAdvantage,
    expectedFlushDirection,
  });

  return {
    fragilityScore,
    severity,
    concentration,
    exitIlliquidity,
    sharedFactorExposure,
    estimatedDaysToExit,
    firstMoverAdvantage,
    expectedFlushDirection,
    reasoning,
  };
}

/**
 * Convenience wrapper that reuses a `crowdPositioning` verdict directly,
 * pulling its netScore as the concentration input.
 */
export function crowdedFragilityFromVerdict(
  verdict: Pick<CrowdPositioningVerdict, "netScore">,
  liquidity: Omit<CrowdedFragilityInputs, "crowdNetScore">,
  options: CrowdedFragilityOptions = {},
): CrowdedFragilityResult {
  return computeCrowdedFragility({ ...liquidity, crowdNetScore: verdict.netScore }, options);
}

function buildReasoning(parts: {
  severity: FragilitySeverity;
  concentration: number;
  exitIlliquidity: number;
  sharedFactorExposure: number;
  estimatedDaysToExit: number;
  firstMoverAdvantage: number;
  expectedFlushDirection: FlushDirection;
}): string {
  const days = Number.isFinite(parts.estimatedDaysToExit)
    ? `${parts.estimatedDaysToExit.toFixed(1)}d to exit`
    : "no exit liquidity";
  const dir =
    parts.expectedFlushDirection === null
      ? "no directional flush"
      : `expected flush ${parts.expectedFlushDirection}`;
  if (parts.severity === "stable") {
    return `Stable equilibrium: fragility low (concentration ${parts.concentration.toFixed(2)}, ${days}, shared-factor ${parts.sharedFactorExposure.toFixed(2)}). No prisoner's-dilemma pressure to exit first.`;
  }
  return `${parts.severity === "critical" ? "CRITICAL" : "Fragile"} crowded equilibrium: concentration ${parts.concentration.toFixed(2)} x illiquidity ${parts.exitIlliquidity.toFixed(2)} x shared-factor ${parts.sharedFactorExposure.toFixed(2)} (${days}). First-mover advantage ${parts.firstMoverAdvantage.toFixed(2)} makes "hold" unstable - each participant's dominant move is to exit first; ${dir}.`;
}

/** Operator-facing one-line summary. */
export function formatCrowdedFragility(result: CrowdedFragilityResult): string {
  return `Crowded fragility: ${result.severity.toUpperCase()} (score=${result.fragilityScore.toFixed(3)}, first-mover=${result.firstMoverAdvantage.toFixed(2)}). ${result.reasoning}`;
}

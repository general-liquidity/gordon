/**
 * Optimization-Tier Selector
 *
 * Routes a genome mutation by FEEDBACK SEVERITY rather than by tick count.
 * Ported from TiMi (arXiv:2510.04787, `feedback_reflection._determine_optimization_level`):
 *
 *   - critical risk / many stability errors  → STRUCTURE-level rewrite
 *     (the playbook is breaking — change its shape, not its knobs)
 *   - several parameter changes already tried → FUNCTION-level
 *     (params are exhausted; swap a method/indicator instead)
 *   - else                                    → PARAMETER-level
 *     (small/medium knob nudges)
 *
 * Each tier maps to an allowed mutation-type pool aligned to the mutation
 * types in `mutator.ts` (nudge / shift / swap / add / remove). `crossover`
 * is not a `Mutation["mutation_type"]` — it is a separate manager operation —
 * so it is surfaced via the `allowCrossover` flag on the structure tier.
 *
 * Pure + total: never throws, sensible defaults on missing inputs.
 */

import type { Mutation } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

export type OptimizationTier = "parameter" | "function" | "structure";

/** Mutation types from mutator.ts (subset of Mutation["mutation_type"]). */
type MutationType = Mutation["mutation_type"];

export interface OptimizationTierInput {
  /** A critical-risk feedback signal (e.g. volatile/high-volatility regime, blown drawdown). */
  criticalRisk?: boolean;
  /** Count of stability errors observed in this lineage's feedback. */
  stabilityErrors?: number;
  /** How many parameter-level mutations this lineage has already tried. */
  paramChangesTried?: number;
  /** Recent composite fitness scores for this lineage (oldest → newest). */
  fitnessHistory?: number[];
}

export interface OptimizationTierResult {
  tier: OptimizationTier;
  reason: string;
  /** Mutation-type pool permitted at this tier (aligned to mutator.ts names). */
  allowedMutationTypes: MutationType[];
  /** Structure tier may also use the manager-level crossover operation. */
  allowCrossover: boolean;
}

// ============================================================================
// Thresholds (tuned to TiMi's severity routing)
// ============================================================================

/** stabilityErrors above this → structure-level rewrite. */
const STABILITY_ERROR_STRUCTURE_THRESHOLD = 5;
/** paramChangesTried above this (params exhausted) → function-level. */
const PARAM_CHANGES_EXHAUSTED_THRESHOLD = 3;

/** Tier → allowed mutation-type pool. */
const TIER_MUTATION_POOL: Record<OptimizationTier, MutationType[]> = {
  // small/medium parameter perturbations
  parameter: ["nudge", "shift"],
  // replace one indicator/method with another
  function: ["swap"],
  // add/remove conditions — reshape the playbook (crossover via flag)
  structure: ["add", "remove"],
};

// ============================================================================
// Selector
// ============================================================================

/**
 * Select the optimization tier for a mutation given feedback-severity signals.
 *
 * Falls back to "parameter" when no severity signals are present, which keeps
 * the caller's existing param-nudge behavior intact (backward-compatible).
 */
export function selectOptimizationTier(
  input: OptimizationTierInput = {},
): OptimizationTierResult {
  const criticalRisk = input.criticalRisk === true;
  const stabilityErrors =
    typeof input.stabilityErrors === "number" && Number.isFinite(input.stabilityErrors)
      ? input.stabilityErrors
      : 0;
  const paramChangesTried =
    typeof input.paramChangesTried === "number" && Number.isFinite(input.paramChangesTried)
      ? input.paramChangesTried
      : 0;

  // --- Tier 1: structure (highest severity) ---
  if (criticalRisk || stabilityErrors > STABILITY_ERROR_STRUCTURE_THRESHOLD) {
    const why = criticalRisk
      ? "critical-risk feedback"
      : `${stabilityErrors} stability errors (> ${STABILITY_ERROR_STRUCTURE_THRESHOLD})`;
    return {
      tier: "structure",
      reason: `Structure-level rewrite: ${why} — reshaping the playbook (add/remove/crossover)`,
      allowedMutationTypes: [...TIER_MUTATION_POOL.structure],
      allowCrossover: true,
    };
  }

  // --- Tier 2: function (params exhausted, not improving) ---
  if (paramChangesTried > PARAM_CHANGES_EXHAUSTED_THRESHOLD && !isImproving(input.fitnessHistory)) {
    return {
      tier: "function",
      reason: `Function-level: ${paramChangesTried} param changes tried (> ${PARAM_CHANGES_EXHAUSTED_THRESHOLD}) without improving fitness — swapping indicator/method`,
      allowedMutationTypes: [...TIER_MUTATION_POOL.function],
      allowCrossover: false,
    };
  }

  // --- Tier 3: parameter (default / low severity) ---
  return {
    tier: "parameter",
    reason:
      paramChangesTried > 0
        ? `Parameter-level: low severity, ${paramChangesTried} param changes tried (fitness still moving) — continuing parameter tuning`
        : "Parameter-level: no severity signals — default parameter tuning",
    allowedMutationTypes: [...TIER_MUTATION_POOL.parameter],
    allowCrossover: false,
  };
}

/**
 * Filter a candidate mutation list down to the tier's allowed pool.
 * If filtering would empty the list, the originals are returned unchanged so
 * the caller never loses a fork tick to an over-aggressive tier gate.
 */
export function filterMutationsByTier(
  mutations: Mutation[],
  result: OptimizationTierResult,
): Mutation[] {
  if (mutations.length === 0) return mutations;
  const allowed = new Set<MutationType>(result.allowedMutationTypes);
  const kept = mutations.filter((m) => allowed.has(m.mutation_type));
  return kept.length > 0 ? kept : mutations;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Is the lineage's fitness improving? Compares the most recent score against
 * the prior one. Missing/short history → treated as "not improving" so the
 * function-tier escalation can trigger once params are exhausted.
 */
function isImproving(fitnessHistory?: number[]): boolean {
  if (!fitnessHistory || fitnessHistory.length < 2) return false;
  const last = fitnessHistory[fitnessHistory.length - 1];
  const prev = fitnessHistory[fitnessHistory.length - 2];
  if (last == null || prev == null) return false;
  return last > prev;
}

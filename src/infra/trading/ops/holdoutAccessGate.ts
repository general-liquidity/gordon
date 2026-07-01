/**
 * Block-vs-Deflate Holdout Access Gate.
 *
 * `multipleTestingTracker.ts` guards optimizer overfitting STATISTICALLY: it
 * counts trials and deflates the Sharpe bar so a strategy dredged from 10,000
 * attempts must clear a higher hurdle. That penalizes leakage post-hoc.
 *
 * This gate is different in kind — a HARD structural barrier that prevents the
 * leakage instead of pricing it in afterward. The optimizer (genetic /
 * annealing / sandbox loop) declares, per data split, whether the split is
 * `trainable` (may be selected on) or `locked` (out-of-sample / test — must
 * never be touched by the search), plus an optional per-split eval budget.
 * `canEvaluate` returns a deny for a locked split or an exhausted budget, so
 * the search structurally cannot fit to held-out data or grind a split into
 * an unbounded multiple-testing burden.
 *
 * Pure. All state is injected: the caller owns the usage counters and threads
 * the returned state forward (last-write-wins is the caller's concern). This
 * composes onto the multiple-testing tracker — the gate says "may I look at
 * this split at all", the tracker says "given how many times I already looked,
 * how high is the bar".
 */

export type SplitAccess = "trainable" | "locked";

export interface SplitPolicy {
  /** Split label — e.g. "train", "validation", "test", "oos". */
  split: string;
  access: SplitAccess;
  /**
   * Max evaluations permitted on this split. Undefined = unbounded (only
   * meaningful for a trainable split; a locked split is denied regardless).
   */
  budget?: number;
}

export interface HoldoutAccessConfig {
  policies: SplitPolicy[];
}

export interface EvalState {
  /** Evaluations already consumed, keyed by split label. */
  usage: Record<string, number>;
}

export type AccessDenyReason = "locked" | "budget_exhausted" | "unknown_split";

export type AccessDecision =
  | { allowed: true; split: string; remaining: number | null }
  | { allowed: false; split: string; reason: AccessDenyReason };

export function emptyEvalState(): EvalState {
  return { usage: {} };
}

function findPolicy(config: HoldoutAccessConfig, split: string): SplitPolicy | undefined {
  return config.policies.find((p) => p.split === split);
}

/**
 * Decide whether the optimizer may evaluate on `split` given the current
 * usage. Deny-first: an unknown split is denied, not implicitly trainable.
 */
export function canEvaluate(
  config: HoldoutAccessConfig,
  split: string,
  state: EvalState,
): AccessDecision {
  const policy = findPolicy(config, split);
  if (!policy) return { allowed: false, split, reason: "unknown_split" };
  if (policy.access === "locked") return { allowed: false, split, reason: "locked" };

  const used = state.usage[split] ?? 0;
  if (policy.budget !== undefined && used >= policy.budget) {
    return { allowed: false, split, reason: "budget_exhausted" };
  }

  const remaining = policy.budget === undefined ? null : policy.budget - used;
  return { allowed: true, split, remaining };
}

/**
 * Record one evaluation against a split, returning a NEW state (the input is
 * not mutated). Records usage regardless of policy so an audit reflects every
 * attempted look; gate first with `canEvaluate` to enforce the barrier.
 */
export function recordEvaluation(state: EvalState, split: string): EvalState {
  return {
    usage: { ...state.usage, [split]: (state.usage[split] ?? 0) + 1 },
  };
}

/** True only when the split is trainable AND within budget. Convenience over `canEvaluate`. */
export function isEvaluable(
  config: HoldoutAccessConfig,
  split: string,
  state: EvalState,
): boolean {
  return canEvaluate(config, split, state).allowed;
}

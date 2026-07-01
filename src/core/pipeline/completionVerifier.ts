/**
 * Completion verifier seam (A1) — independent gate on the `achieved` seal.
 *
 * The autonomous loop's only path to "done" was self-scored `scoreGoal`: the
 * agent grades its own homework and seals `achieved`, the exact
 * premature-completion-by-self-report failure the Zenith harness report
 * isolates. This module adds a pluggable {@link CompletionVerifier} that must
 * INDEPENDENTLY confirm before a goal is sealed achieved. If the verifier
 * fails to confirm, "done" is invalidated and the loop keeps working.
 *
 * The default verifier re-checks the per-cycle unmet-requirement set (A2):
 * completion is confirmed only when there are zero outstanding requirements
 * AND the self-score's end-state / constraint checks agree. This is a separate
 * recomputation from `scoreGoal`'s own status decision — the two must AGREE,
 * so a bug or optimism in one is caught by the other.
 *
 * The seam is deliberately pluggable: a Pro/gateway build can inject a heavier
 * verifier (the offline eval machinery Gordon already owns — the PoLL panel,
 * `checkTrajectory`, `verify_plan`) as an in-loop stop gate without touching
 * the loop. Set one via {@link setCompletionVerifier}.
 *
 * This ADDS a stop condition before `achieved`; it never relaxes an existing
 * stop, the risk gate, or the deny-list.
 */

import type { ParsedGoal, GoalObservation, GoalScore } from "./goalMode.ts";
import type { GoalRequirement } from "./goalGapFinding.ts";
import { unmetRequirements, summarizeGaps } from "./goalGapFinding.ts";

export interface CompletionContext {
  goal: ParsedGoal;
  score: GoalScore;
  observation: GoalObservation;
  /** The full requirement set derived this cycle (A2). */
  requirements: GoalRequirement[];
  /** 1-based cycle/iteration index. */
  cycle: number;
}

export interface CompletionVerdict {
  /** Identifier of the verifier that produced this verdict. */
  verifierId: string;
  /** True iff completion is independently confirmed. */
  confirmed: boolean;
  /** Requirements the verifier still considers outstanding. */
  unmet: GoalRequirement[];
  rationale: string;
}

export interface CompletionVerifier {
  id: string;
  verify(ctx: CompletionContext): CompletionVerdict | Promise<CompletionVerdict>;
}

/**
 * Default verifier: confirm only when the derived requirement set is fully
 * met AND the self-score's own end-state + constraint checks agree. Both
 * signals are recomputed independently of `recordGoalProgress`, so this is a
 * genuine cross-check rather than a rubber stamp of the self-score.
 */
export const requirementCompletionVerifier: CompletionVerifier = {
  id: "requirement-set-v1",
  verify(ctx: CompletionContext): CompletionVerdict {
    const unmet = unmetRequirements(ctx.requirements);
    const selfScoreAgrees = ctx.score.endStateMet && ctx.score.constraintsHeld;
    const confirmed = unmet.length === 0 && selfScoreAgrees;
    const rationale = confirmed
      ? `completion confirmed: all requirements met and self-score agrees (end state met, constraints held)`
      : unmet.length > 0
        ? `completion blocked: ${unmet.length} outstanding requirement(s) — ${summarizeGaps(unmet)}`
        : `completion blocked: self-score does not confirm (endStateMet=${ctx.score.endStateMet}, constraintsHeld=${ctx.score.constraintsHeld})`;
    return { verifierId: this.id, confirmed, unmet, rationale };
  },
};

let activeVerifier: CompletionVerifier = requirementCompletionVerifier;

/** Inject a custom completion verifier (Pro/gateway builds, or tests). */
export function setCompletionVerifier(verifier: CompletionVerifier): void {
  activeVerifier = verifier;
}

/** Reset the seam to the default requirement-set verifier. */
export function resetCompletionVerifier(): void {
  activeVerifier = requirementCompletionVerifier;
}

/** The verifier the loop will consult before sealing `achieved`. */
export function getCompletionVerifier(): CompletionVerifier {
  return activeVerifier;
}

/**
 * Run a verifier, normalizing sync/async and never throwing. A verifier that
 * throws is treated as NON-confirmation (fail-closed): a broken verifier must
 * never let a premature completion through.
 */
export async function verifyCompletion(
  verifier: CompletionVerifier,
  ctx: CompletionContext,
): Promise<CompletionVerdict> {
  try {
    return await verifier.verify(ctx);
  } catch (err) {
    return {
      verifierId: verifier.id,
      confirmed: false,
      unmet: unmetRequirements(ctx.requirements),
      rationale: `verifier error (fail-closed, not sealing achieved): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

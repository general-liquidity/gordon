/**
 * Per-cycle gap-finding for goal mode (A2).
 *
 * Re-derives the UNMET-REQUIREMENT set of the original goal each cycle, not
 * just a scalar progress %. This is the input the completion verifier (A1)
 * consumes: an independent gate cannot confirm "done" without knowing what,
 * concretely, is still outstanding. Named RALPH's single strongest mechanism
 * by the Zenith harness report.
 *
 * A requirement is a discrete, checkable clause of the goal: the measurable
 * end state, plus one requirement per constraint violated THIS cycle. The set
 * is re-derived every cycle from the fresh observation + score, so it tracks
 * the live state of the mandate rather than a frozen upfront checklist.
 *
 * Pure; never throws.
 */

import type { ParsedGoal, GoalObservation, GoalScore } from "./goalMode.ts";

export type RequirementKind = "end_state" | "constraint";

export interface GoalRequirement {
  /** Stable id within a cycle, e.g. "end_state:sharpe" or "constraint:0". */
  id: string;
  kind: RequirementKind;
  /** Human-readable description of the clause. */
  description: string;
  /** True when this cycle's observation satisfies the clause. */
  met: boolean;
  /** Why it is (or is not) met. */
  detail: string;
}

/**
 * Derive the full requirement set for one cycle. Includes met AND unmet
 * requirements so callers can report coverage; use {@link unmetRequirements}
 * to filter to the outstanding gaps the verifier gates on.
 */
export function deriveRequirements(
  goal: ParsedGoal,
  obs: GoalObservation,
  score: GoalScore,
): GoalRequirement[] {
  const reqs: GoalRequirement[] = [];

  // End-state requirement. A goal with no measurable end state is treated as
  // outstanding by construction — a custom/operator-scored goal must not be
  // auto-sealed as achieved by the loop.
  if (goal.endState) {
    const es = goal.endState;
    const label =
      es.threshold !== undefined
        ? `${es.metric ?? es.type} >= ${es.threshold}`
        : es.type;
    reqs.push({
      id: `end_state:${es.type}`,
      kind: "end_state",
      description: label,
      met: score.endStateMet,
      detail: score.rationale || (score.endStateMet ? "end state met" : "end state not yet met"),
    });
  } else {
    reqs.push({
      id: "end_state:custom",
      kind: "end_state",
      description: goal.objective || "objective",
      met: false,
      detail: "no measurable end state defined; requires manual confirmation",
    });
  }

  // One unmet requirement per constraint violation observed this cycle. A
  // declared constraint that held this cycle is not an outstanding gap.
  const violations = obs.constraintViolations ?? [];
  violations.forEach((v, i) => {
    reqs.push({
      id: `constraint:${i}`,
      kind: "constraint",
      description: v,
      met: false,
      detail: `constraint violated this cycle: ${v}`,
    });
  });

  return reqs;
}

/** Filter a requirement set to the outstanding (unmet) gaps. */
export function unmetRequirements(reqs: GoalRequirement[]): GoalRequirement[] {
  return reqs.filter((r) => !r.met);
}

/** Compact one-line summary of the unmet set, for logs. */
export function summarizeGaps(unmet: GoalRequirement[]): string {
  if (unmet.length === 0) return "no outstanding requirements";
  return unmet.map((r) => `${r.id} (${r.description})`).join("; ");
}

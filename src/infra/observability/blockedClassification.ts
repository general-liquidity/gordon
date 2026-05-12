/**
 * Classify execution.blocked statuses as "controllable" (harness gate
 * caught the issue — fixable in our code) vs "uncontrollable"
 * (environment / external state missing — not actionable from harness
 * changes alone).
 *
 * HALO's empirical lesson from Terminal-Bench 2.0: this split makes the
 * eval review queue actionable instead of conflating regressions worth
 * fixing with environment errors out of scope. Surfacing controllable
 * blocks as a separate cohort lets the harness designer focus
 * attention.
 */

export type BlockedControllability = "controllable" | "uncontrollable";

const CONTROLLABLE_STATUSES = new Set<string>([
  // Anti-trap gates (commits f25b1b6e + a4244f95)
  "explain_first_missing_thesis",
  "risk_ack_insufficient",
  // Anti-rot gates
  "outside_trading_universe",
  "thesis_coherence_insufficient",
  "strategy_mandate_violation",
  // Risk kernel rejections — the harness saying "no" on policy grounds
  "risk_rejected",
]);

const UNCONTROLLABLE_STATUSES = new Set<string>([
  // External state missing — nothing the harness can change
  "exchange_missing",
  "plan_missing",
  // The risk gate itself crashed — environment instability
  "risk_gate_failed",
]);

export function classifyBlockedStatus(status: string): BlockedControllability {
  if (CONTROLLABLE_STATUSES.has(status)) return "controllable";
  if (UNCONTROLLABLE_STATUSES.has(status)) return "uncontrollable";
  // Permission-mode gates (paper_permission_mode, read_only_permission_mode,
  // strict_permission_mode, etc.) are policy gates → controllable.
  if (status.endsWith("_permission_mode")) return "controllable";
  // Unknown statuses default to controllable — fail-loud bias: a new
  // status that should be uncontrollable will surface as a "harness
  // regression candidate" in the review queue, prompting the author to
  // update this classifier. Better than silently swallowing.
  return "controllable";
}

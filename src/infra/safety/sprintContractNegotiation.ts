/**
 * Sprint Contract Negotiation (GORDON_SPRINT_CONTRACT_NEGOTIATION).
 *
 * Extends `sprintContract.ts` (T1) with the negotiation step from Anthropic's
 * "Harness Design for Long-Running Application Development" (2026):
 *
 *   "The generator proposed what it would build and how success would be
 *    verified, and the evaluator reviewed that proposal to make sure the
 *    generator was building the right thing."
 *
 * Today Gordon's sprint contract is operator-authored. This primitive
 * adds the *two-agent negotiation* pattern: a Proposer agent drafts the
 * contract from a high-level intent, and a Reviewer agent inspects the
 * draft before it gets accepted as the binding contract.
 *
 * The primitive is pure data + lifecycle. The Proposer and Reviewer
 * agents are caller-supplied (same posture as `harnessEvolution`'s
 * BlueprintHooks). The negotiation can converge after one round or run
 * multiple rounds with the Proposer revising in response to the
 * Reviewer's concerns.
 *
 * Boundaries this primitive preserves:
 *   - The Proposer and Reviewer agents both go through Gordon's normal
 *     safety stack — this is config negotiation, not execution.
 *   - The final accepted contract is the one stored via
 *     `sprintContract.ts`'s `createSprintContract` — this module does
 *     not duplicate the contract's persistence.
 */

import type { SprintContractDraft } from "./sprintContract.ts";

export const SPRINT_CONTRACT_NEGOTIATION_FLAG_ENV = "GORDON_SPRINT_CONTRACT_NEGOTIATION";

export interface SprintProposal {
  /** Identifier of the agent (or operator) that produced this draft. */
  proposedBy: string;
  /** Round number — 1 for the first proposal, 2+ for revisions. */
  round: number;
  /** ISO timestamp. */
  proposedAt: string;
  /** The drafted contract content — same shape as sprintContract.ts's input. */
  draft: SprintContractDraft;
  /** Free-form rationale that explains the choices in the draft. */
  rationale: string;
}

export type ReviewVerdict = "accept" | "request_changes" | "reject";

export interface SprintReview {
  reviewedBy: string;
  /** Round number this review responds to. */
  round: number;
  reviewedAt: string;
  verdict: ReviewVerdict;
  /** Specific concerns the reviewer raised. Empty when verdict==="accept". */
  concerns: string[];
  /** Concrete edits the reviewer requests, when verdict==="request_changes". */
  suggestedChanges?: Partial<SprintContractDraft>;
  /** Free-form rationale for the verdict. */
  rationale: string;
}

export interface NegotiationRound {
  proposal: SprintProposal;
  review: SprintReview;
}

export interface NegotiationOutcome {
  /**
   * Final accepted draft (when status === "accepted") or null (when
   * exhausted or rejected).
   */
  acceptedDraft: SprintContractDraft | null;
  status: "accepted" | "exhausted" | "rejected";
  /** Round at which negotiation terminated. */
  finalRound: number;
  /** Full history of rounds. */
  rounds: NegotiationRound[];
  /** Reviewer's concerns from the final round. */
  finalConcerns: string[];
}

export interface NegotiationHooks {
  /**
   * Generate the next proposal. Receives the prior rounds (empty on
   * first call) so the Proposer can address Reviewer concerns.
   */
  propose(rounds: readonly NegotiationRound[], intent: string): Promise<SprintProposal>;
  /**
   * Review a proposal. Pure adjudication — no mutation.
   */
  review(proposal: SprintProposal): Promise<SprintReview>;
}

export interface NegotiationOptions {
  /** Maximum rounds before exhausting. Default 3. */
  maxRounds?: number;
  /** Optional progress callback per round. */
  onRound?: (round: NegotiationRound) => void;
}

export function isSprintContractNegotiationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[SPRINT_CONTRACT_NEGOTIATION_FLAG_ENV] === "1" ||
    env[SPRINT_CONTRACT_NEGOTIATION_FLAG_ENV] === "true"
  );
}

/**
 * Run a propose→review→revise loop until either the Reviewer accepts,
 * the Reviewer rejects outright, or `maxRounds` is reached. Returns the
 * negotiation outcome with the full history of rounds.
 *
 * Termination semantics:
 *   - verdict "accept"          → status "accepted", acceptedDraft populated
 *   - verdict "reject"          → status "rejected", acceptedDraft null
 *   - verdict "request_changes" → continue to next round
 *   - rounds == maxRounds and last review !== accept → status "exhausted"
 */
export async function runNegotiation(
  hooks: NegotiationHooks,
  intent: string,
  opts: NegotiationOptions = {},
): Promise<NegotiationOutcome> {
  const maxRounds = opts.maxRounds ?? 3;
  if (maxRounds < 1) throw new Error("maxRounds must be >= 1");

  const rounds: NegotiationRound[] = [];

  for (let r = 1; r <= maxRounds; r++) {
    const proposal = await hooks.propose(rounds, intent);
    const review = await hooks.review(proposal);
    const round: NegotiationRound = { proposal, review };
    rounds.push(round);
    opts.onRound?.(round);

    if (review.verdict === "accept") {
      return {
        acceptedDraft: proposal.draft,
        status: "accepted",
        finalRound: r,
        rounds,
        finalConcerns: review.concerns,
      };
    }
    if (review.verdict === "reject") {
      return {
        acceptedDraft: null,
        status: "rejected",
        finalRound: r,
        rounds,
        finalConcerns: review.concerns,
      };
    }
  }

  const last = rounds[rounds.length - 1]!;
  return {
    acceptedDraft: null,
    status: "exhausted",
    finalRound: rounds.length,
    rounds,
    finalConcerns: last.review.concerns,
  };
}

export function formatNegotiationOutcome(outcome: NegotiationOutcome): string {
  const lines: string[] = [];
  lines.push(
    `Sprint contract negotiation — ${outcome.status.toUpperCase()} after ${outcome.finalRound} round(s)`,
  );
  for (const round of outcome.rounds) {
    lines.push(
      `  round ${round.proposal.round}: proposer=${round.proposal.proposedBy} → reviewer=${round.review.reviewedBy} → ${round.review.verdict}`,
    );
    if (round.review.concerns.length > 0) {
      for (const c of round.review.concerns) lines.push(`    - ${c}`);
    }
  }
  if (outcome.finalConcerns.length > 0 && outcome.status !== "accepted") {
    lines.push("  final unresolved concerns:");
    for (const c of outcome.finalConcerns) lines.push(`    - ${c}`);
  }
  return lines.join("\n");
}

export function outcomeToPayload(outcome: NegotiationOutcome): Record<string, unknown> {
  return {
    kind: "sprint_contract_negotiation.outcome_recorded",
    status: outcome.status,
    finalRound: outcome.finalRound,
    accepted: outcome.acceptedDraft !== null,
    finalConcernCount: outcome.finalConcerns.length,
  };
}

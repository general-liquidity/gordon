/**
 * Completion proof / handoff artifact (A3).
 *
 * A serious autonomous loop ends with an inspectable artifact, not a free-text
 * log line. The loop already owns every piece a trustworthy handoff needs —
 * the requirement coverage ({@link goalGapFinding}), the independent verifier
 * verdict ({@link completionVerifier}), the self-score ({@link goalMode}), the
 * acknowledged-gap ledger, and a session/audit reference — but they are emitted
 * scattered across log lines. This module packages them into ONE serializable
 * {@link CompletionProof} sealed on both terminal paths: a clean verified
 * `achieved` and an honest `achieved_with_acknowledged_gaps`.
 *
 * PURE COMPOSITION. It introduces no new judgment: the completion DECISION is
 * made upstream by {@link finalizeGoalCompletion} (verifier must confirm and the
 * unmet set must be empty). This module only reads the already-decided pieces
 * and stamps them into an object. Additive; never throws.
 *
 * Mirrors the gordon-rs `CompletionProof` design (gordon-supervision): the
 * StopReason variants `VerifiedComplete` / `DoneWithAcknowledgedGaps` map to
 * the `achieved` / `achieved_with_acknowledged_gaps` stop reasons here.
 */

import type { GoalState, GoalScore } from "./goalMode.ts";
import { isCompletionCandidate } from "./goalMode.ts";
import type { GoalRequirement } from "./goalGapFinding.ts";
import { summarizeGaps } from "./goalGapFinding.ts";
import type { CompletionVerdict } from "./completionVerifier.ts";

export type CompletionStopReason = "achieved" | "achieved_with_acknowledged_gaps";

export interface CompletionCoverage {
  met: GoalRequirement[];
  unmet: GoalRequirement[];
}

export interface CompletionProofVerdict {
  /** Identifier of the verifier that confirmed/rejected, or null when the
   *  self-score never proposed completion (the acknowledged-gaps seal path). */
  verifierId: string | null;
  confirmed: boolean;
  reason: string;
}

export interface CompletionProof {
  goalId: string;
  /** Which terminal path sealed the goal. */
  stopReason: CompletionStopReason;
  /** Requirement coverage this cycle: what was met and what remained open. */
  coverage: CompletionCoverage;
  /** The independent verifier's ruling (or a null-verifier note on the gaps path). */
  verdict: CompletionProofVerdict;
  /** The loop's own self-score (0..1). Advisory only; never authorizes completion alone. */
  selfScorePct: number;
  /**
   * True when the self-score's own end-state/constraint claim agrees with the
   * verifier verdict. Surfaces self-grade drift: a `false` here on an `achieved`
   * seal would be a contradiction worth an operator's eye.
   */
  selfScoreAgreesWithVerdict: boolean;
  /** Cycles elapsed when the goal was sealed. */
  cyclesElapsed: number;
  /** Human-readable evidence lines composed from the score + verdict. */
  evidence: string[];
  /** The named open gaps carried into the handoff (empty on a clean `achieved`). */
  acknowledgedGaps: GoalRequirement[];
  /** Reference tying the proof to the run's audit trail (e.g. the session id). */
  auditChainRef?: string;
  sealedAt: string;
}

export interface BuildCompletionProofArgs {
  /** The (possibly-sealed) goal state at the terminal path. */
  state: GoalState;
  /** The self-score for the terminating cycle. */
  score: GoalScore;
  /** The full requirement set derived this cycle (met + unmet). */
  requirements: GoalRequirement[];
  /** The verifier verdict, or null when the self-score never proposed completion. */
  verdict?: CompletionVerdict | null;
  stopReason: CompletionStopReason;
  /** Cycles elapsed; defaults to `state.iterations`. */
  cyclesElapsed?: number;
  /** Reference into the audit trail (e.g. the loop session id). */
  auditChainRef?: string;
  /** Extra evidence lines to append. */
  extraEvidence?: string[];
  now?: string;
}

/**
 * Compose a {@link CompletionProof} from the already-decided completion pieces.
 * Pure: reads its inputs, computes nothing that could change the seal decision.
 */
export function buildCompletionProof(args: BuildCompletionProofArgs): CompletionProof {
  const { state, score, requirements, stopReason } = args;

  const met = requirements.filter((r) => r.met);
  const unmet = requirements.filter((r) => !r.met);

  const verdict: CompletionProofVerdict = args.verdict
    ? {
        verifierId: args.verdict.verifierId,
        confirmed: args.verdict.confirmed,
        reason: args.verdict.rationale,
      }
    : {
        verifierId: null,
        confirmed: false,
        reason: "self-score did not propose completion; sealed with acknowledged gaps",
      };

  const selfClaimsDone = isCompletionCandidate(score);
  const selfScoreAgreesWithVerdict = selfClaimsDone === verdict.confirmed;

  const evidence: string[] = [
    `self-score ${(score.progressPct * 100).toFixed(0)}%`,
    `end state met: ${score.endStateMet ? "yes" : "no"}`,
    `constraints held: ${score.constraintsHeld ? "yes" : "no"}`,
    `coverage ${met.length}/${requirements.length} requirements met`,
  ];
  if (score.rationale) evidence.push(`rationale: ${score.rationale}`);
  if (score.observations && Object.keys(score.observations).length > 0) {
    evidence.push(`observations: ${JSON.stringify(score.observations)}`);
  }
  evidence.push(`verdict: ${verdict.reason}`);
  if (args.extraEvidence) evidence.push(...args.extraEvidence);

  return {
    goalId: state.id,
    stopReason,
    coverage: { met, unmet },
    verdict,
    selfScorePct: score.progressPct,
    selfScoreAgreesWithVerdict,
    cyclesElapsed: args.cyclesElapsed ?? state.iterations,
    evidence,
    acknowledgedGaps: unmet,
    ...(args.auditChainRef !== undefined && { auditChainRef: args.auditChainRef }),
    sealedAt: args.now ?? new Date().toISOString(),
  };
}

/** Flat, log-friendly projection of a completion proof. */
export function completionProofToPayload(proof: CompletionProof): Record<string, unknown> {
  return {
    kind: "completion.proof_sealed",
    goalId: proof.goalId,
    stopReason: proof.stopReason,
    verdictConfirmed: proof.verdict.confirmed,
    verifierId: proof.verdict.verifierId,
    metCount: proof.coverage.met.length,
    unmetCount: proof.coverage.unmet.length,
    selfScorePct: Number(proof.selfScorePct.toFixed(3)),
    selfScoreAgreesWithVerdict: proof.selfScoreAgreesWithVerdict,
    cyclesElapsed: proof.cyclesElapsed,
    acknowledgedGaps: summarizeGaps(proof.acknowledgedGaps),
    auditChainRef: proof.auditChainRef ?? null,
    sealedAt: proof.sealedAt,
  };
}

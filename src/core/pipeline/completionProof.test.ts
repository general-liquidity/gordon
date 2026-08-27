import { describe, expect, it } from "bun:test";
import { buildCompletionProof, completionProofToPayload } from "./completionProof.ts";
import {
  createGoalState,
  scoreGoal,
  recordGoalProgress,
  sealAcknowledgedGaps,
  resetGoalIdCounterForTesting,
  type GoalObservation,
} from "./goalMode.ts";
import { deriveRequirements, unmetRequirements } from "./goalGapFinding.ts";
import type { CompletionVerdict } from "./completionVerifier.ts";

function achievedFixture() {
  resetGoalIdCounterForTesting();
  const state0 = createGoalState("/goal grow book until Sharpe >= 1.5", "2026-01-01T00:00:00.000Z");
  const obs: GoalObservation = { sharpe: 2.0, constraintViolations: [] };
  const score = scoreGoal(state0.parsedGoal, obs, 1);
  const state = recordGoalProgress(state0, score);
  const requirements = deriveRequirements(state.parsedGoal, obs, score);
  const verdict: CompletionVerdict = {
    verifierId: "requirement-set-v1",
    confirmed: true,
    unmet: unmetRequirements(requirements),
    rationale: "completion confirmed",
  };
  return { state, score, requirements, verdict };
}

describe("buildCompletionProof — achieved path", () => {
  it("packages a confirmed proof with empty gaps", () => {
    const { state, score, requirements, verdict } = achievedFixture();
    const proof = buildCompletionProof({
      state,
      score,
      requirements,
      verdict,
      stopReason: "achieved",
      auditChainRef: "session_1",
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(proof.stopReason).toBe("achieved");
    expect(proof.goalId).toBe(state.id);
    expect(proof.verdict.confirmed).toBe(true);
    expect(proof.verdict.verifierId).toBe("requirement-set-v1");
    expect(proof.coverage.unmet).toHaveLength(0);
    expect(proof.coverage.met.length).toBeGreaterThan(0);
    expect(proof.acknowledgedGaps).toHaveLength(0);
    expect(proof.auditChainRef).toBe("session_1");
    expect(proof.sealedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("flags agreement when self-score and verdict both confirm", () => {
    const { state, score, requirements, verdict } = achievedFixture();
    const proof = buildCompletionProof({
      state,
      score,
      requirements,
      verdict,
      stopReason: "achieved",
    });
    // self-score proposed completion (Sharpe 2.0 >= 1.5) AND verdict confirmed.
    expect(proof.selfScoreAgreesWithVerdict).toBe(true);
    expect(proof.selfScorePct).toBeGreaterThanOrEqual(1);
  });

  it("flags disagreement when the self-score over-claims vs a rejecting verdict", () => {
    const { state, score, requirements } = achievedFixture();
    const rejecting: CompletionVerdict = {
      verifierId: "requirement-set-v1",
      confirmed: false,
      unmet: [],
      rationale: "held back",
    };
    const proof = buildCompletionProof({
      state,
      score,
      requirements,
      verdict: rejecting,
      stopReason: "achieved",
    });
    // self-score claims done, verdict says no -> disagreement surfaced.
    expect(proof.selfScoreAgreesWithVerdict).toBe(false);
  });
});

describe("buildCompletionProof — acknowledged-gaps path", () => {
  it("carries the named open gaps and a null verifier when self-score never proposed completion", () => {
    resetGoalIdCounterForTesting();
    const state0 = createGoalState(
      "/goal grow book until Sharpe >= 1.5",
      "2026-01-01T00:00:00.000Z",
    );
    const obs: GoalObservation = { sharpe: 0.3, constraintViolations: [] };
    const score = scoreGoal(state0.parsedGoal, obs, 1);
    const recorded = recordGoalProgress(state0, score);
    const requirements = deriveRequirements(recorded.parsedGoal, obs, score);
    const unmet = unmetRequirements(requirements);
    const sealed = sealAcknowledgedGaps(recorded, unmet, "goal stalled");

    const proof = buildCompletionProof({
      state: sealed,
      score,
      requirements,
      verdict: null,
      stopReason: "achieved_with_acknowledged_gaps",
    });

    expect(proof.stopReason).toBe("achieved_with_acknowledged_gaps");
    expect(proof.acknowledgedGaps.length).toBeGreaterThan(0);
    expect(proof.coverage.unmet.length).toBe(proof.acknowledgedGaps.length);
    expect(proof.verdict.verifierId).toBeNull();
    expect(proof.verdict.confirmed).toBe(false);
    // self-score did not propose completion, verdict not confirmed -> they agree.
    expect(proof.selfScoreAgreesWithVerdict).toBe(true);
  });
});

describe("completionProofToPayload", () => {
  it("produces a flat, log-friendly projection", () => {
    const { state, score, requirements, verdict } = achievedFixture();
    const proof = buildCompletionProof({
      state,
      score,
      requirements,
      verdict,
      stopReason: "achieved",
      auditChainRef: "session_9",
    });
    const payload = completionProofToPayload(proof);
    expect(payload.kind).toBe("completion.proof_sealed");
    expect(payload.stopReason).toBe("achieved");
    expect(payload.verdictConfirmed).toBe(true);
    expect(payload.unmetCount).toBe(0);
    expect(payload.auditChainRef).toBe("session_9");
    expect(typeof payload.acknowledgedGaps).toBe("string");
  });
});

import { describe, it, expect } from "bun:test";

import {
  isSprintContractNegotiationEnabled,
  runNegotiation,
  formatNegotiationOutcome,
  outcomeToPayload,
  SPRINT_CONTRACT_NEGOTIATION_FLAG_ENV,
  type NegotiationHooks,
  type SprintProposal,
  type SprintReview,
  type NegotiationRound,
} from "./sprintContractNegotiation.ts";
import type { SprintContractDraft } from "./sprintContract.ts";

const sampleDraft: SprintContractDraft = {
  scope: { symbols: ["BTC/USD"], venues: ["binance"], strategies: ["mean-rev"] },
  verificationStandards: ["paper-mode passes 3 trades"],
  exclusions: ["no shorting"],
  intent: "scan + execute mean-rev on BTC for 24h",
};

function mkProposer(drafts: SprintContractDraft[]): NegotiationHooks["propose"] {
  let i = 0;
  return async (rounds, _intent) => {
    const draft = drafts[i] ?? drafts[drafts.length - 1]!;
    const r = i + 1;
    i++;
    return {
      proposedBy: "proposer-1",
      round: r,
      proposedAt: `2026-05-13T0${r}:00:00.000Z`,
      draft,
      rationale: `round ${r} rationale (history: ${rounds.length})`,
    };
  };
}

function mkReviewer(
  verdicts: Array<{ verdict: SprintReview["verdict"]; concerns?: string[] }>,
): NegotiationHooks["review"] {
  let i = 0;
  return async (proposal: SprintProposal) => {
    const v = verdicts[i] ?? verdicts[verdicts.length - 1]!;
    i++;
    return {
      reviewedBy: "reviewer-1",
      round: proposal.round,
      reviewedAt: `2026-05-13T0${proposal.round}:00:30.000Z`,
      verdict: v.verdict,
      concerns: v.concerns ?? [],
      rationale: `verdict for round ${proposal.round}`,
    };
  };
}

describe("isSprintContractNegotiationEnabled", () => {
  it("respects the flag", () => {
    expect(isSprintContractNegotiationEnabled({})).toBe(false);
    expect(
      isSprintContractNegotiationEnabled({ [SPRINT_CONTRACT_NEGOTIATION_FLAG_ENV]: "1" }),
    ).toBe(true);
    expect(
      isSprintContractNegotiationEnabled({ [SPRINT_CONTRACT_NEGOTIATION_FLAG_ENV]: "true" }),
    ).toBe(true);
  });
});

describe("runNegotiation — termination semantics", () => {
  it("accepts on round 1 when reviewer accepts", async () => {
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([{ verdict: "accept" }]),
    };
    const outcome = await runNegotiation(hooks, "trade BTC");
    expect(outcome.status).toBe("accepted");
    expect(outcome.finalRound).toBe(1);
    expect(outcome.acceptedDraft).toEqual(sampleDraft);
  });

  it("rejects outright on a 'reject' verdict", async () => {
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([{ verdict: "reject", concerns: ["scope too broad"] }]),
    };
    const outcome = await runNegotiation(hooks, "trade BTC");
    expect(outcome.status).toBe("rejected");
    expect(outcome.acceptedDraft).toBeNull();
    expect(outcome.finalConcerns).toContain("scope too broad");
  });

  it("continues to next round on 'request_changes', then accepts", async () => {
    const drafts: SprintContractDraft[] = [
      { ...sampleDraft, scope: { symbols: ["BTC/USD", "ETH/USD"], venues: [], strategies: [] } },
      sampleDraft, // narrower
    ];
    const hooks: NegotiationHooks = {
      propose: mkProposer(drafts),
      review: mkReviewer([
        { verdict: "request_changes", concerns: ["too many symbols"] },
        { verdict: "accept" },
      ]),
    };
    const outcome = await runNegotiation(hooks, "trade BTC");
    expect(outcome.status).toBe("accepted");
    expect(outcome.finalRound).toBe(2);
    expect(outcome.acceptedDraft).toEqual(sampleDraft);
  });

  it("exhausts after maxRounds when never accepted", async () => {
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([
        { verdict: "request_changes", concerns: ["c1"] },
        { verdict: "request_changes", concerns: ["c2"] },
        { verdict: "request_changes", concerns: ["c3"] },
      ]),
    };
    const outcome = await runNegotiation(hooks, "trade BTC", { maxRounds: 3 });
    expect(outcome.status).toBe("exhausted");
    expect(outcome.finalRound).toBe(3);
    expect(outcome.finalConcerns).toContain("c3");
  });

  it("rejects maxRounds < 1", async () => {
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([{ verdict: "accept" }]),
    };
    await expect(runNegotiation(hooks, "x", { maxRounds: 0 })).rejects.toThrow();
  });
});

describe("runNegotiation — proposer receives prior rounds", () => {
  it("passes the rounds-so-far to the proposer on revision", async () => {
    const observedRounds: number[] = [];
    const hooks: NegotiationHooks = {
      async propose(rounds, _intent) {
        observedRounds.push(rounds.length);
        return {
          proposedBy: "p",
          round: rounds.length + 1,
          proposedAt: new Date().toISOString(),
          draft: sampleDraft,
          rationale: "r",
        };
      },
      review: mkReviewer([
        { verdict: "request_changes", concerns: ["c1"] },
        { verdict: "accept" },
      ]),
    };
    await runNegotiation(hooks, "x");
    expect(observedRounds).toEqual([0, 1]);
  });
});

describe("runNegotiation — onRound callback", () => {
  it("fires once per round in order", async () => {
    const seen: number[] = [];
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([
        { verdict: "request_changes" },
        { verdict: "request_changes" },
        { verdict: "accept" },
      ]),
    };
    await runNegotiation(hooks, "x", {
      maxRounds: 3,
      onRound: (round: NegotiationRound) => seen.push(round.proposal.round),
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("formatNegotiationOutcome", () => {
  it("includes status + per-round line + final concerns", async () => {
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([{ verdict: "reject", concerns: ["scope drift"] }]),
    };
    const outcome = await runNegotiation(hooks, "x");
    const out = formatNegotiationOutcome(outcome);
    expect(out).toContain("REJECTED");
    expect(out).toContain("scope drift");
    expect(out).toContain("round 1");
  });

  it("omits 'unresolved concerns' section on accept", async () => {
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([{ verdict: "accept" }]),
    };
    const outcome = await runNegotiation(hooks, "x");
    const out = formatNegotiationOutcome(outcome);
    expect(out).not.toContain("unresolved concerns");
  });
});

describe("outcomeToPayload", () => {
  it("emits stable shape with accepted=true on accept", async () => {
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([{ verdict: "accept" }]),
    };
    const outcome = await runNegotiation(hooks, "x");
    const p = outcomeToPayload(outcome);
    expect(p.kind).toBe("sprint_contract_negotiation.outcome_recorded");
    expect(p.status).toBe("accepted");
    expect(p.accepted).toBe(true);
  });

  it("accepted=false on rejection", async () => {
    const hooks: NegotiationHooks = {
      propose: mkProposer([sampleDraft]),
      review: mkReviewer([{ verdict: "reject" }]),
    };
    const outcome = await runNegotiation(hooks, "x");
    expect(outcomeToPayload(outcome).accepted).toBe(false);
  });
});

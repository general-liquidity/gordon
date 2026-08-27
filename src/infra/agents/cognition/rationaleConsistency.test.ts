import { describe, it, expect } from "bun:test";

import {
  scoreTriangularConsistency,
  applyAsymmetricOutcomeGate,
  symmetricOutcomeProduct,
  gateOutcomeByConsistency,
  narrowEvidence,
  buildLegPrompt,
  consistencyScoreOf,
  weakestLeg,
  formatConsistencyResult,
  consistencyResultToPayload,
  CONSISTENCY_LEGS,
  UNSCORED_CONSISTENCY_SCORE,
  type ConsistencyLeg,
  type EvidenceChunk,
  type RationaleTriple,
  type ScoredConsistencyResult,
  type TriangularJudge,
} from "./rationaleConsistency.ts";

function chunk(id: string, text: string, source?: string): EvidenceChunk {
  return { id, text, ...(source === undefined ? {} : { source }) };
}

const GROUNDED_NON_SEQUITUR: RationaleTriple = {
  evidence: [
    chunk("e1", "BTC/USD funding rate is +0.09% per 8h, the 95th percentile of the last 90 days."),
    chunk("e2", "BTC/USD open interest rose 22% in 24h while price is flat."),
  ],
  reasoning:
    "Funding is at the 95th percentile and open interest rose 22% with flat price, so positioning is crowded long.",
  decision: "Open a 3x leveraged long on BTC/USD sized at 40% of equity.",
};

function fixedJudge(scores: Record<ConsistencyLeg, number>): TriangularJudge {
  return ({ leg }) => ({ score: scores[leg], justification: `${leg} verdict` });
}

describe("triangular scoring reports each relation separately", () => {
  it("marks a decision that does not follow low on deduction while factuality stays high", async () => {
    const judge = fixedJudge({ factuality: 0.92, deduction: 0.15, consistency: 0.4 });
    const result = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, judge);

    expect(result.scored).toBe(true);
    const scored = result as ScoredConsistencyResult;
    expect(scored.factuality).toBe(0.92);
    expect(scored.deduction).toBe(0.15);
    expect(scored.consistency).toBe(0.4);
    expect(scored.mean).toBeCloseTo((0.92 + 0.15 + 0.4) / 3, 10);
    expect(weakestLeg(scored).leg).toBe("deduction");
  });

  it("distinguishes an ungrounded rationale from a non-sequitur at the same mean", async () => {
    const ungrounded = (await scoreTriangularConsistency(
      GROUNDED_NON_SEQUITUR,
      fixedJudge({ factuality: 0.1, deduction: 0.9, consistency: 0.5 }),
    )) as ScoredConsistencyResult;
    const nonSequitur = (await scoreTriangularConsistency(
      GROUNDED_NON_SEQUITUR,
      fixedJudge({ factuality: 0.9, deduction: 0.1, consistency: 0.5 }),
    )) as ScoredConsistencyResult;

    expect(ungrounded.mean).toBeCloseTo(nonSequitur.mean, 10);
    expect(weakestLeg(ungrounded).leg).toBe("factuality");
    expect(weakestLeg(nonSequitur).leg).toBe("deduction");
  });

  it("shows every leg in the formatted report and the audit payload", async () => {
    const result = await scoreTriangularConsistency(
      GROUNDED_NON_SEQUITUR,
      fixedJudge({ factuality: 0.92, deduction: 0.15, consistency: 0.4 }),
    );
    const text = formatConsistencyResult(result);
    expect(text).toContain("factuality");
    expect(text).toContain("deduction");
    expect(text).toContain("consistency");
    expect(consistencyResultToPayload(result)).toMatchObject({
      kind: "rationale_consistency.scored",
      factuality: 0.92,
      deduction: 0.15,
      consistency: 0.4,
      weakestLeg: "deduction",
    });
  });
});

describe("the outcome gate cannot be gamed by self-reporting a low score", () => {
  it("makes a losing trade with a bad rationale worse, where a symmetric product makes it better", () => {
    const loss = -100;
    const honest = 0.8;
    const evasive = 0.2;

    // Under the symmetric baseline, marking your own work down shrinks the penalty.
    expect(symmetricOutcomeProduct(loss, evasive)).toBeGreaterThan(
      symmetricOutcomeProduct(loss, honest),
    );

    const honestGated = applyAsymmetricOutcomeGate(loss, honest);
    const evasiveGated = applyAsymmetricOutcomeGate(loss, evasive);
    expect(evasiveGated.adjustedOutcome).toBeLessThan(honestGated.adjustedOutcome);
    expect(evasiveGated.adjustedOutcome).toBeLessThan(loss);
    expect(evasiveGated.multiplier).toBeCloseTo(1.8, 10);
    expect(honestGated.multiplier).toBeCloseTo(1.2, 10);
  });

  it("leaves no self-reported score at which a loss is cheaper than at full consistency", () => {
    const loss = -50;
    const best = applyAsymmetricOutcomeGate(loss, 1).adjustedOutcome;
    for (const s of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(applyAsymmetricOutcomeGate(loss, s).adjustedOutcome).toBeLessThanOrEqual(best);
    }
  });

  it("discounts a profitable trade whose rationale was weak", () => {
    const win = 100;
    const lucky = applyAsymmetricOutcomeGate(win, 0.1);
    expect(lucky.adjustedOutcome).toBeCloseTo(60, 10);
    expect(lucky.adjustedOutcome).toBeLessThan(win);
    expect(lucky.penalized).toBe(true);
    expect(applyAsymmetricOutcomeGate(win, 1).adjustedOutcome).toBeCloseTo(150, 10);
  });

  it("clamps scores outside the unit interval instead of inverting the multiplier", () => {
    expect(applyAsymmetricOutcomeGate(-10, 5).multiplier).toBeCloseTo(1, 10);
    expect(applyAsymmetricOutcomeGate(-10, -3).multiplier).toBeCloseTo(2, 10);
  });

  it("treats an unscored rationale as the worst score when gating an outcome", async () => {
    const unscored = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, () => null);
    const gated = gateOutcomeByConsistency(-100, unscored);
    expect(gated.score).toBe(UNSCORED_CONSISTENCY_SCORE);
    expect(gated.adjustedOutcome).toBeCloseTo(-200, 10);
  });
});

describe("scoring runs entirely on the injected judge", () => {
  it("asks the judge once per relation and never reaches the network", async () => {
    const seen: ConsistencyLeg[] = [];
    const result = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, (request) => {
      seen.push(request.leg);
      expect(request.prompt.length).toBeGreaterThan(0);
      return { score: 0.5 };
    });

    expect(seen).toEqual([...CONSISTENCY_LEGS]);
    expect(consistencyScoreOf(result)).toBeCloseTo(0.5, 10);
  });

  it("gives each relation only the two sides of the triple it is judging", () => {
    const deduction = buildLegPrompt("deduction", GROUNDED_NON_SEQUITUR);
    expect(deduction).toContain("REASONING:");
    expect(deduction).toContain("DECISION:");
    expect(deduction).not.toContain("EVIDENCE:");

    const factuality = buildLegPrompt("factuality", GROUNDED_NON_SEQUITUR);
    expect(factuality).toContain("EVIDENCE:");
    expect(factuality).toContain("REASONING:");
    expect(factuality).not.toContain("DECISION:");

    const consistency = buildLegPrompt("consistency", GROUNDED_NON_SEQUITUR);
    expect(consistency).toContain("EVIDENCE:");
    expect(consistency).toContain("DECISION:");
    expect(consistency).not.toContain("REASONING:");
  });
});

describe("retrieval narrowing keeps the evidence that names the decision", () => {
  const context: EvidenceChunk[] = [
    chunk("c1", "BTC/USD funding is at the 95th percentile.", "get_market_data"),
    chunk("c2", "ETH/USD staking yield fell to 2.9%.", "get_market_data"),
    chunk("c3", "Gold miners rallied on a weaker dollar.", "get_news"),
    chunk("c4", "Perp basis on SOL/USD compressed overnight.", "get_market_data"),
    chunk("c5", "Payrolls came in 40k above consensus.", "get_news"),
    chunk("c6", "Long BTC/USD liquidations totalled $310m in 24h.", "get_news"),
  ];
  const decision = "Open a 3x leveraged long on BTC/USD sized at 40% of equity.";
  const matcher = () => ["BTC/USD"];
  const ranker = (c: EvidenceChunk) => (c.source === "get_news" ? 0.6 : 0.3);

  it("returns fewer chunks than the full context", () => {
    const narrowed = narrowEvidence(context, decision, { matcher, ranker, topK: 1 });
    expect(narrowed.evidence.length).toBeLessThan(context.length);
    expect(narrowed.droppedCount).toBe(context.length - narrowed.evidence.length);
  });

  it("keeps every chunk mentioning an entity from the decision even when the ranker scores it low", () => {
    const narrowed = narrowEvidence(context, decision, {
      matcher,
      ranker: () => 0,
      topK: 0,
    });
    expect(narrowed.evidence.map((c) => c.id)).toEqual(["c1", "c6"]);
    expect(narrowed.hardMatched.map((c) => c.id)).toEqual(["c1", "c6"]);
    expect(narrowed.ranked).toEqual([]);
  });

  it("fills the remaining budget from the ranker, highest first", () => {
    const narrowed = narrowEvidence(context, decision, { matcher, ranker, topK: 2 });
    expect(narrowed.ranked.map((c) => c.id)).toEqual(["c3", "c5"]);
    expect(narrowed.evidence.map((c) => c.id)).toEqual(["c1", "c6", "c3", "c5"]);
  });

  it("keeps nothing hard-matched when the decision names no known entity", () => {
    const narrowed = narrowEvidence(context, decision, {
      matcher: () => [],
      ranker,
      topK: 2,
    });
    expect(narrowed.hardMatched).toEqual([]);
    expect(narrowed.evidence).toHaveLength(2);
  });
});

describe("the module is deterministic", () => {
  it("produces identical results for identical inputs across repeated runs", async () => {
    const judge = fixedJudge({ factuality: 0.71, deduction: 0.33, consistency: 0.58 });
    const first = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, judge);
    const second = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, judge);
    expect(second).toEqual(first);

    const gateA = applyAsymmetricOutcomeGate(-42, consistencyScoreOf(first));
    const gateB = applyAsymmetricOutcomeGate(-42, consistencyScoreOf(second));
    expect(gateB).toEqual(gateA);
  });

  it("orders equally ranked evidence the same way on every call", () => {
    const context = [chunk("a", "one"), chunk("b", "two"), chunk("c", "three")];
    const run = () =>
      narrowEvidence(context, "sell something", {
        matcher: () => [],
        ranker: () => 0.5,
        topK: 2,
      }).evidence.map((c) => c.id);
    expect(run()).toEqual(["a", "b"]);
    expect(run()).toEqual(run());
  });
});

describe("a judge that fails to answer yields no score rather than a passing one", () => {
  it("reports an unscored result when the judge returns nothing", async () => {
    const result = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, () => undefined);
    expect(result.scored).toBe(false);
    if (result.scored) throw new Error("unreachable");
    expect(result.failedLegs).toEqual([...CONSISTENCY_LEGS]);
    expect(consistencyScoreOf(result)).toBe(UNSCORED_CONSISTENCY_SCORE);
  });

  it("reports an unscored result when a single leg returns a malformed score", async () => {
    const result = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, ({ leg }) =>
      leg === "consistency" ? ({ score: "high" } as unknown as { score: number }) : { score: 0.95 },
    );
    expect(result.scored).toBe(false);
    if (result.scored) throw new Error("unreachable");
    expect(result.failedLegs).toEqual(["consistency"]);
    expect(result.partialLegs.map((l) => l.leg)).toEqual(["factuality", "deduction"]);
    expect(consistencyScoreOf(result)).toBe(UNSCORED_CONSISTENCY_SCORE);
  });

  it("rejects out-of-range and non-finite scores", async () => {
    for (const bad of [1.4, -0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, () => ({
        score: bad,
      }));
      expect(result.scored).toBe(false);
    }
  });

  it("reports an unscored result when the judge throws", async () => {
    const result = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, () => {
      throw new Error("judge timeout");
    });
    expect(result.scored).toBe(false);
    if (result.scored) throw new Error("unreachable");
    expect(result.reason).toContain("judge timeout");
    expect(consistencyResultToPayload(result)).toMatchObject({
      kind: "rationale_consistency.unscored",
      scored: false,
    });
  });

  it("never lets an unscored rationale read as a high score in the report", async () => {
    const result = await scoreTriangularConsistency(GROUNDED_NON_SEQUITUR, () => null);
    expect(formatConsistencyResult(result)).toContain("UNSCORED");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  buildPlanRationaleTriple,
  planEvidenceChunks,
  isRationaleConsistencyEnabled,
  rationaleConsistencyFindings,
  scorePlanRationaleConsistency,
  reflectOnPlan,
  RATIONALE_CONSISTENCY_FLAG_ENV,
  MIN_PLAN_RATIONALE_CONSISTENCY,
  type ReflectionResult,
} from "./reflection.ts";
import type { ConsistencyLeg, TriangularJudge } from "./rationaleConsistency.ts";
import type { Plan } from "../../../types/plan.ts";
import type { GordonContext } from "../types.ts";

// ============================================================================
// Fixtures
// ============================================================================

function samplePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    symbol: "BTC/USDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.1 },
    entry: { type: "limit", price: 100 },
    dca: null,
    grid: null,
    stopLoss: { price: 95 },
    takeProfit: [{ price: 110, percentToSell: 1 }],
    reasoning: "Price held the 95 support twice and the regime is trending up, so a bounce entry at 100 with a stop under support is favourable.",
    status: "DRAFT",
    synthesisManifest: {
      capturedAt: 1_754_000_000_000,
      symbol: "BTC/USDT",
      regime: { label: "trending_up", confidence: 0.72, timeframe: "4h" },
      news: {
        headlinesCount: 6,
        netSentiment: 0.3,
        windowHoursApprox: 12,
        topBullish: "Spot inflows hit a six-week high",
      },
      observationCount: 14,
      observationWindowMs: 3_600_000,
      matchedLessonIds: ["lesson-support-retest"],
      candleSnapshotRef: {
        venue: "binance",
        symbol: "BTC/USDT",
        timeframe: "1h",
        fromTs: 1_753_900_000_000,
        toTs: 1_754_000_000_000,
        asOfStoredAt: 1_754_000_000_000,
        barCount: 200,
      },
    },
    ...overrides,
  } as Plan;
}

/** Reflection needs only the portfolio numbers and the client off the context. */
function sampleContext(llm: unknown): GordonContext {
  return {
    portfolioValue: 10_000,
    availableCash: 5_000,
    llm,
    config: {},
  } as unknown as GordonContext;
}

/** LLM stub for the semantic-reflection leg. Never reaches the network. */
const passingReflectionLLM = {
  chatWithJSON: async () => ({
    isValid: true,
    issues: [] as string[],
    suggestions: [] as string[],
    confidence: 0.9,
    reasoning: "Plan is coherent.",
  }),
};

function fixedJudge(scores: Record<ConsistencyLeg, number>): TriangularJudge {
  return ({ leg }) => ({ score: scores[leg], justification: `${leg} verdict` });
}

const ALL_HIGH = fixedJudge({ factuality: 0.9, deduction: 0.9, consistency: 0.9 });

// ============================================================================
// Tests
// ============================================================================

describe("plan rationale triple", () => {
  it("takes the evidence from what the session recorded at plan time", () => {
    const triple = buildPlanRationaleTriple(samplePlan());
    const ids = triple.evidence.map((chunk) => chunk.id);
    expect(ids).toEqual(["regime", "news", "observations", "lessons", "candles"]);
    expect(triple.reasoning).toContain("95 support");
  });

  it("names the action in the decision and the justification in the reasoning", () => {
    const triple = buildPlanRationaleTriple(samplePlan());
    expect(triple.decision).toContain("long BTC/USDT");
    expect(triple.decision).toContain("stop $95");
    expect(triple.decision).not.toContain("favourable");
  });

  it("yields no evidence for a plan that recorded none", () => {
    expect(planEvidenceChunks(samplePlan({ synthesisManifest: undefined }))).toEqual([]);
  });
});

describe("rationale consistency gate activation", () => {
  const original = process.env[RATIONALE_CONSISTENCY_FLAG_ENV];

  beforeEach(() => {
    delete process.env[RATIONALE_CONSISTENCY_FLAG_ENV];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[RATIONALE_CONSISTENCY_FLAG_ENV];
    else process.env[RATIONALE_CONSISTENCY_FLAG_ENV] = original;
  });

  it("stays inactive for an operator who configures nothing", async () => {
    expect(isRationaleConsistencyEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    const scored = await scorePlanRationaleConsistency(samplePlan(), sampleContext(null), {
      rationaleJudge: () => {
        throw new Error("judge must not run while the gate is off");
      },
    });
    expect(scored).toBeNull();
  });

  it("activates on the opt-in flag", () => {
    process.env[RATIONALE_CONSISTENCY_FLAG_ENV] = "1";
    expect(isRationaleConsistencyEnabled()).toBe(true);
  });

  it("scores every relation of the rationale separately once enabled", async () => {
    process.env[RATIONALE_CONSISTENCY_FLAG_ENV] = "1";
    const result = await scorePlanRationaleConsistency(samplePlan(), sampleContext(null), {
      rationaleJudge: fixedJudge({ factuality: 0.9, deduction: 0.4, consistency: 0.8 }),
    });
    expect(result?.scored).toBe(true);
    if (!result?.scored) throw new Error("expected a scored result");
    expect(result.factuality).toBe(0.9);
    expect(result.deduction).toBe(0.4);
    expect(result.consistency).toBe(0.8);
  });

  it("returns the same legs for the same plan and judge", async () => {
    process.env[RATIONALE_CONSISTENCY_FLAG_ENV] = "1";
    const plan = samplePlan();
    const first = await scorePlanRationaleConsistency(plan, sampleContext(null), {
      rationaleJudge: ALL_HIGH,
    });
    const second = await scorePlanRationaleConsistency(plan, sampleContext(null), {
      rationaleJudge: ALL_HIGH,
    });
    expect(second).toEqual(first);
  });

  it("does not reach for a judge when no client is available", async () => {
    process.env[RATIONALE_CONSISTENCY_FLAG_ENV] = "1";
    expect(await scorePlanRationaleConsistency(samplePlan(), sampleContext(null))).toBeNull();
  });
});

describe("rationale consistency findings", () => {
  it("reports a low score as an issue naming every relation", () => {
    const findings = rationaleConsistencyFindings({
      scored: true,
      legs: {
        factuality: { leg: "factuality", score: 0.2, justification: "unsupported" },
        deduction: { leg: "deduction", score: 0.8, justification: "follows" },
        consistency: { leg: "consistency", score: 0.5, justification: "partial" },
      },
      factuality: 0.2,
      deduction: 0.8,
      consistency: 0.5,
      mean: 0.5,
      evidenceCount: 3,
    });
    expect(findings.issues).toHaveLength(1);
    expect(findings.issues[0]).toContain("factuality 0.20");
    expect(findings.issues[0]).toContain("deduction 0.80");
    expect(findings.suggestions[0]).toContain("Cite the retrieved evidence");
  });

  it("stays silent for a score at or above the threshold", () => {
    const findings = rationaleConsistencyFindings({
      scored: true,
      legs: {
        factuality: { leg: "factuality", score: MIN_PLAN_RATIONALE_CONSISTENCY, justification: "" },
        deduction: { leg: "deduction", score: MIN_PLAN_RATIONALE_CONSISTENCY, justification: "" },
        consistency: { leg: "consistency", score: MIN_PLAN_RATIONALE_CONSISTENCY, justification: "" },
      },
      factuality: MIN_PLAN_RATIONALE_CONSISTENCY,
      deduction: MIN_PLAN_RATIONALE_CONSISTENCY,
      consistency: MIN_PLAN_RATIONALE_CONSISTENCY,
      mean: MIN_PLAN_RATIONALE_CONSISTENCY,
      evidenceCount: 3,
    });
    expect(findings.issues).toEqual([]);
    expect(findings.suggestions).toEqual([]);
  });

  it("never turns an unscored rationale into an issue", () => {
    const findings = rationaleConsistencyFindings({
      scored: false,
      reason: "deduction: judge threw (network down)",
      failedLegs: ["deduction"],
      partialLegs: [],
      evidenceCount: 3,
    });
    expect(findings.issues).toEqual([]);
    expect(findings.suggestions[0]).toContain("could not be scored");
    expect(findings.suggestions[0]).toContain("0.00");
  });
});

describe("reflectOnPlan with the consistency gate enabled", () => {
  const original = process.env[RATIONALE_CONSISTENCY_FLAG_ENV];

  beforeEach(() => {
    process.env[RATIONALE_CONSISTENCY_FLAG_ENV] = "1";
  });

  afterEach(() => {
    if (original === undefined) delete process.env[RATIONALE_CONSISTENCY_FLAG_ENV];
    else process.env[RATIONALE_CONSISTENCY_FLAG_ENV] = original;
  });

  it("attaches the per-leg scores to the reflection result", async () => {
    const result: ReflectionResult = await reflectOnPlan(
      samplePlan(),
      sampleContext(passingReflectionLLM),
      { rationaleJudge: ALL_HIGH },
    );
    expect(result.rationaleConsistency?.scored).toBe(true);
    expect(result.isValid).toBe(true);
  });

  it("invalidates a plan whose rationale the evidence does not support", async () => {
    const result = await reflectOnPlan(samplePlan(), sampleContext(passingReflectionLLM), {
      rationaleJudge: fixedJudge({ factuality: 0.1, deduction: 0.3, consistency: 0.2 }),
    });
    expect(result.isValid).toBe(false);
    expect(result.issues.join(" ")).toContain("Rationale consistency");
  });

  it("keeps the plan valid when the judge is unreachable", async () => {
    const result = await reflectOnPlan(samplePlan(), sampleContext(passingReflectionLLM), {
      rationaleJudge: () => {
        throw new Error("network down");
      },
    });
    expect(result.isValid).toBe(true);
    expect(result.rationaleConsistency?.scored).toBe(false);
    expect(result.suggestions.join(" ")).toContain("could not be scored");
  });

  it("leaves the reflection untouched when the operator has not opted in", async () => {
    delete process.env[RATIONALE_CONSISTENCY_FLAG_ENV];
    const result = await reflectOnPlan(samplePlan(), sampleContext(passingReflectionLLM), {
      rationaleJudge: fixedJudge({ factuality: 0, deduction: 0, consistency: 0 }),
    });
    expect(result.rationaleConsistency).toBeUndefined();
    expect(result.isValid).toBe(true);
  });
});

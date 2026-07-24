import { describe, it, expect } from "bun:test";

import {
  classifyComplexity,
  budgetFor,
  buildCalibrationBlock,
  budgetToPayload,
} from "./effortCalibration.ts";

describe("classifyComplexity — explicit level", () => {
  it("honors explicit `level` hint over all heuristics", () => {
    expect(
      classifyComplexity({ level: "deep", isRouting: true }),
    ).toBe("deep");
    expect(
      classifyComplexity({ level: "trivial", isLiveExecution: true }),
    ).toBe("trivial");
  });
});

describe("classifyComplexity — precedence", () => {
  it("isLiveExecution → deep (overrides routing)", () => {
    expect(classifyComplexity({ isLiveExecution: true, isRouting: true })).toBe("deep");
  });

  it("isRouting → trivial when no live-execution", () => {
    expect(classifyComplexity({ isRouting: true })).toBe("trivial");
  });

  it("deep keyword in task → deep", () => {
    expect(classifyComplexity({ task: "analyze the regime over the last 6 months" })).toBe(
      "deep",
    );
  });

  it("trivial keyword in task → trivial", () => {
    expect(classifyComplexity({ task: "fetch current price of BTC" })).toBe("trivial");
  });

  it("deep keyword wins over trivial keyword when both present", () => {
    expect(
      classifyComplexity({ task: "fetch and analyze the regime for BTC" }),
    ).toBe("deep");
  });

  it("fanout > 5 → deep when no keyword match", () => {
    expect(classifyComplexity({ fanout: 10 })).toBe("deep");
  });

  it("fanout 0-2 → trivial when no keyword match", () => {
    expect(classifyComplexity({ fanout: 1 })).toBe("trivial");
  });

  it("fanout 3-5 → normal when no keyword match", () => {
    expect(classifyComplexity({ fanout: 4 })).toBe("normal");
  });

  it("isMultiStep alone → normal", () => {
    expect(classifyComplexity({ isMultiStep: true })).toBe("normal");
  });

  it("defaults to normal with no hints", () => {
    expect(classifyComplexity({})).toBe("normal");
  });
});

describe("budgetFor", () => {
  it("trivial budget has zero subagents and shallow reasoning", () => {
    const b = budgetFor("trivial");
    expect(b.maxSubagentFanout).toBe(0);
    expect(b.reasoningDepth).toBe("shallow");
    expect(b.maxToolCalls).toBeLessThan(5);
  });

  it("normal budget allows limited fanout and medium reasoning", () => {
    const b = budgetFor("normal");
    expect(b.maxSubagentFanout).toBeGreaterThan(0);
    expect(b.maxSubagentFanout).toBeLessThanOrEqual(3);
    expect(b.reasoningDepth).toBe("medium");
  });

  it("deep budget allows highest fanout and high reasoning", () => {
    const b = budgetFor("deep");
    expect(b.maxSubagentFanout).toBeGreaterThan(2);
    expect(b.reasoningDepth).toBe("high");
    expect(b.maxToolCalls).toBeGreaterThanOrEqual(20);
  });

  it("token budgets scale monotonically with complexity", () => {
    expect(budgetFor("trivial").maxTokens).toBeLessThan(budgetFor("normal").maxTokens);
    expect(budgetFor("normal").maxTokens).toBeLessThan(budgetFor("deep").maxTokens);
  });

  it("fanout caps prevent the '50 subagents' failure mode", () => {
    // Even at maximum, fanout cap is bounded
    expect(budgetFor("deep").maxSubagentFanout).toBeLessThan(50);
  });
});

describe("buildCalibrationBlock", () => {
  it("includes the complexity level and budget numbers", () => {
    const block = buildCalibrationBlock("normal");
    expect(block).toContain("normal");
    expect(block).toContain("Token budget");
    expect(block).toContain("Subagent fanout");
    expect(block).toContain("Tool calls");
  });

  it("includes task type when provided", () => {
    const block = buildCalibrationBlock("trivial", "venue-routing");
    expect(block).toContain("venue-routing");
  });

  it("trivial block discourages subagent spawning", () => {
    const block = buildCalibrationBlock("trivial");
    expect(block).toContain("0 subagent");
  });

  it("deep block mentions extended thinking", () => {
    const block = buildCalibrationBlock("deep");
    expect(block.toLowerCase()).toContain("extended thinking");
  });

  it("includes the over-investing/under-investing warning", () => {
    expect(buildCalibrationBlock("normal")).toContain("Over-investing");
  });
});

describe("budgetToPayload", () => {
  it("emits stable shape", () => {
    const p = budgetToPayload(budgetFor("deep"));
    expect(p.kind).toBe("effort_calibration.budget_recorded");
    expect(p.level).toBe("deep");
  });
});

describe("Anthropic over-parallelization scenario", () => {
  it("trivial routing query → 0 subagents (the fix)", () => {
    const level = classifyComplexity({ task: "list connected venues", isRouting: true });
    expect(budgetFor(level).maxSubagentFanout).toBe(0);
  });

  it("deep research query → high fanout (≤ cap)", () => {
    const level = classifyComplexity({ task: "research the BTC regime comprehensively" });
    const fanout = budgetFor(level).maxSubagentFanout;
    expect(fanout).toBeGreaterThan(2);
    expect(fanout).toBeLessThan(50);
  });
});

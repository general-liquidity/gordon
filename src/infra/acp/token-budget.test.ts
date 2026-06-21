import { describe, it, expect, afterEach } from "bun:test";
import { budgetSignalToStopReason, probeBudgetHalt } from "./token-budget.ts";
import {
  CostTracker,
  setCostBudget,
  clearCostHalt,
  resetCostBudgetState,
} from "../platform/costTracker.ts";

describe("budgetSignalToStopReason", () => {
  it("no-halt → undefined", () => {
    expect(budgetSignalToStopReason({ halt: false })).toBeUndefined();
  });

  it("daily_budget → max_tokens", () => {
    expect(budgetSignalToStopReason({ halt: true, reason: "daily_budget" })).toBe("max_tokens");
  });

  it("token_budget → max_tokens", () => {
    expect(budgetSignalToStopReason({ halt: true, reason: "token_budget" })).toBe("max_tokens");
  });

  it("max_iterations → max_turn_requests", () => {
    expect(budgetSignalToStopReason({ halt: true, reason: "max_iterations" })).toBe("max_turn_requests");
  });
});

describe("probeBudgetHalt", () => {
  afterEach(() => {
    setCostBudget(null);
    clearCostHalt();
    resetCostBudgetState();
  });

  it("returns halt:false when the cost tracker is not halted", () => {
    setCostBudget(null);
    clearCostHalt();
    const result = probeBudgetHalt();
    expect(result.halt).toBe(false);
  });

  it("returns { halt: true, reason: daily_budget } after a cost halt", () => {
    setCostBudget({ sessionUsd: 0.0001, action: "halt", warnThresholds: [] });
    new CostTracker("token-budget-halt").record({
      modelId: "claude-opus-4-6",
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    const result = probeBudgetHalt();
    expect(result.halt).toBe(true);
    if (result.halt) {
      expect(result.reason).toBe("daily_budget");
    }
  });
});

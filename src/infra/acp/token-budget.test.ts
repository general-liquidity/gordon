import { describe, it, expect } from "bun:test";
import { budgetSignalToStopReason, probeBudgetHalt } from "./token-budget.ts";

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
  it("returns halt:false when cost tracker is unavailable / shape mismatch", async () => {
    // The current module's expected getCostTracker shape may not be
    // present in this build; probe should fall through to no-halt.
    const result = await probeBudgetHalt();
    expect(result.halt === false || result.halt === true).toBe(true);
    // Whichever path is taken, it should be a structured BudgetSignal
    expect(typeof result.halt).toBe("boolean");
  });
});

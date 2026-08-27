import { describe, expect, it } from "bun:test";
import {
  BudgetEvaluator,
  DEFAULT_RENDER_BUDGET,
  isRenderBudgetEnabled,
  isRenderBudgetStrict,
} from "./renderBudget.ts";

describe("BudgetEvaluator", () => {
  it("fires after consecutive over-budget frames", () => {
    const breaches: unknown[] = [];
    const evaluator = new BudgetEvaluator(DEFAULT_RENDER_BUDGET, (breach) => breaches.push(breach));
    evaluator.recordFrame("keystroke", 20);
    evaluator.recordFrame("keystroke", 21);
    expect(breaches).toHaveLength(0);
    evaluator.recordFrame("keystroke", 22);
    expect(breaches).toHaveLength(1);
    expect(evaluator.breachCount).toBe(1);
  });

  it("resets a run on under-budget frames", () => {
    const breaches: unknown[] = [];
    const evaluator = new BudgetEvaluator(
      { keystrokeMs: 10, streamMs: 10, breachThreshold: 2 },
      (breach) => breaches.push(breach),
    );
    evaluator.recordFrame("stream", 11);
    evaluator.recordFrame("stream", 9);
    evaluator.recordFrame("stream", 11);
    expect(breaches).toHaveLength(0);
    evaluator.recordFrame("stream", 12);
    expect(breaches).toHaveLength(1);
  });

  it("ignores unattributed frames", () => {
    const breaches: unknown[] = [];
    const evaluator = new BudgetEvaluator(
      { keystrokeMs: 1, streamMs: 1, breachThreshold: 1 },
      (breach) => breaches.push(breach),
    );
    evaluator.recordFrame("other", 999);
    expect(breaches).toHaveLength(0);
  });

  it("parses env flags", () => {
    expect(isRenderBudgetEnabled({ GORDON_RENDER_BUDGET: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isRenderBudgetEnabled({ GORDON_RENDER_BUDGET: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isRenderBudgetEnabled({ GORDON_RENDER_BUDGET: "strict" } as NodeJS.ProcessEnv)).toBe(
      true,
    );
    expect(isRenderBudgetEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isRenderBudgetStrict({ GORDON_RENDER_BUDGET: "strict" } as NodeJS.ProcessEnv)).toBe(
      true,
    );
  });
});

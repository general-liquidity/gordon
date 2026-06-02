import { describe, it, expect } from "bun:test";
import {
  selectOptimizationTier,
  filterMutationsByTier,
} from "./optimization-tier.ts";
import type { Mutation } from "./types.ts";

function mut(type: Mutation["mutation_type"]): Mutation {
  return {
    mutation_id: "00000000-0000-4000-8000-000000000000",
    field_path: "exit.stop_loss.value",
    parameter_name: "Stop loss",
    from_value: 1,
    to_value: 2,
    mutation_type: type,
    reason: "test",
    suggested_by: "test",
    created_at: new Date().toISOString(),
  };
}

describe("selectOptimizationTier", () => {
  it("routes critical risk to structure (highest severity)", () => {
    const r = selectOptimizationTier({ criticalRisk: true });
    expect(r.tier).toBe("structure");
    expect(r.allowedMutationTypes).toEqual(["add", "remove"]);
    expect(r.allowCrossover).toBe(true);
    expect(r.reason).toContain("critical-risk");
  });

  it("routes many stability errors (> 5) to structure", () => {
    const r = selectOptimizationTier({ stabilityErrors: 6 });
    expect(r.tier).toBe("structure");
    expect(r.allowCrossover).toBe(true);
  });

  it("does NOT escalate to structure at exactly 5 stability errors", () => {
    const r = selectOptimizationTier({ stabilityErrors: 5 });
    expect(r.tier).not.toBe("structure");
  });

  it("routes exhausted params (> 3, not improving) to function", () => {
    const r = selectOptimizationTier({
      paramChangesTried: 4,
      fitnessHistory: [50, 49],
    });
    expect(r.tier).toBe("function");
    expect(r.allowedMutationTypes).toEqual(["swap"]);
    expect(r.allowCrossover).toBe(false);
  });

  it("stays at parameter when params tried but fitness IS improving", () => {
    const r = selectOptimizationTier({
      paramChangesTried: 5,
      fitnessHistory: [40, 55],
    });
    expect(r.tier).toBe("parameter");
    expect(r.allowedMutationTypes).toEqual(["nudge", "shift"]);
  });

  it("stays at parameter when params tried but below the exhaustion threshold", () => {
    const r = selectOptimizationTier({ paramChangesTried: 3 });
    expect(r.tier).toBe("parameter");
  });

  it("defaults to parameter with no signals (backward-compatible)", () => {
    const r = selectOptimizationTier();
    expect(r.tier).toBe("parameter");
    expect(r.allowedMutationTypes).toEqual(["nudge", "shift"]);
    expect(r.allowCrossover).toBe(false);
    expect(r.reason).toContain("no severity signals");
  });

  it("prioritizes structure over function when both signals present", () => {
    const r = selectOptimizationTier({
      criticalRisk: true,
      paramChangesTried: 10,
      fitnessHistory: [50, 40],
    });
    expect(r.tier).toBe("structure");
  });

  it("ignores non-finite numeric inputs gracefully", () => {
    const r = selectOptimizationTier({
      stabilityErrors: NaN,
      paramChangesTried: Infinity,
    });
    expect(r.tier).toBe("parameter");
  });
});

describe("filterMutationsByTier", () => {
  it("keeps only parameter-pool mutations at parameter tier", () => {
    const result = selectOptimizationTier();
    const kept = filterMutationsByTier(
      [mut("nudge"), mut("swap"), mut("shift"), mut("add")],
      result,
    );
    expect(kept.map((m) => m.mutation_type)).toEqual(["nudge", "shift"]);
  });

  it("keeps only swap at function tier", () => {
    const result = selectOptimizationTier({
      paramChangesTried: 4,
      fitnessHistory: [50, 49],
    });
    const kept = filterMutationsByTier([mut("nudge"), mut("swap")], result);
    expect(kept.map((m) => m.mutation_type)).toEqual(["swap"]);
  });

  it("keeps add/remove at structure tier", () => {
    const result = selectOptimizationTier({ criticalRisk: true });
    const kept = filterMutationsByTier(
      [mut("nudge"), mut("add"), mut("remove")],
      result,
    );
    expect(kept.map((m) => m.mutation_type)).toEqual(["add", "remove"]);
  });

  it("falls back to originals when filtering would empty the list (no lost fork tick)", () => {
    const result = selectOptimizationTier({ criticalRisk: true });
    const originals = [mut("nudge"), mut("shift")];
    const kept = filterMutationsByTier(originals, result);
    expect(kept).toEqual(originals);
  });

  it("returns empty input unchanged", () => {
    const result = selectOptimizationTier();
    expect(filterMutationsByTier([], result)).toEqual([]);
  });
});

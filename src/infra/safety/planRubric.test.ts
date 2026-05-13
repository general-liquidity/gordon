import { describe, it, expect } from "bun:test";

import {
  isPlanRubricEnabled,
  rubricTotal,
  rubricVerdict,
  blockingDimensions,
  compareRubrics,
  emptyRubric,
  rubricToPayload,
  formatRubric,
  type PlanRubric,
} from "./planRubric.ts";

describe("isPlanRubricEnabled", () => {
  it("respects the flag", () => {
    expect(isPlanRubricEnabled({})).toBe(false);
    expect(isPlanRubricEnabled({ GORDON_PLAN_RUBRIC: "1" })).toBe(true);
    expect(isPlanRubricEnabled({ GORDON_PLAN_RUBRIC: "true" })).toBe(true);
  });
});

describe("rubricTotal", () => {
  it("sums all six dimensions", () => {
    const r: PlanRubric = {
      correctness: 2,
      verification: 1,
      scopeDiscipline: 2,
      reliability: 0,
      maintainability: 1,
      handoffReadiness: 2,
    };
    expect(rubricTotal(r)).toBe(8);
  });
});

describe("rubricVerdict", () => {
  it("returns block when any dimension is 0 even if total is high", () => {
    const r: PlanRubric = {
      correctness: 2,
      verification: 2,
      scopeDiscipline: 2,
      reliability: 0,
      maintainability: 2,
      handoffReadiness: 2,
    };
    expect(rubricVerdict(r)).toBe("block");
  });

  it("returns accept when total >= 10 and no zeros", () => {
    const r: PlanRubric = {
      correctness: 2,
      verification: 2,
      scopeDiscipline: 2,
      reliability: 1,
      maintainability: 1,
      handoffReadiness: 2,
    };
    expect(rubricTotal(r)).toBe(10);
    expect(rubricVerdict(r)).toBe("accept");
  });

  it("returns revise when 7-9 total with no zeros", () => {
    const r: PlanRubric = {
      correctness: 1,
      verification: 2,
      scopeDiscipline: 1,
      reliability: 1,
      maintainability: 1,
      handoffReadiness: 1,
    };
    expect(rubricTotal(r)).toBe(7);
    expect(rubricVerdict(r)).toBe("revise");
  });

  it("returns block when total < 7 even with no zeros", () => {
    const r: PlanRubric = {
      correctness: 1,
      verification: 1,
      scopeDiscipline: 1,
      reliability: 1,
      maintainability: 1,
      handoffReadiness: 1,
    };
    expect(rubricTotal(r)).toBe(6);
    expect(rubricVerdict(r)).toBe("block");
  });

  it("empty rubric is block", () => {
    expect(rubricVerdict(emptyRubric())).toBe("block");
  });
});

describe("blockingDimensions", () => {
  it("returns dimensions scored 0", () => {
    const r: PlanRubric = {
      correctness: 0,
      verification: 2,
      scopeDiscipline: 2,
      reliability: 0,
      maintainability: 1,
      handoffReadiness: 2,
    };
    expect(blockingDimensions(r)).toEqual(["correctness", "reliability"]);
  });

  it("returns empty when all dimensions are non-zero", () => {
    const r: PlanRubric = {
      correctness: 1,
      verification: 1,
      scopeDiscipline: 1,
      reliability: 1,
      maintainability: 1,
      handoffReadiness: 1,
    };
    expect(blockingDimensions(r)).toEqual([]);
  });
});

describe("compareRubrics", () => {
  it("detects regression when any dimension dropped", () => {
    const before: PlanRubric = {
      correctness: 2,
      verification: 2,
      scopeDiscipline: 2,
      reliability: 2,
      maintainability: 2,
      handoffReadiness: 2,
    };
    const after: PlanRubric = {
      correctness: 2,
      verification: 1, // regressed
      scopeDiscipline: 2,
      reliability: 2,
      maintainability: 2,
      handoffReadiness: 2,
    };
    const delta = compareRubrics(before, after);
    expect(delta.hasRegression).toBe(true);
    expect(delta.perDimension.verification).toBe(-1);
    expect(delta.totalDelta).toBe(-1);
  });

  it("captures verdict change", () => {
    const before: PlanRubric = {
      correctness: 1, verification: 1, scopeDiscipline: 1,
      reliability: 1, maintainability: 1, handoffReadiness: 1,
    };
    const after: PlanRubric = {
      correctness: 2, verification: 2, scopeDiscipline: 2,
      reliability: 2, maintainability: 1, handoffReadiness: 1,
    };
    const delta = compareRubrics(before, after);
    expect(delta.verdictChange.from).toBe("block");
    expect(delta.verdictChange.to).toBe("accept");
    expect(delta.hasRegression).toBe(false);
  });
});

describe("rubricToPayload", () => {
  it("returns structured payload with verdict and blocking dimensions", () => {
    const r: PlanRubric = {
      correctness: 0,
      verification: 2,
      scopeDiscipline: 2,
      reliability: 2,
      maintainability: 2,
      handoffReadiness: 2,
    };
    const p = rubricToPayload(r);
    expect(p.kind).toBe("plan.rubric_recorded");
    expect(p.verdict).toBe("block");
    expect(p.total).toBe(10);
    expect(p.blockingDimensions).toEqual(["correctness"]);
  });
});

describe("formatRubric", () => {
  it("emits a one-line summary", () => {
    const r: PlanRubric = {
      correctness: 2,
      verification: 2,
      scopeDiscipline: 2,
      reliability: 2,
      maintainability: 2,
      handoffReadiness: 2,
    };
    const line = formatRubric(r);
    expect(line).toContain("ACCEPT");
    expect(line).toContain("12/12");
    expect(line).toContain("corr:2");
  });
});

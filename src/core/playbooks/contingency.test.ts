import { describe, expect, it } from "bun:test";
import {
  resolveContingency,
  validateContingencyPlan,
  formatContingencyResolution,
  type ContingencyPlan,
} from "./contingency.ts";

function samplePlan(): ContingencyPlan {
  return {
    id: "macro-2026",
    scope: "portfolio",
    branches: [
      {
        name: "bull",
        triggers: [
          { metric: "vix", operator: "<", threshold: 15 },
          { metric: "spx", operator: ">", threshold: 5000 },
        ],
        triggerLogic: "all",
        targetAllocation: [
          { sleeve: "long_equity", targetPercent: 80 },
          { sleeve: "cash", targetPercent: 20 },
        ],
      },
      {
        name: "base",
        triggers: [{ metric: "vix", operator: "between", threshold: [15, 25] }],
        targetAllocation: [
          { sleeve: "long_equity", targetPercent: 50 },
          { sleeve: "cash", targetPercent: 50 },
        ],
      },
      {
        name: "bear",
        triggers: [{ metric: "vix", operator: ">=", threshold: 25 }],
        targetAllocation: [
          { sleeve: "long_equity", targetPercent: 20 },
          { sleeve: "cash", targetPercent: 80 },
        ],
      },
      {
        name: "tail",
        triggers: [{ metric: "vix", operator: ">=", threshold: 40 }],
        targetAllocation: [
          { sleeve: "cash", targetPercent: 70 },
          { sleeve: "hedge", targetPercent: 30 },
        ],
      },
    ],
    defaultBranch: "base",
  };
}

describe("resolveContingency", () => {
  it("selects the bull branch when its ALL-triggers are met", () => {
    const res = resolveContingency(samplePlan(), { metrics: { vix: 12, spx: 5200 } });
    expect(res.activeBranchName).toBe("bull");
    expect(res.fellThrough).toBe(false);
    expect(res.matched).toContain("bull");
  });

  it("selects base within the between-band", () => {
    const res = resolveContingency(samplePlan(), { metrics: { vix: 20, spx: 4800 } });
    expect(res.activeBranchName).toBe("base");
  });

  it("prefers the more defensive branch on tie (tail beats bear when both match)", () => {
    const res = resolveContingency(samplePlan(), { metrics: { vix: 45, spx: 3000 } });
    expect(res.matched).toEqual(expect.arrayContaining(["bear", "tail"]));
    expect(res.activeBranchName).toBe("tail");
  });

  it("honors explicit priority over the default precedence", () => {
    const plan = samplePlan();
    // Force bear to outrank tail via explicit priority.
    plan.branches.find((b) => b.name === "bear")!.priority = 99;
    const res = resolveContingency(plan, { metrics: { vix: 45, spx: 3000 } });
    expect(res.activeBranchName).toBe("bear");
  });

  it("falls through to the default branch when nothing matches", () => {
    // vix 30 hits bear only; drop bear to test fall-through with a plan
    // whose branches all miss.
    const plan: ContingencyPlan = {
      id: "p",
      branches: [
        {
          name: "bull",
          triggers: [{ metric: "vix", operator: "<", threshold: 10 }],
          targetAllocation: [{ sleeve: "eq", targetPercent: 100 }],
        },
        {
          name: "base",
          triggers: [{ metric: "vix", operator: "<", threshold: 5 }],
          targetAllocation: [{ sleeve: "cash", targetPercent: 100 }],
        },
      ],
      defaultBranch: "base",
    };
    const res = resolveContingency(plan, { metrics: { vix: 30 } });
    expect(res.fellThrough).toBe(true);
    expect(res.activeBranchName).toBe("base");
  });

  it("flags missing metrics and treats their triggers as unmet", () => {
    const res = resolveContingency(samplePlan(), { metrics: { vix: 12 } });
    // bull needs spx too; spx missing -> bull unsatisfied.
    expect(res.missingMetrics).toContain("spx");
    expect(res.activeBranchName).not.toBe("bull");
  });

  it("supports any-logic (OR) branches", () => {
    const plan: ContingencyPlan = {
      id: "or",
      branches: [
        {
          name: "bear",
          triggerLogic: "any",
          triggers: [
            { metric: "vix", operator: ">", threshold: 30 },
            { metric: "us10y", operator: ">", threshold: 5 },
          ],
          targetAllocation: [{ sleeve: "cash", targetPercent: 100 }],
        },
      ],
      defaultBranch: "bear",
    };
    const res = resolveContingency(plan, { metrics: { vix: 10, us10y: 5.5 } });
    expect(res.activeBranchName).toBe("bear");
    expect(res.fellThrough).toBe(false);
  });

  it("evaluates outside operator correctly", () => {
    const plan: ContingencyPlan = {
      id: "o",
      branches: [
        {
          name: "tail",
          triggers: [{ metric: "us10y", operator: "outside", threshold: [2, 4] }],
          targetAllocation: [{ sleeve: "hedge", targetPercent: 100 }],
        },
      ],
    };
    const inBand = resolveContingency(plan, { metrics: { us10y: 3 } });
    expect(inBand.fellThrough).toBe(true);
    const outBand = resolveContingency(plan, { metrics: { us10y: 5 } });
    expect(outBand.activeBranchName).toBe("tail");
    expect(outBand.fellThrough).toBe(false);
  });

  it("is deterministic — same inputs give same active branch", () => {
    const plan = samplePlan();
    const reading = { metrics: { vix: 20, spx: 4800 } };
    const a = resolveContingency(plan, reading);
    const b = resolveContingency(plan, reading);
    expect(a.activeBranchName).toBe(b.activeBranchName);
  });

  it("throws on an empty-branch plan", () => {
    expect(() => resolveContingency({ id: "e", branches: [] }, { metrics: {} })).toThrow();
  });
});

describe("validateContingencyPlan", () => {
  it("passes a well-formed plan", () => {
    const v = validateContingencyPlan(samplePlan());
    expect(v.valid).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it("warns when allocation legs do not sum to 100", () => {
    const plan = samplePlan();
    plan.branches[0]!.targetAllocation = [{ sleeve: "eq", targetPercent: 60 }];
    const v = validateContingencyPlan(plan);
    expect(v.valid).toBe(true);
    expect(v.warnings.some((w) => w.includes("not 100%"))).toBe(true);
  });

  it("errors on a pair operator with a scalar threshold", () => {
    const plan = samplePlan();
    // between with a scalar threshold is malformed.
    plan.branches[1]!.triggers = [
      { metric: "vix", operator: "between", threshold: 20 as unknown as [number, number] },
    ];
    const v = validateContingencyPlan(plan);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes("[low, high] pair"))).toBe(true);
  });

  it("errors on an inverted [low, high] pair", () => {
    const plan = samplePlan();
    plan.branches[1]!.triggers = [
      { metric: "vix", operator: "between", threshold: [25, 15] },
    ];
    const v = validateContingencyPlan(plan);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes("low 25 > high 15"))).toBe(true);
  });

  it("errors on duplicate branch names", () => {
    const plan = samplePlan();
    plan.branches.push({ ...plan.branches[0]! });
    const v = validateContingencyPlan(plan);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes("Duplicate branch"))).toBe(true);
  });
});

describe("formatContingencyResolution", () => {
  it("renders active branch and trigger detail", () => {
    const res = resolveContingency(samplePlan(), { metrics: { vix: 45, spx: 3000 } });
    const out = formatContingencyResolution(res);
    expect(out).toContain("ACTIVE: TAIL");
    expect(out).toContain("Summary:");
  });
});

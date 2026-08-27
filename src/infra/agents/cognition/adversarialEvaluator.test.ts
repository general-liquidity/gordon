import { describe, it, expect } from "bun:test";

import {
  isAdversarialEvaluatorEnabled,
  buildAdversarialPrompt,
  acceptIfAdversarial,
  formatAdversarialReport,
  reportToPayload,
  ADVERSARIAL_EVALUATOR_FLAG_ENV,
  type AdversarialReport,
  type FailureMode,
} from "./adversarialEvaluator.ts";

function fm(i: number, overrides: Partial<FailureMode> = {}): FailureMode {
  return {
    id: `fm-${i}`,
    category: "logic",
    severity: "medium",
    description: `failure ${i}`,
    ...overrides,
  };
}

describe("isAdversarialEvaluatorEnabled", () => {
  it("defaults on and respects the off-override", () => {
    expect(isAdversarialEvaluatorEnabled({})).toBe(true);
    expect(isAdversarialEvaluatorEnabled({ [ADVERSARIAL_EVALUATOR_FLAG_ENV]: "1" })).toBe(true);
    expect(isAdversarialEvaluatorEnabled({ [ADVERSARIAL_EVALUATOR_FLAG_ENV]: "true" })).toBe(true);
    expect(isAdversarialEvaluatorEnabled({ [ADVERSARIAL_EVALUATOR_FLAG_ENV]: "0" })).toBe(false);
    expect(isAdversarialEvaluatorEnabled({ [ADVERSARIAL_EVALUATOR_FLAG_ENV]: "false" })).toBe(
      false,
    );
  });
});

describe("buildAdversarialPrompt", () => {
  it("includes the 'assume broken' framing", () => {
    const p = buildAdversarialPrompt("review this plan");
    expect(p).toContain("ASSUME THIS WORK IS BROKEN");
  });

  it("includes the minimum-mode threshold", () => {
    const p = buildAdversarialPrompt("x", { minFailureModes: 5 });
    expect(p).toContain("at least 5 concrete failure modes");
  });

  it("includes the base task at the end", () => {
    const p = buildAdversarialPrompt("BASE_TASK_HERE");
    expect(p).toContain("BASE_TASK_HERE");
  });

  it("documents the allowed categories", () => {
    const p = buildAdversarialPrompt("x");
    expect(p).toContain("logic, safety, data");
  });
});

describe("acceptIfAdversarial — accepts strong reviews", () => {
  it("accepts a passed review with enough findings + categories", () => {
    const report: AdversarialReport = {
      passed: true,
      baseScore: 4.2,
      failureModes: [
        fm(1, { category: "logic" }),
        fm(2, { category: "safety" }),
        fm(3, { category: "data" }),
      ],
      rationale: "ok",
    };
    const r = acceptIfAdversarial(report);
    expect(r.accepted).toBe(true);
    expect(r.isAdversarial).toBe(true);
    expect(r.rejectionReasons).toEqual([]);
  });
});

describe("acceptIfAdversarial — rejects insufficient hostility", () => {
  it("rejects a passed review that found nothing", () => {
    const report: AdversarialReport = {
      passed: true,
      baseScore: 5,
      failureModes: [],
      rationale: "looks great!",
    };
    const r = acceptIfAdversarial(report);
    expect(r.accepted).toBe(false);
    expect(r.isAdversarial).toBe(false);
    expect(r.rejectionReasons[0]).toContain("only 0 failure modes");
  });

  it("rejects a review with too few categories (mono-axis)", () => {
    const report: AdversarialReport = {
      passed: true,
      baseScore: 4,
      failureModes: [
        fm(1, { category: "logic" }),
        fm(2, { category: "logic" }),
        fm(3, { category: "logic" }),
      ],
      rationale: "",
    };
    const r = acceptIfAdversarial(report);
    expect(r.accepted).toBe(false);
    expect(r.rejectionReasons.some((x) => x.includes("distinct categories"))).toBe(true);
  });

  it("accumulates multiple rejection reasons", () => {
    const report: AdversarialReport = {
      passed: true,
      baseScore: 5,
      failureModes: [fm(1, { category: "logic" })],
      rationale: "",
    };
    const r = acceptIfAdversarial(report);
    expect(r.rejectionReasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("acceptIfAdversarial — verdict-severity match", () => {
  it("rejects a failed review whose findings are all 'low'", () => {
    const report: AdversarialReport = {
      passed: false,
      baseScore: 1,
      failureModes: [
        fm(1, { category: "logic", severity: "low" }),
        fm(2, { category: "data", severity: "low" }),
        fm(3, { category: "scope", severity: "low" }),
      ],
      rationale: "",
    };
    const r = acceptIfAdversarial(report);
    expect(r.accepted).toBe(false);
    expect(r.rejectionReasons.some((x) => x.includes("severity"))).toBe(true);
  });

  it("accepts a failed review with at least one >= medium finding", () => {
    const report: AdversarialReport = {
      passed: false,
      baseScore: 1,
      failureModes: [
        fm(1, { category: "logic", severity: "low" }),
        fm(2, { category: "data", severity: "high" }),
        fm(3, { category: "scope", severity: "low" }),
      ],
      rationale: "",
    };
    const r = acceptIfAdversarial(report);
    // accepted=false because base.passed=false, but isAdversarial should be true
    expect(r.isAdversarial).toBe(true);
    expect(r.accepted).toBe(false); // base verdict was a fail
  });
});

describe("acceptIfAdversarial — option overrides", () => {
  it("respects custom minFailureModes", () => {
    const report: AdversarialReport = {
      passed: true,
      baseScore: 5,
      failureModes: [fm(1, { category: "logic" }), fm(2, { category: "safety" })],
      rationale: "",
    };
    const r = acceptIfAdversarial(report, { minFailureModes: 2, minDistinctCategories: 2 });
    expect(r.accepted).toBe(true);
  });

  it("respects custom minSeverityOnFail", () => {
    const report: AdversarialReport = {
      passed: false,
      baseScore: 1,
      failureModes: [
        fm(1, { severity: "medium", category: "logic" }),
        fm(2, { severity: "medium", category: "data" }),
        fm(3, { severity: "medium", category: "scope" }),
      ],
      rationale: "",
    };
    const strict = acceptIfAdversarial(report, { minSeverityOnFail: "critical" });
    expect(strict.isAdversarial).toBe(false);
    const lenient = acceptIfAdversarial(report, { minSeverityOnFail: "low" });
    expect(lenient.isAdversarial).toBe(true);
  });
});

describe("acceptIfAdversarial — hostility score", () => {
  it("scales with findings", () => {
    const small: AdversarialReport = {
      passed: true,
      baseScore: 4,
      failureModes: [fm(1)],
      rationale: "",
    };
    const big: AdversarialReport = {
      passed: true,
      baseScore: 4,
      failureModes: [
        fm(1, { severity: "critical" }),
        fm(2, { severity: "critical", category: "safety" }),
        fm(3, { severity: "high", category: "data" }),
      ],
      rationale: "",
    };
    expect(acceptIfAdversarial(big).hostilityScore).toBeGreaterThan(
      acceptIfAdversarial(small).hostilityScore,
    );
  });
});

describe("formatAdversarialReport", () => {
  it("includes accepted/rejected + per-mode lines", () => {
    const report: AdversarialReport = {
      passed: true,
      baseScore: 4,
      failureModes: [fm(1), fm(2, { category: "safety" }), fm(3, { category: "data" })],
      rationale: "",
    };
    const gate = acceptIfAdversarial(report);
    const out = formatAdversarialReport(report, gate);
    expect(out).toContain("ACCEPTED");
    expect(out).toContain("failure 1");
    expect(out).toContain("safety");
  });
});

describe("reportToPayload", () => {
  it("emits stable shape", () => {
    const report: AdversarialReport = {
      passed: true,
      baseScore: 4,
      failureModes: [fm(1), fm(2, { category: "safety" }), fm(3, { category: "data" })],
      rationale: "",
    };
    const gate = acceptIfAdversarial(report);
    const p = reportToPayload(report, gate);
    expect(p.kind).toBe("adversarial_eval.review_recorded");
    expect(p.accepted).toBe(true);
    expect(p.failureModeCount).toBe(3);
  });
});

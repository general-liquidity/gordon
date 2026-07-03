import { describe, it, expect } from "bun:test";
import {
  cohensKappa,
  spearmanRho,
  binarizeByThreshold,
  computeJudgeAgreement,
  agreementFromScores,
  formatAgreementReport,
  type LabelPair,
} from "./judgeAgreement.ts";

describe("cohensKappa", () => {
  it("is 1.0 for perfectly-agreeing labels with variety", () => {
    const pairs: LabelPair[] = [
      { judge: "pass", human: "pass" },
      { judge: "fail", human: "fail" },
      { judge: "pass", human: "pass" },
      { judge: "fail", human: "fail" },
    ];
    expect(cohensKappa(pairs)).toBeCloseTo(1, 6);
  });

  it("is ~0 for independent (chance-level) labels", () => {
    // Balanced marginals, observed agreement equals chance (0.5).
    const pairs: LabelPair[] = [
      { judge: "pass", human: "pass" },
      { judge: "pass", human: "fail" },
      { judge: "fail", human: "pass" },
      { judge: "fail", human: "fail" },
    ];
    expect(cohensKappa(pairs)).toBeCloseTo(0, 6);
  });

  it("returns 1 for the degenerate single-category perfect case", () => {
    const pairs: LabelPair[] = [
      { judge: "pass", human: "pass" },
      { judge: "pass", human: "pass" },
    ];
    expect(cohensKappa(pairs)).toBe(1);
  });

  it("is negative for systematic disagreement", () => {
    const pairs: LabelPair[] = [
      { judge: "pass", human: "fail" },
      { judge: "fail", human: "pass" },
      { judge: "pass", human: "fail" },
      { judge: "fail", human: "pass" },
    ];
    expect(cohensKappa(pairs)).toBeLessThan(0);
  });

  it("returns 0 for empty input", () => {
    expect(cohensKappa([])).toBe(0);
  });
});

describe("spearmanRho", () => {
  it("is 1 for a perfectly monotone-increasing pair", () => {
    expect(spearmanRho([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 6);
  });
  it("is -1 for a perfectly reversed pair", () => {
    expect(spearmanRho([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 6);
  });
  it("handles ties via average ranks", () => {
    // Constant second series -> zero variance -> 0.
    expect(spearmanRho([1, 2, 3], [5, 5, 5])).toBe(0);
  });
  it("returns 0 for too-short input", () => {
    expect(spearmanRho([1], [2])).toBe(0);
  });
});

describe("binarizeByThreshold", () => {
  it("splits at the threshold (>= is pass)", () => {
    expect(binarizeByThreshold([0.9, 0.5, 0.49, 0.1], 0.5)).toEqual([
      "pass",
      "pass",
      "fail",
      "fail",
    ]);
  });
});

describe("computeJudgeAgreement", () => {
  it("meets the bar for strong agreement and reports categories", () => {
    const pairs: LabelPair[] = [
      { judge: "pass", human: "pass" },
      { judge: "pass", human: "pass" },
      { judge: "fail", human: "fail" },
      { judge: "fail", human: "fail" },
      { judge: "pass", human: "pass" },
    ];
    const report = computeJudgeAgreement({ pairs });
    expect(report.n).toBe(5);
    expect(report.kappa).toBe(1);
    expect(report.agreement).toBe(1);
    expect(report.categories).toEqual(["fail", "pass"]);
    expect(report.meetsBar).toBe(true);
  });

  it("fails the bar at chance-level agreement", () => {
    const pairs: LabelPair[] = [
      { judge: "pass", human: "pass" },
      { judge: "pass", human: "fail" },
      { judge: "fail", human: "pass" },
      { judge: "fail", human: "fail" },
    ];
    const report = computeJudgeAgreement({ pairs });
    expect(report.meetsBar).toBe(false);
    expect(report.spearman).toBeUndefined();
  });

  it("threads Spearman rho when numeric scores are supplied", () => {
    const pairs: LabelPair[] = [
      { judge: "pass", human: "pass" },
      { judge: "fail", human: "fail" },
    ];
    const report = computeJudgeAgreement({
      pairs,
      judgeScores: [0.9, 0.2],
      humanScores: [0.8, 0.3],
    });
    expect(report.spearman).toBeCloseTo(1, 6);
  });
});

describe("agreementFromScores", () => {
  it("derives labels + kappa + spearman from raw score pairs", () => {
    const judge = [0.9, 0.8, 0.2, 0.1];
    const human = [0.85, 0.7, 0.3, 0.15];
    const report = agreementFromScores(judge, human);
    expect(report.kappa).toBe(1); // both threshold to pass,pass,fail,fail
    expect(report.agreement).toBe(1);
    expect(report.spearman).toBeCloseTo(1, 6);
    expect(report.meetsBar).toBe(true);
  });

  it("catches a judge that agrees on order but disagrees on the pass line", () => {
    // Judge passes everything; human fails the low two -> disagreement.
    const judge = [0.9, 0.8, 0.7, 0.6];
    const human = [0.9, 0.8, 0.3, 0.2];
    const report = agreementFromScores(judge, human, { threshold: 0.5 });
    expect(report.agreement).toBeLessThan(1);
    expect(report.meetsBar).toBe(false);
    // Order is still perfectly correlated even though the labels diverge.
    expect(report.spearman).toBeCloseTo(1, 6);
  });

  it("formatAgreementReport prints a verdict line", () => {
    const report = agreementFromScores([0.9, 0.2], [0.8, 0.3]);
    const text = formatAgreementReport(report);
    expect(text).toContain("judge-agreement");
    expect(text).toContain("kappa");
  });
});

import { describe, it, expect } from "bun:test";

import {
  isOperatorEquationEnabled,
  evaluateOperatorEquation,
  formatResult,
  equationToPayload,
  OPERATOR_EQUATION_FLAG_ENV,
} from "./operatorEquation.ts";

describe("isOperatorEquationEnabled", () => {
  it("respects the flag", () => {
    expect(isOperatorEquationEnabled({})).toBe(false);
    expect(isOperatorEquationEnabled({ [OPERATOR_EQUATION_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("evaluateOperatorEquation — math", () => {
  it("computes performance = (EV × exposure) − friction", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.4,
      optimalExposureFraction: 0.01,
      frictionR: 0.001,
    });
    expect(r.performanceR).toBeCloseTo(0.003, 5);
  });

  it("converts to dollars when risk capital provided", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.4,
      optimalExposureFraction: 0.01,
      frictionR: 0.001,
      riskCapitalUsd: 100_000,
    });
    expect(r.performanceUsd).toBeCloseTo(300, 1);
  });

  it("leaves dollar performance null when capital not provided", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.4,
      optimalExposureFraction: 0.01,
      frictionR: 0.001,
    });
    expect(r.performanceUsd).toBeNull();
  });
});

describe("evaluateOperatorEquation — failure modes", () => {
  it("none: all three variables aligned", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.5,
      optimalExposureFraction: 0.01,
      frictionR: 0.0005,
    });
    expect(r.failureMode).toBe("none");
  });

  it("edge_chaser: friction exceeds 40% of gross expectancy", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.3,
      optimalExposureFraction: 0.01,
      frictionR: 0.0015,
    });
    expect(r.failureMode).toBe("edge_chaser");
    expect(r.recommendation.toLowerCase()).toContain("limit orders");
  });

  it("size_junkie: large exposure with weak edge", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.1,
      optimalExposureFraction: 0.08,
      frictionR: 0.001,
    });
    expect(r.failureMode).toBe("size_junkie");
    expect(r.recommendation.toLowerCase()).toContain("kelly");
  });

  it("penny_pincher: marginal EV with great friction discipline", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.03,
      optimalExposureFraction: 0.01,
      frictionR: 0.00001,
    });
    expect(r.failureMode).toBe("penny_pincher");
  });

  it("underexposed: sub-threshold exposure with real edge", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.5,
      optimalExposureFraction: 0.001,
      frictionR: 0.00001,
    });
    expect(r.failureMode).toBe("underexposed");
  });

  it("negative_after_friction: performance is net negative", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.1,
      optimalExposureFraction: 0.005,
      frictionR: 0.002,
    });
    expect(r.failureMode).toBe("negative_after_friction");
    expect(r.performanceR).toBeLessThan(0);
  });
});

describe("evaluateOperatorEquation — frictionRatio", () => {
  it("low friction yields low ratio", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.4,
      optimalExposureFraction: 0.01,
      frictionR: 0.0002,
    });
    expect(r.frictionRatio).toBeCloseTo(0.05, 2);
  });

  it("Infinity ratio when gross is zero", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0,
      optimalExposureFraction: 0,
      frictionR: 0.001,
    });
    expect(r.frictionRatio).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("formatResult + equationToPayload", () => {
  it("formats a multi-line summary", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.4,
      optimalExposureFraction: 0.01,
      frictionR: 0.001,
      riskCapitalUsd: 100_000,
    });
    const out = formatResult(r);
    expect(out).toContain("Operator equation:");
    expect(out).toContain("Dollar performance/trade:");
  });

  it("payload omits null performanceUsd", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.4,
      optimalExposureFraction: 0.01,
      frictionR: 0.001,
    });
    const p = equationToPayload(r) as { kind: string; performanceUsd: number | null };
    expect(p.kind).toBe("operator_equation.evaluated");
    expect(p.performanceUsd).toBeNull();
  });
});

describe("Wright Ch 6 institutional desk scenario", () => {
  it("30bp gross → 8-10bp net after execution: friction is the bottleneck for retail", () => {
    const r = evaluateOperatorEquation({
      expectedValueR: 0.3,
      optimalExposureFraction: 0.01,
      frictionR: 0.0022,
    });
    expect(r.performanceR).toBeCloseTo(0.0008, 4);
    expect(r.failureMode).toBe("edge_chaser");
  });
});

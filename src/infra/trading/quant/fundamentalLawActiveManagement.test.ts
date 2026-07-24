import { describe, it, expect } from "bun:test";
import {
  computeFundamentalLawAM,
  fundamentalLawAMToPayload,
} from "./fundamentalLawActiveManagement.ts";

describe("computeFundamentalLawAM — formula", () => {
  it("Sharpe = IC × √breadth", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0.1,
      breadthPerYear: 100,
    });
    expect(r.theoreticalSharpe).toBeCloseTo(0.1 * 10, 9); // IC=0.1, √100=10
  });

  it("doubling breadth multiplies Sharpe by √2", () => {
    const a = computeFundamentalLawAM({ informationCoefficient: 0.05, breadthPerYear: 100 });
    const b = computeFundamentalLawAM({ informationCoefficient: 0.05, breadthPerYear: 200 });
    expect(b.theoreticalSharpe / a.theoreticalSharpe).toBeCloseTo(Math.sqrt(2), 6);
  });

  it("zero IC → zero Sharpe", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0,
      breadthPerYear: 1000,
    });
    expect(r.theoreticalSharpe).toBe(0);
  });

  it("zero breadth → zero Sharpe", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0.1,
      breadthPerYear: 0,
    });
    expect(r.theoreticalSharpe).toBe(0);
  });

  it("negative IC produces negative Sharpe", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: -0.1,
      breadthPerYear: 100,
    });
    expect(r.theoreticalSharpe).toBeLessThan(0);
  });
});

describe("computeFundamentalLawAM — target gap analysis", () => {
  it("required IC = target / √breadth", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0.05,
      breadthPerYear: 100,
      targetSharpe: 2.0,
    });
    expect(r.requiredICForTarget).toBeCloseTo(2.0 / 10, 9);
  });

  it("required breadth = (target / IC)²", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0.1,
      breadthPerYear: 50,
      targetSharpe: 2.0,
    });
    expect(r.requiredBreadthForTarget).toBeCloseTo(400, 6);
  });

  it("meetsTarget = true when theoretical >= target", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0.3,
      breadthPerYear: 100,
      targetSharpe: 2.0,
    });
    expect(r.theoreticalSharpe).toBeGreaterThan(2);
    expect(r.meetsTarget).toBe(true);
  });

  it("meetsTarget = false when theoretical < target", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0.01,
      breadthPerYear: 100,
      targetSharpe: 2.0,
    });
    expect(r.meetsTarget).toBe(false);
  });

  it("no target → all gap fields null", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0.1,
      breadthPerYear: 100,
    });
    expect(r.requiredICForTarget).toBeNull();
    expect(r.requiredBreadthForTarget).toBeNull();
    expect(r.meetsTarget).toBeNull();
  });
});

describe("computeFundamentalLawAM — validation", () => {
  it("throws on negative breadth", () => {
    expect(() =>
      computeFundamentalLawAM({ informationCoefficient: 0.1, breadthPerYear: -1 }),
    ).toThrow();
  });
  it("throws on IC outside [-1, 1]", () => {
    expect(() =>
      computeFundamentalLawAM({ informationCoefficient: 1.5, breadthPerYear: 100 }),
    ).toThrow();
  });
});

describe("fundamentalLawAMToPayload", () => {
  it("emits stable shape", () => {
    const r = computeFundamentalLawAM({
      informationCoefficient: 0.1,
      breadthPerYear: 100,
    });
    const p = fundamentalLawAMToPayload(r) as { kind: string };
    expect(p.kind).toBe("fundamental_law_am.computed");
  });
});

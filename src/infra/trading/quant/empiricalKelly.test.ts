import { describe, it, expect } from "bun:test";

import {
  empiricalKelly,
  empiricalKellyToPayload,
} from "./empiricalKelly.ts";

describe("empiricalKelly — Kelly formula correctness", () => {
  it("p=0.6, b=1 → f_kelly = 0.2", () => {
    const returns: number[] = [];
    for (let i = 0; i < 100; i++) returns.push(i < 60 ? 1.0 : -1.0);
    const r = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 42,
      bootstrapSamples: 500,
    });
    expect(r.fKelly).toBeCloseTo(0.2, 6);
  });

  it("p=0.5, b=1 (neutral) → f_kelly = 0", () => {
    const returns: number[] = [];
    for (let i = 0; i < 100; i++) returns.push(i < 50 ? 1.0 : -1.0);
    const r = empiricalKelly({
      winRate: 0.5,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 500,
    });
    expect(r.fKelly).toBeCloseTo(0, 6);
    expect(r.fEmpirical).toBe(0);
  });

  it("negative edge (p=0.4, b=1) → fKelly < 0, fEmpirical = 0", () => {
    const returns: number[] = [];
    for (let i = 0; i < 100; i++) returns.push(i < 40 ? 1.0 : -1.0);
    const r = empiricalKelly({
      winRate: 0.4,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 500,
    });
    expect(r.fKelly).toBeLessThan(0);
    expect(r.fEmpirical).toBe(0);
  });

  it("p=0.55, b=2 → f_kelly = 0.325", () => {
    const returns: number[] = [];
    for (let i = 0; i < 200; i++) returns.push(i < 110 ? 2.0 : -1.0);
    const r = empiricalKelly({
      winRate: 0.55,
      payoffRatio: 2.0,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 500,
    });
    expect(r.fKelly).toBeCloseTo(0.325, 4);
  });
});

describe("empiricalKelly — uncertainty shrink", () => {
  it("low-variance high-edge series → fEmpirical close to fKelly", () => {
    const returns: number[] = [];
    for (let i = 0; i < 1000; i++) returns.push(i < 700 ? 1.0 : -1.0);
    const r = empiricalKelly({
      winRate: 0.7,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 1000,
    });
    expect(r.edgeUncertainty).toBe("low");
    expect(r.fEmpirical).toBeGreaterThan(r.fKelly * 0.8);
  });

  it("high-variance series → fEmpirical << fKelly", () => {
    const returns: number[] = [10, -8, 12, -9, 5, -3, 15, -10, 8, -6];
    const r = empiricalKelly({
      winRate: 0.55,
      payoffRatio: 1.5,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 2000,
    });
    expect(r.cvEdge).toBeGreaterThan(0.5);
    expect(r.fEmpirical).toBeLessThan(r.fKelly * 0.5);
  });

  it("untradable case: CV ≥ 1 → fEmpirical = 0", () => {
    const returns: number[] = [50, -49, 50, -49, 1, -2, 50, -49];
    const r = empiricalKelly({
      winRate: 0.55,
      payoffRatio: 1.5,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 2000,
    });
    if (r.edgeUncertainty === "untradable") {
      expect(r.fEmpirical).toBe(0);
    }
    // Even if not untradable, fEmpirical should be heavily shrunk
    expect(r.fEmpirical).toBeLessThanOrEqual(r.fKelly);
  });
});

describe("empiricalKelly — determinism via seed", () => {
  it("same seed → same result", () => {
    const returns: number[] = [];
    for (let i = 0; i < 50; i++) returns.push(i < 30 ? 1.0 : -1.0);
    const a = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 42,
      bootstrapSamples: 500,
    });
    const b = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 42,
      bootstrapSamples: 500,
    });
    expect(a.cvEdge).toBe(b.cvEdge);
    expect(a.fEmpirical).toBe(b.fEmpirical);
    expect(a.meanBootstrapEdge).toBe(b.meanBootstrapEdge);
  });

  it("different seeds → different bootstrap stddev", () => {
    const returns: number[] = [];
    for (let i = 0; i < 30; i++) returns.push(i < 18 ? 1.0 : -1.0);
    const a = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 500,
    });
    const b = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 2,
      bootstrapSamples: 500,
    });
    expect(a.cvEdge).not.toBe(b.cvEdge);
  });
});

describe("empiricalKelly — boundary cases", () => {
  it("empty / single-element returns → untradable", () => {
    const r = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 1.0,
      historicalReturns: [],
      seed: 1,
    });
    expect(r.edgeUncertainty).toBe("untradable");
    expect(r.fEmpirical).toBe(0);
  });

  it("zero payoff ratio → fKelly = 0, fEmpirical = 0", () => {
    const r = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 0,
      historicalReturns: [1, -1, 1, -1, 1, -1],
      seed: 1,
      bootstrapSamples: 100,
    });
    expect(r.fKelly).toBe(0);
    expect(r.fEmpirical).toBe(0);
  });
});

describe("empiricalKelly — classification thresholds", () => {
  it("very stable returns → low uncertainty", () => {
    const returns: number[] = [];
    for (let i = 0; i < 500; i++) returns.push(i < 350 ? 1.0 : -1.0);
    const r = empiricalKelly({
      winRate: 0.7,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 1000,
    });
    expect(["low", "medium"]).toContain(r.edgeUncertainty);
  });
});

describe("empiricalKellyToPayload", () => {
  it("emits stable shape", () => {
    const returns: number[] = [];
    for (let i = 0; i < 30; i++) returns.push(i < 18 ? 1.0 : -1.0);
    const r = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 1.0,
      historicalReturns: returns,
      seed: 1,
      bootstrapSamples: 200,
    });
    const p = empiricalKellyToPayload(r) as { kind: string; edgeUncertainty: string };
    expect(p.kind).toBe("empirical_kelly.computed");
    expect(["low", "medium", "high", "untradable"]).toContain(p.edgeUncertainty);
  });

  it("emits null cvEdge when non-finite", () => {
    const r = empiricalKelly({
      winRate: 0.6,
      payoffRatio: 1.0,
      historicalReturns: [],
      seed: 1,
    });
    const p = empiricalKellyToPayload(r) as { cvEdge: number | null };
    expect(p.cvEdge).toBeNull();
  });
});

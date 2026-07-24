import { describe, it, expect } from "bun:test";

import {
  evaluateDecay,
  decayToPayload,
} from "./edgeDecayMonitor.ts";

const goodRuns = (n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i % 3 === 0 ? -1.0 : 1.5);
  return out;
};

const decayingRuns = (recent: number, baseline: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < recent; i++) out.push(i % 4 === 0 ? -1.0 : 0.4);
  for (let i = 0; i < baseline; i++) out.push(i % 3 === 0 ? -1.0 : 1.5);
  return out;
};

describe("evaluateDecay — sample size", () => {
  it("returns stable when insufficient sample", () => {
    const r = evaluateDecay({ setupId: "s", rMultiples: [0.5, 0.5, 0.5] });
    expect(r.state).toBe("stable");
    expect(r.reason).toContain("Insufficient sample");
  });
});

describe("evaluateDecay — stable edge", () => {
  it("recent matches baseline → stable", () => {
    const r = evaluateDecay({ setupId: "s", rMultiples: goodRuns(60) });
    expect(r.state).toBe("stable");
    expect(r.recommendedSizeMultiplier).toBe(1.0);
  });
});

describe("evaluateDecay — degradation", () => {
  it("recent at ~40% of baseline → degraded", () => {
    const r = evaluateDecay({ setupId: "s", rMultiples: decayingRuns(20, 40) });
    expect(r.state === "degraded" || r.state === "retire").toBe(true);
    expect(r.ratio).toBeLessThan(0.6);
  });
});

describe("evaluateDecay — retirement", () => {
  it("recent at <30% of baseline → retire", () => {
    const baseline: number[] = [];
    for (let i = 0; i < 40; i++) baseline.push(1.0);
    const recent: number[] = [];
    for (let i = 0; i < 20; i++) recent.push(0.1);
    const r = evaluateDecay({
      setupId: "s",
      rMultiples: [...recent, ...baseline],
    });
    expect(r.state).toBe("retire");
    expect(r.recommendedSizeMultiplier).toBe(0);
  });
});

describe("evaluateDecay — baseline non-positive", () => {
  it("baseline ≤ 0 produces stable verdict with note", () => {
    const baseline = Array(40).fill(-0.5);
    const recent = Array(20).fill(-0.5);
    const r = evaluateDecay({
      setupId: "s",
      rMultiples: [...recent, ...baseline],
    });
    expect(r.state).toBe("stable");
    expect(r.reason).toContain("non-positive");
  });
});

describe("evaluateDecay — custom thresholds", () => {
  it("stricter degraded threshold catches small drops", () => {
    const baseline = Array(40).fill(1.0);
    const recent = Array(20).fill(0.85);
    const r = evaluateDecay({
      setupId: "s",
      rMultiples: [...recent, ...baseline],
      degradedThreshold: 0.9,
    });
    expect(r.state).toBe("degraded");
  });
});

describe("decayToPayload", () => {
  it("emits stable shape", () => {
    const r = evaluateDecay({ setupId: "s", rMultiples: goodRuns(60) });
    const p = decayToPayload(r) as { kind: string; state: string };
    expect(p.kind).toBe("edge_decay.evaluated");
    expect(p.state).toBe("stable");
  });
});

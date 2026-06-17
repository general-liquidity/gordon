import { describe, expect, test } from "bun:test";

import { retrieveAnalogs, type AnalogState } from "./market-analog.ts";

/** Deterministic LCG → reproducible pseudo-random in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** N candidates with one predictive feature; forwardReturn = slope·feature0 + noise. */
function syntheticEdge(n: number, slope: number, noiseScale: number, seed: number): AnalogState[] {
  const rf = lcg(seed);
  const rn = lcg(seed + 7);
  const out: AnalogState[] = [];
  for (let i = 0; i < n; i++) {
    const f0 = rf() * 6 - 3; // uniform [-3, 3]
    const noise = (rn() - 0.5) * 2 * noiseScale;
    out.push({ features: [f0], forwardReturn: slope * f0 + noise, id: `s${i}` });
  }
  return out;
}

describe("retrieveAnalogs", () => {
  test("informative neighborhood: a real feature→return edge is recovered and graded informative", () => {
    const candidates = syntheticEdge(300, 0.01, 0.001, 1);
    const res = retrieveAnalogs([1.0], candidates, { k: 30 });

    expect(res.neighbors.length).toBe(30);
    // forwardReturn ≈ 0.01·1.0 = +1% for the analogs of a +1.0 trend state.
    expect(res.analog.mean).toBeGreaterThan(0.007);
    expect(res.analog.mean).toBeLessThan(0.013);
    // Unconditional mean ≈ 0.01·E[feature0] ≈ 0 → the shift is the edge.
    expect(res.edgeShift).toBeGreaterThan(0.007);
    expect(res.pValue).not.toBeNull();
    expect(res.pValue!).toBeLessThan(0.05);
    expect(res.proximity).toBeLessThan(0.6);
    expect(res.confidence).toBe("informative");
  });

  test("symmetry: a −trend query yields the mirrored (negative) forward edge", () => {
    const candidates = syntheticEdge(300, 0.01, 0.001, 1);
    const res = retrieveAnalogs([-1.0], candidates, { k: 30 });
    expect(res.analog.mean).toBeLessThan(-0.007);
    expect(res.edgeShift).toBeLessThan(-0.007);
  });

  test("uninformative features: return independent of features → no shift, not informative", () => {
    // slope 0 ⇒ forwardReturn is pure noise, unrelated to feature0.
    const candidates = syntheticEdge(300, 0, 0.01, 2);
    const res = retrieveAnalogs([1.5], candidates, { k: 30 });
    expect(Math.abs(res.edgeShift)).toBeLessThan(0.004);
    expect(res.confidence).not.toBe("informative");
  });

  test("scale-invariance: standardization recovers a tiny-scale predictor under a huge nuisance feature", () => {
    const rf = lcg(3);
    const rg = lcg(99);
    const candidates: AnalogState[] = [];
    for (let i = 0; i < 300; i++) {
      const predictive = (rf() * 6 - 3) * 0.001; // scale ~1e-3
      const nuisance = (rg() * 2000 - 1000); // scale ~1e3, independent of return
      candidates.push({ features: [predictive, nuisance], forwardReturn: 10 * predictive });
    }
    // Query: high on the predictive axis, neutral on the nuisance axis.
    const res = retrieveAnalogs([0.002, 0], candidates, { k: 30 });
    // 10 · 0.002 = +0.02 expected forward; only recoverable if the tiny predictor
    // wasn't drowned out by the 1e6×-larger nuisance feature (i.e. standardization works).
    expect(res.analog.mean).toBeGreaterThan(0.01);
    expect(res.edgeShift).toBeGreaterThan(0.008);
  });

  test("outlier query: a state far outside the candidate cloud is graded unreliable", () => {
    const rf = lcg(4);
    const candidates: AnalogState[] = [];
    for (let i = 0; i < 300; i++) {
      const f = rf() * 2 - 1; // tight cluster in [-1, 1]
      candidates.push({ features: [f], forwardReturn: 0.01 * f });
    }
    const res = retrieveAnalogs([50], candidates, { k: 30 });
    expect(res.proximity).toBeGreaterThan(0.85);
    expect(res.confidence).toBe("unreliable");
  });

  test("too few candidates → unreliable regardless of fit", () => {
    const candidates = syntheticEdge(20, 0.01, 0.001, 5);
    const res = retrieveAnalogs([1.0], candidates, { k: 30 });
    expect(res.confidence).toBe("unreliable");
  });

  test("forward distribution percentiles are monotone and weights normalize", () => {
    const candidates = syntheticEdge(300, 0.01, 0.002, 6);
    const res = retrieveAnalogs([0.5], candidates, { k: 40 });
    const d = res.analog;
    expect(d.p05).toBeLessThanOrEqual(d.p25);
    expect(d.p25).toBeLessThanOrEqual(d.median);
    expect(d.median).toBeLessThanOrEqual(d.p75);
    expect(d.p75).toBeLessThanOrEqual(d.p95);
    const wSum = res.neighbors.reduce((s, n) => s + n.weight, 0);
    expect(wSum).toBeCloseTo(1, 6);
    expect(d.winRate).toBeGreaterThanOrEqual(0);
    expect(d.winRate).toBeLessThanOrEqual(1);
    // neighbors are nearest-first
    for (let i = 1; i < res.neighbors.length; i++) {
      expect(res.neighbors[i]!.distance).toBeGreaterThanOrEqual(res.neighbors[i - 1]!.distance);
    }
  });

  test("gaussian weighting pulls the estimate toward the nearest analog", () => {
    // Nearest analog carries a distinct +5% return; farther analogs are flat.
    const candidates: AnalogState[] = [];
    candidates.push({ features: [0.0], forwardReturn: 0.05 }); // the nearest to query 0
    for (let i = 1; i <= 200; i++) {
      candidates.push({ features: [i * 0.05], forwardReturn: 0 });
    }
    const uniform = retrieveAnalogs([0], candidates, { k: 30, weighting: "uniform" });
    const gaussian = retrieveAnalogs([0], candidates, { k: 30, weighting: "gaussian" });
    expect(gaussian.analog.mean).toBeGreaterThan(uniform.analog.mean);
  });

  test("empty / mismatched candidates degrade gracefully", () => {
    const res = retrieveAnalogs([1, 2], [], {});
    expect(res.confidence).toBe("unreliable");
    expect(res.neighbors.length).toBe(0);
    expect(res.analog.n).toBe(0);
  });
});

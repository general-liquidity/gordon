import { describe, it, expect } from "bun:test";
import { runDirectionalEdgeTest, directionalEdgeTestToPayload } from "./directionalEdgeTest.ts";

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randn(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function steadyDirectional(n: number, mean: number, vol: number, seed: number): number[] {
  const rng = lcg(seed);
  return Array.from({ length: n }, () => mean + randn(rng) * vol);
}

function zeroMean(n: number, vol: number, seed: number): number[] {
  const rng = lcg(seed);
  return Array.from({ length: n }, () => randn(rng) * vol);
}

describe("runDirectionalEdgeTest — degenerate cases", () => {
  it("too few returns → noise with reasoning", () => {
    const r = runDirectionalEdgeTest({ returns: [0.01, 0.02] });
    expect(r.verdict).toBe("noise");
    expect(r.reasoning).toContain("need");
  });
});

describe("runDirectionalEdgeTest — real directional edge", () => {
  it("strong positive-mean series → real_edge verdict, high percentile", () => {
    // Mean ~10x vol over 252 obs gives a very high Sharpe; sign flips destroy it.
    const returns = steadyDirectional(252, 0.005, 0.01, 17);
    const r = runDirectionalEdgeTest({ returns, samples: 200, seed: 1 });
    expect(r.verdict).toBe("real_edge");
    expect(r.edgePercentile).toBeGreaterThan(0.95);
    expect(Math.abs(r.realizedSharpe)).toBeGreaterThan(r.nullMedianAbsSharpe);
  });

  it("strong negative-mean series → real_edge (|Sharpe| also high)", () => {
    const returns = steadyDirectional(252, -0.005, 0.01, 19);
    const r = runDirectionalEdgeTest({ returns, samples: 200, seed: 2 });
    expect(r.verdict).toBe("real_edge");
  });
});

describe("runDirectionalEdgeTest — noise (no directional edge)", () => {
  it("zero-mean noise rarely reaches real_edge (population property)", () => {
    // Single-seed asserts on noise are flaky: a finite zero-mean series
    // will occasionally produce a high |Sharpe| by chance. Test the
    // population property — across multiple independent noise samples,
    // very few should hit real_edge.
    let realEdgeHits = 0;
    let nonRealHits = 0;
    const trials = 12;
    for (let i = 0; i < trials; i++) {
      const returns = zeroMean(252, 0.01, 100 + i);
      const r = runDirectionalEdgeTest({ returns, samples: 150, seed: 200 + i });
      if (r.verdict === "real_edge") realEdgeHits++;
      else nonRealHits++;
    }
    expect(realEdgeHits).toBeLessThanOrEqual(2);
    expect(nonRealHits).toBeGreaterThan(trials / 2);
  });
});

describe("runDirectionalEdgeTest — reproducibility", () => {
  it("same seed → same percentile", () => {
    const returns = steadyDirectional(252, 0.001, 0.01, 29);
    const r1 = runDirectionalEdgeTest({ returns, samples: 100, seed: 42 });
    const r2 = runDirectionalEdgeTest({ returns, samples: 100, seed: 42 });
    expect(r1.edgePercentile).toBe(r2.edgePercentile);
    expect(r1.nullMedianAbsSharpe).toBe(r2.nullMedianAbsSharpe);
  });
});

describe("runDirectionalEdgeTest — null distribution properties", () => {
  it("null CI brackets the median", () => {
    const returns = steadyDirectional(252, 0.001, 0.01, 31);
    const r = runDirectionalEdgeTest({ returns, samples: 200, seed: 5 });
    expect(r.nullCi05).toBeLessThanOrEqual(r.nullMedianAbsSharpe);
    expect(r.nullMedianAbsSharpe).toBeLessThanOrEqual(r.nullCi95);
  });
});

describe("directionalEdgeTestToPayload", () => {
  it("emits stable shape", () => {
    const returns = steadyDirectional(100, 0.001, 0.01, 37);
    const r = runDirectionalEdgeTest({ returns, samples: 100, seed: 7 });
    const p = directionalEdgeTestToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("directional_edge_test.evaluated");
    expect(["real_edge", "marginal_edge", "noise"]).toContain(p.verdict);
  });
});

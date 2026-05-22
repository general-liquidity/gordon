import { describe, it, expect } from "bun:test";
import {
  computeMarginalContribution,
  equityCurveToReturns,
} from "./marginal-contribution.ts";

function syntheticEquity(n: number, drift: number, vol: number, seed: number = 1): number[] {
  let state = (seed | 0) >>> 0;
  const rng = () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [100];
  for (let i = 1; i < n; i++) {
    const noise = (rng() - 0.5) * 2 * vol;
    out.push(out[i - 1]! * (1 + drift + noise));
  }
  return out;
}

describe("equityCurveToReturns", () => {
  it("computes period-over-period returns", () => {
    expect(equityCurveToReturns([100, 110, 99]).map((r) => parseFloat(r.toFixed(4)))).toEqual([
      0.1,
      -0.1,
    ]);
  });

  it("skips zero-price entries gracefully", () => {
    const returns = equityCurveToReturns([100, 0, 50]);
    expect(returns.length).toBeLessThanOrEqual(2);
  });
});

describe("computeMarginalContribution — basic shape", () => {
  it("returns insufficient_data for short candidate", () => {
    const result = computeMarginalContribution(
      { existing: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110] },
      "candidate",
      [100, 101, 102],
    );
    expect(result.verdict).toBe("insufficient_data");
  });

  it("returns adds_diversification for empty portfolio", () => {
    const result = computeMarginalContribution({}, "candidate", syntheticEquity(50, 0.001, 0.01));
    expect(result.verdict).toBe("adds_diversification");
  });

  it("returns insufficient_data on length mismatch", () => {
    const result = computeMarginalContribution(
      { existing: syntheticEquity(20, 0.001, 0.01) },
      "candidate",
      syntheticEquity(50, 0.001, 0.01),
    );
    expect(result.verdict).toBe("insufficient_data");
  });
});

describe("computeMarginalContribution — verdict bands", () => {
  it("flags identical-twin candidate as redundant", () => {
    const existing = syntheticEquity(100, 0.001, 0.02, 42);
    const candidate = [...existing]; // identical curve
    const result = computeMarginalContribution(
      { strategy_a: existing },
      "twin",
      candidate,
    );
    expect(["redundant", "marginal", "worse"]).toContain(result.verdict);
    expect(Math.abs(result.meanAbsCorrelation)).toBeGreaterThan(0.95);
  });

  it("flags an uncorrelated candidate as adds_diversification or marginal", () => {
    const a = syntheticEquity(120, 0.001, 0.02, 1);
    const b = syntheticEquity(120, 0.001, 0.02, 999); // different seed → low correlation
    const result = computeMarginalContribution({ existing: a }, "candidate", b);
    expect(["adds_diversification", "marginal"]).toContain(result.verdict);
    expect(result.meanAbsCorrelation).toBeLessThan(0.5);
  });

  it("computes drawdown overlap stats", () => {
    const a = syntheticEquity(80, 0.001, 0.02, 1);
    const b = syntheticEquity(80, 0.001, 0.02, 12345);
    const result = computeMarginalContribution({ a }, "b", b);
    expect(result.drawdownOverlap.totalDays).toBe(80);
    expect(result.drawdownOverlap.coDrawdownDays).toBeGreaterThanOrEqual(0);
    expect(result.drawdownOverlap.overlapRatio).toBeGreaterThanOrEqual(0);
    expect(result.drawdownOverlap.overlapRatio).toBeLessThanOrEqual(1);
    expect(result.drawdownOverlap.candidateMaxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.drawdownOverlap.portfolioMaxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it("reports pairwise correlations with each existing strategy", () => {
    const a = syntheticEquity(80, 0.001, 0.02, 1);
    const b = syntheticEquity(80, 0.001, 0.02, 2);
    const c = syntheticEquity(80, 0.001, 0.02, 3);
    const result = computeMarginalContribution(
      { strat_a: a, strat_b: b },
      "strat_c",
      c,
    );
    expect(result.pairwiseCorrelations.length).toBe(2);
    expect(result.pairwiseCorrelations.map((p) => p.existingId).sort()).toEqual([
      "strat_a",
      "strat_b",
    ]);
  });
});

describe("computeMarginalContribution — effective N delta", () => {
  it("effective-N delta is non-negative when candidate uncorrelated with portfolio", () => {
    const a = syntheticEquity(80, 0.001, 0.02, 1);
    const b = syntheticEquity(80, 0.001, 0.02, 999);
    const result = computeMarginalContribution({ a }, "b", b);
    // Adding any strategy to a 1-strategy portfolio increases effective N
    expect(result.effectiveNDelta).toBeGreaterThan(0);
  });

  it("base effective N reflects existing-portfolio diversity", () => {
    const a = syntheticEquity(80, 0.001, 0.02, 1);
    const b = syntheticEquity(80, 0.001, 0.02, 999);
    const c = syntheticEquity(80, 0.001, 0.02, 5);
    const result = computeMarginalContribution({ a, b }, "c", c);
    expect(result.baseEffectiveN).toBeGreaterThan(1);
    expect(result.baseEffectiveN).toBeLessThanOrEqual(2);
  });
});

describe("computeMarginalContribution — summary text", () => {
  it("summary includes mean correlation + effective N delta + overlap + verdict", () => {
    const a = syntheticEquity(80, 0.001, 0.02, 1);
    const b = syntheticEquity(80, 0.001, 0.02, 999);
    const result = computeMarginalContribution({ a }, "b", b);
    expect(result.summary).toContain("ρ̄");
    expect(result.summary).toContain("effective N");
    expect(result.summary).toContain("DD overlap");
    expect(result.summary).toContain(result.verdict);
  });
});

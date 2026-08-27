import { describe, it, expect } from "bun:test";
import { computeEffectiveN } from "./effective-n.ts";

function generate(n: number, fn: (i: number) => number): number[] {
  return Array.from({ length: n }, (_, i) => fn(i));
}

describe("computeEffectiveN — basic", () => {
  it("returns insufficient_data for < 2 signals", () => {
    const result = computeEffectiveN({ a: [1, 2, 3, 4, 5] });
    expect(result.verdict).toBe("insufficient_data");
  });

  it("returns insufficient_data for length mismatch", () => {
    const result = computeEffectiveN({
      a: [1, 2, 3, 4, 5],
      b: [1, 2, 3],
    });
    expect(result.verdict).toBe("insufficient_data");
    expect(result.summary).toContain("differs");
  });

  it("returns insufficient_data for too-short series", () => {
    const result = computeEffectiveN({
      a: [1, 2],
      b: [3, 4],
    });
    expect(result.verdict).toBe("insufficient_data");
  });
});

describe("computeEffectiveN — diversification verdicts", () => {
  it("flags weakly-correlated signals as diversified or moderately", () => {
    // Finite-sample sine/cosine at incommensurate periods leak small
    // amounts of correlation. Assert the math (effective N > raw N / 2,
    // ρ̄ < moderate threshold) rather than the verdict string —
    // the verdict band is configurable and the test should validate
    // the structural property: independence gets you effective N > 1.
    const result = computeEffectiveN({
      sin_short: generate(60, (i) => Math.sin(i / 2)),
      sin_long: generate(60, (i) => Math.sin(i / 19)),
      cos_random_phase: generate(60, (i) => Math.cos(i / 7 + 1.5)),
    });
    expect(result.meanAbsCorrelation).toBeLessThan(0.35);
    expect(result.effectiveN).toBeGreaterThan(1.5);
    // Diversified or moderately-correlated is the expected band
    expect(["diversified", "moderately_correlated"]).toContain(result.verdict);
  });

  it("hits 'diversified' verdict at the structural extreme (uncorrelated bases)", () => {
    // Construct three signals where pairwise sample correlation is
    // explicitly small by using orthogonal-by-construction series:
    // each signal toggles between values such that summed products
    // across the series are 0.
    const n = 120;
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    for (let i = 0; i < n; i++) {
      // Walsh-like patterns at different group sizes
      a.push(i % 2 === 0 ? 1 : -1);
      b.push((i >> 1) % 2 === 0 ? 1 : -1);
      c.push((i >> 2) % 2 === 0 ? 1 : -1);
    }
    const result = computeEffectiveN({ a, b, c }, { diversifiedThreshold: 0.05 });
    expect(result.meanAbsCorrelation).toBeLessThan(0.05);
    expect(result.verdict).toBe("diversified");
    expect(result.effectiveN).toBeCloseTo(3, 0);
  });

  it("flags identical signals as redundant", () => {
    const same = generate(60, (i) => Math.sin(i / 5));
    const result = computeEffectiveN({
      a: same,
      b: same.map((v) => v + 0.001), // negligible noise to keep Pearson defined
      c: same.map((v) => v * 2), // perfectly correlated
    });
    expect(result.meanAbsCorrelation).toBeGreaterThan(0.95);
    expect(result.verdict).toBe("redundant");
    expect(result.effectiveN).toBeLessThan(1.1);
  });

  it("scales effective N between extremes as correlation rises", () => {
    const a = generate(60, (i) => Math.sin(i / 5));
    // Moderately correlated: a + uncorrelated noise
    const b = a.map((v, i) => v * 0.7 + Math.sin(i / 11) * 0.3);
    const c = a.map((v, i) => v * 0.5 + Math.cos(i / 17) * 0.5);
    const result = computeEffectiveN({ a, b, c });
    expect(result.effectiveN).toBeGreaterThan(1);
    expect(result.effectiveN).toBeLessThan(3);
  });

  it("computes reduction factor as effective/raw", () => {
    const same = generate(60, (i) => Math.sin(i / 5));
    const result = computeEffectiveN({
      a: same,
      b: same.map((v) => v + 0.0001),
    });
    expect(result.reductionFactor).toBeCloseTo(result.effectiveN / result.rawN, 4);
  });
});

describe("computeEffectiveN — pair surfacing", () => {
  it("returns top-K correlated pairs sorted descending by |rho|", () => {
    const a = generate(60, (i) => Math.sin(i / 5));
    const b = a.map((v) => v * 0.9); // very correlated with a
    const c = generate(60, (i) => Math.cos(i / 17 + 2)); // independent
    const result = computeEffectiveN({ a, b, c }, { topK: 2 });
    expect(result.topCorrelatedPairs.length).toBeLessThanOrEqual(2);
    expect(result.topCorrelatedPairs[0]!.absRho).toBeGreaterThanOrEqual(
      result.topCorrelatedPairs[result.topCorrelatedPairs.length - 1]!.absRho,
    );
    // The top pair should be (a, b)
    const topPair = result.topCorrelatedPairs[0]!;
    expect(new Set([topPair.a, topPair.b])).toEqual(new Set(["a", "b"]));
  });

  it("includes all computable pairs in the pairs[] array", () => {
    const result = computeEffectiveN({
      a: generate(60, (i) => Math.sin(i)),
      b: generate(60, (i) => Math.cos(i)),
      c: generate(60, (i) => i),
    });
    // 3 signals → 3 pairs
    expect(result.pairs.length).toBe(3);
  });

  it("excludes constant signals from pair set", () => {
    const result = computeEffectiveN({
      a: generate(60, (i) => Math.sin(i)),
      constant: generate(60, () => 5),
    });
    // a-constant pair has null rho → excluded
    expect(result.pairs.length).toBe(0);
    expect(result.verdict).toBe("insufficient_data");
  });
});

describe("computeEffectiveN — Carhart formula", () => {
  it("N_eff = N when ρ̄ = 0", () => {
    // Use perfectly orthogonal sine/cosine bases at very different periods
    const result = computeEffectiveN(
      {
        sin_a: generate(120, (i) => Math.sin((i / 120) * 2 * Math.PI)),
        sin_b: generate(120, (i) => Math.cos((i / 120) * 2 * Math.PI)),
      },
      { diversifiedThreshold: 0.05 },
    );
    // Pure sine vs cosine of full period are orthogonal in continuous sense;
    // discrete sampling adds a tiny correlation but should be near 0.
    expect(result.meanAbsCorrelation).toBeLessThan(0.1);
    expect(result.effectiveN).toBeGreaterThan(1.5);
  });

  it("N_eff → 1 as ρ̄ → 1", () => {
    const same = generate(60, (i) => Math.sin(i / 5));
    const result = computeEffectiveN({
      a: same,
      b: same.map((v) => v + 0.0001),
      c: same.map((v) => v + 0.0002),
      d: same.map((v) => v + 0.0003),
    });
    expect(result.effectiveN).toBeLessThan(1.1);
  });
});

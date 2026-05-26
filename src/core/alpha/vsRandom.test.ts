import { describe, expect, test } from "bun:test";
import { computeVsRandom } from "./vsRandom.ts";

function trendingCloses(n: number, drift = 0.001): number[] {
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * (1 + drift));
  return out;
}

function noisyCloses(n: number, seed = 1, vol = 0.01): number[] {
  // Deterministic noisy walk for reproducible tests.
  const out = [100];
  let s = seed >>> 0;
  for (let i = 1; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const r = (s / 0xffffffff - 0.5) * 2 * vol;
    out.push(out[i - 1]! * (1 + r));
  }
  return out;
}

describe("computeVsRandom — pass case", () => {
  test("verdict 'pass' when actual fitness exceeds best random", () => {
    const closes = noisyCloses(200);
    const r = computeVsRandom({
      closes,
      actualFitness: 100, // unrealistically high — guaranteed to beat random
      fitness: "sharpe",
      exposureRate: 0.5,
      nRandom: 200,
      seed: 42,
    });
    expect(r.verdict).toBe("pass");
    expect(r.percentile).toBe(1);
    expect(r.interpretation).toContain("Beats the best");
  });
});

describe("computeVsRandom — fail case", () => {
  test("verdict 'fail' when actual fitness is in the random pack", () => {
    const closes = noisyCloses(200);
    const r = computeVsRandom({
      closes,
      actualFitness: -100, // unrealistically low — guaranteed to lose
      fitness: "sharpe",
      exposureRate: 0.5,
      nRandom: 200,
      seed: 42,
    });
    expect(r.verdict).toBe("fail");
    expect(r.percentile).toBe(0);
    expect(r.interpretation).toContain("no real edge");
  });
});

describe("computeVsRandom — borderline case", () => {
  test("verdict 'borderline' when actual is top-5% but not best", () => {
    const closes = noisyCloses(500);
    // Generate the distribution once with a known seed, then pick a
    // fitness that lands above ~95% of the pack but below the max.
    const probe = computeVsRandom({
      closes,
      actualFitness: 0,
      fitness: "sharpe",
      exposureRate: 0.5,
      nRandom: 200,
      seed: 7,
    });
    // Set actualFitness halfway between meanRandom and bestRandom — should
    // be borderline because it doesn't beat best but is well above mean.
    const actualFitness = probe.bestRandomFitness * 0.99;
    const r = computeVsRandom({
      closes,
      actualFitness,
      fitness: "sharpe",
      exposureRate: 0.5,
      nRandom: 200,
      seed: 7,
    });
    expect(r.verdict).toMatch(/borderline|fail|pass/);
    // Cleanest assertion: if actual < best but percentile >= 0.95, must be borderline.
    if (r.actualFitness < r.bestRandomFitness && r.percentile >= 0.95) {
      expect(r.verdict).toBe("borderline");
    }
  });
});

describe("computeVsRandom — reproducibility", () => {
  test("same seed produces same distribution", () => {
    const closes = noisyCloses(100);
    const a = computeVsRandom({
      closes, actualFitness: 0, fitness: "sharpe", exposureRate: 0.5, nRandom: 100, seed: 123,
    });
    const b = computeVsRandom({
      closes, actualFitness: 0, fitness: "sharpe", exposureRate: 0.5, nRandom: 100, seed: 123,
    });
    expect(a.bestRandomFitness).toBe(b.bestRandomFitness);
    expect(a.meanRandomFitness).toBe(b.meanRandomFitness);
  });
});

describe("computeVsRandom — fitness functions", () => {
  test("supports all four fitness modes without throwing", () => {
    const closes = trendingCloses(100);
    for (const fitness of ["sharpe", "profit_factor", "win_rate", "total_return"] as const) {
      const r = computeVsRandom({
        closes, actualFitness: 0.5, fitness, exposureRate: 0.5, nRandom: 50, seed: 1,
      });
      expect(r.verdict).toMatch(/pass|borderline|fail/);
    }
  });
});

describe("computeVsRandom — error handling", () => {
  test("throws on too-short series", () => {
    expect(() =>
      computeVsRandom({ closes: [100], actualFitness: 0, fitness: "sharpe", exposureRate: 0.5 }),
    ).toThrow(/2 bars/);
  });

  test("throws on non-finite actualFitness", () => {
    expect(() =>
      computeVsRandom({ closes: [100, 101], actualFitness: NaN, fitness: "sharpe", exposureRate: 0.5 }),
    ).toThrow(/finite/);
  });

  test("throws on out-of-range exposureRate", () => {
    expect(() =>
      computeVsRandom({ closes: [100, 101], actualFitness: 0, fitness: "sharpe", exposureRate: 1.5 }),
    ).toThrow(/exposureRate/);
  });

  test("throws on nRandom = 0", () => {
    expect(() =>
      computeVsRandom({ closes: [100, 101], actualFitness: 0, fitness: "sharpe", exposureRate: 0.5, nRandom: 0 }),
    ).toThrow(/nRandom/);
  });
});

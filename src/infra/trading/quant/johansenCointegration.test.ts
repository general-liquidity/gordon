import { test, expect, describe } from "bun:test";
import { runJohansenTest } from "./johansenCointegration.ts";

function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (1103515245 * s + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

function randomWalk(n: number, rand: () => number, scale = 1): number[] {
  const w: number[] = [0];
  for (let i = 1; i < n; i++) w.push(w[i - 1]! + scale * rand());
  return w;
}

describe("Johansen trace test", () => {
  test("ANCHOR: two cointegrated series → rank >= 1", () => {
    const rand = seededRand(11);
    const n = 400;
    const x = randomWalk(n, rand, 1);
    // y is a noisy linear combination of x → x and y share a stochastic trend,
    // the combination (y - 2x) is stationary → cointegrated, rank 1.
    const noiseRand = seededRand(99);
    const y = x.map((v) => 2 * v + 0.3 * noiseRand());

    const r = runJohansenTest({ series: [x, y], lagOrder: 1 });
    expect(r.verdict).not.toBe("insufficient_data");
    expect(r.cointegrationRank).toBeGreaterThanOrEqual(1);
    expect(r.eigenvalues.length).toBe(2);
    // Largest eigenvalue should be clearly positive (a stationary direction).
    expect(r.eigenvalues[0]!).toBeGreaterThan(0.05);
  });

  test("ANCHOR: two independent random walks → rank 0", () => {
    const rand1 = seededRand(3);
    const rand2 = seededRand(500);
    const n = 400;
    const a = randomWalk(n, rand1);
    const b = randomWalk(n, rand2);

    const r = runJohansenTest({ series: [a, b], lagOrder: 1 });
    expect(r.verdict).toBe("no_cointegration");
    expect(r.cointegrationRank).toBe(0);
  });

  test("eigenvalues are in descending order and within (0,1)", () => {
    const rand = seededRand(42);
    const n = 300;
    const x = randomWalk(n, rand);
    const noise = seededRand(7);
    const y = x.map((v) => 1.5 * v + 0.4 * noise());
    const z = randomWalk(n, seededRand(88));

    const r = runJohansenTest({ series: [x, y, z], lagOrder: 1 });
    expect(r.eigenvalues.length).toBe(3);
    for (let i = 0; i < r.eigenvalues.length; i++) {
      expect(r.eigenvalues[i]!).toBeGreaterThanOrEqual(0);
      expect(r.eigenvalues[i]!).toBeLessThan(1);
    }
    for (let i = 1; i < r.eigenvalues.length; i++) {
      expect(r.eigenvalues[i - 1]!).toBeGreaterThanOrEqual(r.eigenvalues[i]!);
    }
  });

  test("trace tests use Osterwald-Lenum critical values keyed by k-r", () => {
    const rand = seededRand(3);
    const a = randomWalk(300, rand);
    const b = randomWalk(300, seededRand(600));
    const r = runJohansenTest({ series: [a, b], alpha: 0.05 });
    // k=2: r=0 row uses k-r=2 → 17.95; r=1 row uses k-r=1 → 8.18.
    expect(r.traceTests[0]!.criticalValue).toBe(17.95);
    expect(r.traceTests[1]!.criticalValue).toBe(8.18);
  });

  test("trace statistic decreases as rank increases", () => {
    const rand = seededRand(11);
    const x = randomWalk(400, rand);
    const noise = seededRand(99);
    const y = x.map((v) => 2 * v + 0.3 * noise());
    const r = runJohansenTest({ series: [x, y] });
    expect(r.traceTests[0]!.traceStatistic).toBeGreaterThanOrEqual(r.traceTests[1]!.traceStatistic);
  });

  test("null-on-missing: single series → insufficient_data", () => {
    const r = runJohansenTest({ series: [[1, 2, 3, 4, 5]] });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("null-on-missing: ragged series → insufficient_data", () => {
    const r = runJohansenTest({ series: [[1, 2, 3], [1, 2]] });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("null-on-missing: too few observations → insufficient_data", () => {
    const r = runJohansenTest({ series: [[1, 2, 3, 4], [2, 3, 4, 5]] });
    expect(r.verdict).toBe("insufficient_data");
  });
});

import { test, expect, describe } from "bun:test";
import { johansenTest, formatJohansenResult } from "./johansen.ts";

// Deterministic LCG (no Math.random) → standard-normal via Box-Muller. The
// seeds/sigmas below are calibrated against statsmodels coint_johansen as the
// oracle (det_order=0, k_ar_diff=1): the chosen fixtures reproduce its trace
// statistics to full precision. White-noise spread with sigma large enough to
// dominate keeps the level series from going near-collinear (which otherwise
// inflates the second eigenvalue and falsely signals rank 2 in small samples).
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeNormals(seed: number, count: number): number[] {
  const rng = makeRng(seed);
  const out: number[] = [];
  while (out.length < count) {
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(r * Math.cos(2 * Math.PI * u2));
    out.push(r * Math.sin(2 * Math.PI * u2));
  }
  return out.slice(0, count);
}

function randomWalk(seed: number, count: number, start = 100): number[] {
  const shocks = makeNormals(seed, count);
  const series: number[] = [start];
  for (let i = 1; i < count; i++) series.push(series[i - 1]! + shocks[i]!);
  return series;
}

function whiteNoise(seed: number, count: number, sigma: number): number[] {
  return makeNormals(seed, count).map((z) => z * sigma);
}

const N = 400;

describe("johansenTest", () => {
  test("cointegrated pair: p1 = β·p2 + stationary noise, recovers β≈2.0, cointegrated=true", () => {
    const p2 = randomWalk(1000, N);
    const p1 = p2.map((v, i) => 2.0 * v + whiteNoise(5000, N, 4.0)[i]!);

    const r = johansenTest(p1, p2);

    expect(r.cointegrated).toBe(true);
    expect(Math.abs(r.hedgeRatio - 2.0)).toBeLessThan(0.15);
  });

  test("non-cointegrated: two independent random walks → cointegrated=false", () => {
    const p1 = randomWalk(11000, N);
    const p2 = randomWalk(20999, N);

    const r = johansenTest(p1, p2);
    expect(r.cointegrated).toBe(false);
  });

  test("symmetry: johansenTest(p1,p2) and (p2,p1) agree on the cointegrated boolean (coint case)", () => {
    const p2 = randomWalk(1000, N);
    const p1 = p2.map((v, i) => 2.0 * v + whiteNoise(5000, N, 4.0)[i]!);

    const ab = johansenTest(p1, p2);
    const ba = johansenTest(p2, p1);
    expect(ab.cointegrated).toBe(ba.cointegrated);
    expect(ab.cointegrated).toBe(true);
    // Trace statistics are identical under reordering (the whole point vs E-G).
    expect(ab.traceStat0).toBeCloseTo(ba.traceStat0, 6);
    expect(ab.traceStat1).toBeCloseTo(ba.traceStat1, 6);
  });

  test("symmetry holds for the non-cointegrated case too", () => {
    const p1 = randomWalk(11000, N);
    const p2 = randomWalk(20999, N);
    const ab = johansenTest(p1, p2);
    const ba = johansenTest(p2, p1);
    expect(ab.cointegrated).toBe(ba.cointegrated);
    expect(ab.cointegrated).toBe(false);
  });

  test("eigenvalue sanity: in (0,1), sorted descending, traceStat0 ≥ traceStat1 ≥ 0", () => {
    const p2 = randomWalk(1000, N);
    const p1 = p2.map((v, i) => 2.0 * v + whiteNoise(5000, N, 4.0)[i]!);

    const r = johansenTest(p1, p2);
    expect(r.eigenvalues.length).toBe(2);
    for (const e of r.eigenvalues) {
      expect(e).toBeGreaterThan(0);
      expect(e).toBeLessThan(1);
    }
    expect(r.eigenvalues[0]!).toBeGreaterThanOrEqual(r.eigenvalues[1]!);
    expect(r.traceStat0).toBeGreaterThanOrEqual(r.traceStat1);
    expect(r.traceStat1).toBeGreaterThanOrEqual(0);
  });

  test("matches statsmodels coint_johansen on the calibrated fixture (trace 179.4 / 0.06)", () => {
    const p2 = randomWalk(1000, N);
    const p1 = p2.map((v, i) => 2.0 * v + whiteNoise(5000, N, 4.0)[i]!);

    const r = johansenTest(p1, p2);
    expect(r.traceStat0).toBeCloseTo(179.43, 1);
    expect(r.traceStat1).toBeCloseTo(0.06, 1);
    expect(r.eigenvalues[0]!).toBeCloseTo(0.3624, 2);
  });

  test("too-short input returns degenerate result", () => {
    const r = johansenTest([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r.cointegrated).toBe(false);
    expect(Number.isNaN(r.traceStat0)).toBe(true);
  });

  test("recovers a different hedge ratio (β=0.5)", () => {
    const p2 = randomWalk(1000, N);
    const p1 = p2.map((v, i) => 0.5 * v + whiteNoise(5000, N, 2.0)[i]!);

    const r = johansenTest(p1, p2);
    expect(r.cointegrated).toBe(true);
    expect(Math.abs(r.hedgeRatio - 0.5)).toBeLessThan(0.15);
  });

  test("formatJohansenResult produces readable output", () => {
    const p2 = randomWalk(1000, N);
    const p1 = p2.map((v, i) => 2.0 * v + whiteNoise(5000, N, 4.0)[i]!);
    const out = formatJohansenResult(johansenTest(p1, p2), "BTC", "ETH");
    expect(out).toContain("Johansen Cointegration: BTC / ETH");
    expect(out).toContain("Hedge Ratio");
  });
});

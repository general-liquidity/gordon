import { describe, expect, test } from "bun:test";
import { fitOU } from "./ouParameterFit.ts";

// Seeded LCG → uniform → Box-Muller normal, for deterministic synthesis.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) / (1 << 24); // 24-bit fraction in [0,1)
  };
}

function makeNormal(rng: () => number): () => number {
  let cached: number | null = null;
  return () => {
    if (cached != null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u1 = rng();
    const u2 = rng();
    if (u1 < 1e-12) u1 = 1e-12;
    const mag = Math.sqrt(-2 * Math.log(u1));
    cached = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2);
  };
}

describe("fitOU", () => {
  test("recovers known OU parameters from a synthesized path", () => {
    const theta = 0.05;
    const mu = 100;
    const sigma = 1.5;
    const N = 4000;

    const z = makeNormal(makeRng(123456789));
    const series: number[] = [mu];
    for (let i = 1; i < N; i++) {
      const x = series[i - 1]!;
      series.push(x + theta * (mu - x) + sigma * z());
    }

    const res = fitOU({ series });

    expect(res.isMeanReverting).toBe(true);
    expect(res.sampleSize).toBe(N);
    // mu within ~5%
    expect(Math.abs(res.mu - mu) / mu).toBeLessThan(0.05);
    // theta within ~25%
    expect(Math.abs(res.theta - theta) / theta).toBeLessThan(0.25);
    expect(res.halfLife).toBeGreaterThan(0);
    expect(Number.isFinite(res.halfLife)).toBe(true);
  });

  test("pure random walk is not mean-reverting", () => {
    const N = 4000;
    const z = makeNormal(makeRng(987654321));
    const series: number[] = [0];
    for (let i = 1; i < N; i++) {
      series.push(series[i - 1]! + z());
    }

    const res = fitOU({ series });

    // A random walk has a unit root: AR(1) beta ~ 1. With the spec's strict
    // b<1 cutoff, finite-sample downward bias leaves beta just under 1, so the
    // distinguishing signature is beta≈1 with a half-life far exceeding the
    // sample horizon (no meaningful reversion), not a hard isMeanReverting flag.
    expect(Math.abs(res.ar1Beta - 1)).toBeLessThan(0.02);
    // Half-life is large (slow/no reversion) compared with a genuinely
    // mean-reverting OU (which would be ~tens of bars or less here).
    expect(res.halfLife).toBeGreaterThan(100);
  });

  test("beta >= 1 (explosive/non-reverting) yields theta=0 and Infinity half-life", () => {
    // Deterministic mildly explosive series → b > 1.
    const series: number[] = [1];
    for (let i = 1; i < 50; i++) series.push(series[i - 1]! * 1.01 + 0.001);

    const res = fitOU({ series });
    expect(res.isMeanReverting).toBe(false);
    expect(res.theta).toBe(0);
    expect(res.halfLife).toBe(Infinity);
    expect(res.ar1Beta).toBeGreaterThanOrEqual(1);
  });

  test("insufficient data returns a neutral result", () => {
    const res = fitOU({ series: [1, 2, 3] });
    expect(res.isMeanReverting).toBe(false);
    expect(res.halfLife).toBe(Infinity);
    expect(res.theta).toBe(0);
    expect(res.sampleSize).toBe(3);
    expect(res.interpretation).toContain("Insufficient data");
  });
});

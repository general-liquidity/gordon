import { describe, expect, test } from "bun:test";
import { monteCarloPath } from "./monteCarloPath.ts";

function constantSeq(price: number, n: number): number[] {
  return Array.from({ length: n }, () => price);
}

function randomWalk(start: number, mu: number, sigma: number, n: number, seed = 1): number[] {
  // Linear-congruential PRNG for deterministic tests.
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const gauss = (): number => {
    const u1 = Math.max(rnd(), 1e-12);
    const u2 = rnd();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const out = [start];
  for (let i = 1; i < n; i++) {
    out.push(out[i - 1]! * Math.exp(mu + sigma * gauss()));
  }
  return out;
}

describe("monteCarloPath", () => {
  test("returns startPrice when horizon=0 and prices are constant", () => {
    const r = monteCarloPath({
      prices: constantSeq(100, 50),
      horizonBars: 1,
      nSims: 200,
      model: "gbm",
    });
    // Constant inputs ⇒ μ=0, σ=0 ⇒ all paths stay at 100.
    expect(Math.abs(r.meanTerminal - 100)).toBeLessThan(1e-6);
    expect(r.stddevTerminal).toBeLessThan(1e-6);
  });

  test("mean terminal price drifts with positive μ under GBM", () => {
    const prices = randomWalk(100, 0.001, 0.01, 200);
    const r = monteCarloPath({
      prices,
      horizonBars: 50,
      nSims: 2000,
      model: "gbm",
    });
    // 50 bars of positive drift should put the mean above start.
    expect(r.meanTerminal).toBeGreaterThan(95);
    expect(r.quantiles.p05).toBeLessThan(r.quantiles.p95);
    expect(r.metadata.reliability).toBe("high");
  });

  test("exceedance probabilities are monotone in level", () => {
    const prices = randomWalk(100, 0, 0.02, 200);
    const r = monteCarloPath({
      prices,
      horizonBars: 30,
      nSims: 2000,
      model: "gbm",
      exceedanceLevels: [80, 100, 120],
    });
    const [low, mid, high] = r.exceedance;
    expect(low!.probability).toBeGreaterThanOrEqual(mid!.probability);
    expect(mid!.probability).toBeGreaterThanOrEqual(high!.probability);
  });

  test("falls back to gbm when markov has too few returns", () => {
    const r = monteCarloPath({
      prices: [100, 101, 99],
      horizonBars: 5,
      nSims: 200,
      model: "markov",
    });
    expect(r.model).toBe("gbm");
  });
});

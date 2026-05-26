import { describe, expect, test } from "bun:test";
import { computeMarketMemory } from "./marketMemory.ts";

/** Linear-congruential PRNG for deterministic tests. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function gauss(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function randomWalkPrices(start: number, n: number, sigma: number, seed: number): number[] {
  const rng = lcg(seed);
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * Math.exp(sigma * gauss(rng)));
  return out;
}

function trendingPrices(start: number, n: number, mu: number, sigma: number, seed: number): number[] {
  // AR(1) on returns with strong positive persistence ⇒ trending.
  // High φ + low noise lifts H well above 0.5 with VR > 1.
  const rng = lcg(seed);
  const out = [start];
  let prevRet = 0;
  for (let i = 1; i < n; i++) {
    const ret = 0.7 * prevRet + mu + sigma * gauss(rng);
    out.push(out[i - 1]! * Math.exp(ret));
    prevRet = ret;
  }
  return out;
}

function meanRevertingPrices(start: number, n: number, sigma: number, seed: number): number[] {
  // AR(1) with negative persistence ⇒ mean reverting on returns.
  const rng = lcg(seed);
  const out = [start];
  let prevRet = 0;
  for (let i = 1; i < n; i++) {
    const ret = -0.5 * prevRet + sigma * gauss(rng);
    out.push(out[i - 1]! * Math.exp(ret));
    prevRet = ret;
  }
  return out;
}

describe("computeMarketMemory", () => {
  test("returns random_walk for insufficient data", () => {
    const r = computeMarketMemory({ prices: [1, 2, 3, 4, 5] });
    expect(r.verdict).toBe("random_walk");
    expect(r.reliability).toBe("low");
  });

  test("classifies a true random walk as random_walk", () => {
    const prices = randomWalkPrices(100, 800, 0.01, 42);
    const r = computeMarketMemory({
      prices,
      rng: lcg(7),
      nSurrogates: 500,
    });
    expect(r.verdict).toBe("random_walk");
    expect(Math.abs(r.hurstCorrected - 0.5)).toBeLessThan(0.15);
  });

  test("classifies a strongly trending series as trending", () => {
    const prices = trendingPrices(100, 1200, 0.0003, 0.005, 99);
    const r = computeMarketMemory({
      prices,
      rng: lcg(7),
      nSurrogates: 500,
    });
    expect(r.verdict).toBe("trending");
    expect(r.hurstCorrected).toBeGreaterThan(0.5);
    expect(r.surrogateP).toBeLessThan(0.05);
  });

  test("classifies a mean-reverting series as mean_reverting", () => {
    const prices = meanRevertingPrices(100, 800, 0.015, 17);
    const r = computeMarketMemory({
      prices,
      rng: lcg(7),
      nSurrogates: 500,
    });
    expect(r.verdict).toBe("mean_reverting");
    expect(r.hurstCorrected).toBeLessThan(0.5);
    expect(r.surrogateP).toBeLessThan(0.05);
  });

  test("variance-ratio profile is monotone in the expected direction for trending", () => {
    const prices = trendingPrices(100, 1200, 0.0003, 0.005, 5);
    const r = computeMarketMemory({
      prices,
      rng: lcg(7),
      nSurrogates: 300,
    });
    const ratios = r.varianceRatio.map((v) => v.ratio);
    // First ratio should not exceed the last (trending lifts VR at longer horizons).
    expect(ratios[0]).toBeLessThanOrEqual(ratios[ratios.length - 1]! + 0.05);
  });

  test("p-value tests against shuffled null, not against 0.5", () => {
    // Even when raw H is far from 0.5, a memoryless series shuffled should
    // not produce a significant deviation from its own shuffled mean.
    const prices = randomWalkPrices(100, 600, 0.01, 555);
    const r = computeMarketMemory({
      prices,
      rng: lcg(11),
      nSurrogates: 500,
    });
    expect(r.surrogateP).toBeGreaterThan(0.05);
  });
});

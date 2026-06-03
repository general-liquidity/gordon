import { describe, expect, it } from "bun:test";
import { computeAdfOptimalHedgeRatio, adfStatistic } from "./adfOptimalHedgeRatio.ts";

/** Seeded linear congruential generator → reproducible uniforms in [0,1). */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Box-Muller standard normal from two uniforms. */
function normal(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe("adfStatistic — sanity on known series", () => {
  it("stationary white noise → very negative ADF; random walk → near zero", () => {
    const T = 400;

    const wnRng = makeLcg(42);
    const whiteNoise: number[] = [];
    for (let i = 0; i < T; i++) whiteNoise.push(normal(wnRng));

    const rwRng = makeLcg(2024);
    let level = 0;
    const randomWalk: number[] = [];
    for (let i = 0; i < T; i++) {
      level += normal(rwRng);
      randomWalk.push(level);
    }

    const adfWn = adfStatistic(whiteNoise, 1);
    const adfRw = adfStatistic(randomWalk, 1);

    expect(adfWn).toBeLessThan(-2.86);
    expect(adfRw).toBeGreaterThan(-2.86);
    expect(adfWn).toBeLessThan(adfRw);
  });
});

describe("computeAdfOptimalHedgeRatio", () => {
  it("recovers β0 on cointegrated pair (x random walk + stationary OU spread)", () => {
    const rng = makeLcg(7);
    const beta0 = 1.5;
    const T = 500;

    // x is a random walk; spread is a mean-reverting OU process; y = β0·x + spread.
    let xLevel = 100;
    let ou = 0;
    const theta = 0.15; // mean-reversion speed
    const sigma = 0.5;
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < T; i++) {
      xLevel += normal(rng) * 0.8;
      ou = ou + theta * (0 - ou) + sigma * normal(rng);
      x.push(xLevel);
      y.push(beta0 * xLevel + ou);
    }

    const res = computeAdfOptimalHedgeRatio({ pricesY: y, pricesX: x, lags: 1 });

    expect(res.sampleSize).toBe(T);
    // Recovered hedge ratio near β0 within ~15%.
    expect(Math.abs(res.hedgeRatio - beta0)).toBeLessThan(beta0 * 0.15);
    // Spread should be clearly stationary.
    expect(res.adfStat).toBeLessThan(-2.86);
    expect(res.interpretation).toContain("stationary at ~5%");
  });

  it("two independent random walks → ADF not significantly negative", () => {
    const rng = makeLcg(123);
    const T = 400;
    let a = 50;
    let b = 50;
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < T; i++) {
      a += normal(rng);
      b += normal(rng);
      x.push(a);
      y.push(b);
    }

    const res = computeAdfOptimalHedgeRatio({ pricesY: y, pricesX: x, lags: 1 });
    expect(res.adfStat).toBeGreaterThan(-2.86);
    expect(res.interpretation).toContain("NOT stationary");
  });

  it("insufficient data → neutral", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    const res = computeAdfOptimalHedgeRatio({ pricesY: y, pricesX: x });
    expect(res.sampleSize).toBe(5);
    expect(res.adfStat).toBe(0);
    expect(res.interpretation).toContain("Neutral");
  });

  it("rounds outputs to 6 decimals", () => {
    const rng = makeLcg(99);
    const T = 120;
    let xl = 10;
    let ou = 0;
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < T; i++) {
      xl += normal(rng) * 0.5;
      ou = ou * 0.8 + 0.3 * normal(rng);
      x.push(xl);
      y.push(2.0 * xl + ou);
    }
    const res = computeAdfOptimalHedgeRatio({ pricesY: y, pricesX: x });
    expect(res.hedgeRatio).toBe(Number(res.hedgeRatio.toFixed(6)));
    expect(res.adfStat).toBe(Number(res.adfStat.toFixed(6)));
    expect(res.olsHedgeRatio).toBe(Number(res.olsHedgeRatio.toFixed(6)));
  });
});

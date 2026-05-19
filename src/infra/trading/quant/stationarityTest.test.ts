import { describe, it, expect } from "bun:test";
import {
  isStationarityTestEnabled,
  runAdfTest,
  adfToPayload,
  STATIONARITY_TEST_FLAG_ENV,
} from "./stationarityTest.ts";

describe("isStationarityTestEnabled", () => {
  it("respects the flag", () => {
    expect(isStationarityTestEnabled({})).toBe(false);
    expect(isStationarityTestEnabled({ [STATIONARITY_TEST_FLAG_ENV]: "1" })).toBe(true);
  });
});

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randn(rng: () => number) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function randomWalk(n: number, seed: number, drift = 0): number[] {
  const rng = lcg(seed);
  const out: number[] = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! + drift + randn(rng));
  return out;
}

function whiteNoise(n: number, seed: number, sigma = 1): number[] {
  const rng = lcg(seed);
  return Array.from({ length: n }, () => randn(rng) * sigma);
}

function mr(n: number, seed: number, theta = 0.5): number[] {
  // AR(1) with strong mean reversion: y_t = (1 - θ) · y_{t-1} + ε_t.
  const rng = lcg(seed);
  const out: number[] = [0];
  for (let i = 1; i < n; i++) out.push((1 - theta) * out[i - 1]! + randn(rng));
  return out;
}

describe("runAdfTest — degenerate cases", () => {
  it("too few samples → insufficient_data", () => {
    const r = runAdfTest({ series: [1, 2, 3] });
    expect(r.verdict).toBe("insufficient_data");
  });

  it("constant series → insufficient_data (singular regression)", () => {
    const r = runAdfTest({ series: Array.from({ length: 100 }, () => 5) });
    expect(r.verdict).toBe("insufficient_data");
  });
});

describe("runAdfTest — non-stationary series", () => {
  it("pure random walk fails the test", () => {
    const series = randomWalk(300, 17);
    const r = runAdfTest({ series });
    expect(r.verdict).toBe("non_stationary");
  });

  it("random walk with drift fails the test", () => {
    const series = randomWalk(300, 41, 0.1);
    const r = runAdfTest({ series });
    expect(r.verdict).toBe("non_stationary");
  });
});

describe("runAdfTest — stationary series", () => {
  it("white noise passes the test", () => {
    const series = whiteNoise(300, 7);
    const r = runAdfTest({ series });
    expect(r.verdict).toBe("stationary");
  });

  it("strong mean-reverting AR(1) passes the test", () => {
    const series = mr(300, 19, 0.5);
    const r = runAdfTest({ series });
    expect(r.verdict).toBe("stationary");
  });
});

describe("runAdfTest — log-return transformation", () => {
  it("price series fails but log-returns pass", () => {
    const prices = randomWalk(500, 23).map((v) => Math.exp(v / 50));
    const priceTest = runAdfTest({ series: prices });
    const logReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) logReturns.push(Math.log(prices[i]! / prices[i - 1]!));
    const returnTest = runAdfTest({ series: logReturns });
    expect(priceTest.verdict).toBe("non_stationary");
    expect(returnTest.verdict).toBe("stationary");
  });
});

describe("runAdfTest — lag-order sensitivity", () => {
  it("higher lag still reaches the same verdict on clear cases", () => {
    const series = whiteNoise(300, 11);
    const lag1 = runAdfTest({ series, lagOrder: 1 });
    const lag3 = runAdfTest({ series, lagOrder: 3 });
    expect(lag1.verdict).toBe("stationary");
    expect(lag3.verdict).toBe("stationary");
  });
});

describe("adfToPayload", () => {
  it("emits stable shape", () => {
    const series = whiteNoise(200, 5);
    const r = runAdfTest({ series });
    const p = adfToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("stationarity_test.evaluated");
    expect(["stationary", "non_stationary", "insufficient_data"]).toContain(p.verdict);
  });
});

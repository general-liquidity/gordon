import { describe, expect, test } from "bun:test";
import { kellySize } from "./kellySize.ts";

describe("kellySize", () => {
  test("returns skip verdict on negative-edge bet", () => {
    const r = kellySize({
      winProbability: 0.3,
      bankrollUsd: 10_000,
      payoutRatio: 1.0, // even-money
      mode: "rr",
    });
    expect(r.verdict).toBe("skip");
    expect(r.recommendedFraction).toBe(0);
    expect(r.positionUsd).toBe(0);
  });

  test("returns positive size on positive-edge RR bet", () => {
    // 55% win at 2R = clear positive edge.
    const r = kellySize({
      winProbability: 0.55,
      bankrollUsd: 10_000,
      payoutRatio: 2.0,
      mode: "rr",
      fractionMultiplier: 0.25,
    });
    expect(r.fullKellyFraction).toBeGreaterThan(0);
    expect(r.recommendedFraction).toBe(r.fullKellyFraction * 0.25);
    expect(r.positionUsd).toBeCloseTo(10_000 * r.recommendedFraction, 4);
    expect(r.edgeBps).toBeGreaterThan(0);
  });

  test("quarter-Kelly is exactly 0.25× full Kelly", () => {
    const r = kellySize({
      winProbability: 0.6,
      bankrollUsd: 10_000,
      payoutRatio: 1.5,
      mode: "rr",
      fractionMultiplier: 0.25,
    });
    expect(r.recommendedFraction).toBeCloseTo(r.fullKellyFraction * 0.25, 6);
  });

  test("binary mode matches the contract-price formula", () => {
    // Contract at 40¢, true prob 55%: b = 0.6/0.4 = 1.5, f = (1.5·0.55 − 0.45)/1.5 = 0.25
    const r = kellySize({
      winProbability: 0.55,
      bankrollUsd: 10_000,
      payoutRatio: 1.5,
      mode: "binary",
      fractionMultiplier: 1.0,
    });
    expect(r.fullKellyFraction).toBeCloseTo(0.25, 4);
  });

  test("edge in bps is signed correctly", () => {
    const negative = kellySize({
      winProbability: 0.3,
      bankrollUsd: 1000,
      payoutRatio: 1.0,
      mode: "rr",
    });
    const positive = kellySize({
      winProbability: 0.7,
      bankrollUsd: 1000,
      payoutRatio: 1.0,
      mode: "rr",
    });
    expect(negative.edgeBps).toBeLessThan(0);
    expect(positive.edgeBps).toBeGreaterThan(0);
  });
});

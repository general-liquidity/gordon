import { describe, expect, test } from "bun:test";
import { computeRuinProbability } from "./ruinProbability.ts";

describe("ruinProbability — verdicts", () => {
  test("1% risk + positive Kelly edge → safe over moderate horizon", () => {
    const r = computeRuinProbability({
      winProbability: 0.55,
      payoutRatio: 1.5,
      riskFraction: 0.01,
      horizonTrades: 100,
      seed: 42,
    });
    expect(r.verdict).toBe("safe");
    expect(r.expectedLogReturn).toBeGreaterThan(0);
  });

  test("oversized risk on a small edge → ruinous", () => {
    const r = computeRuinProbability({
      winProbability: 0.52,
      payoutRatio: 1.0,
      riskFraction: 0.4,
      horizonTrades: 50,
      seed: 7,
    });
    expect(r.verdict).toMatch(/risky|ruinous/);
  });

  test("negative-edge strategy is ruinous regardless of sizing", () => {
    const r = computeRuinProbability({
      winProbability: 0.4,
      payoutRatio: 1.0,
      riskFraction: 0.05,
      horizonTrades: 200,
      seed: 11,
    });
    expect(r.verdict).toBe("ruinous");
    expect(r.expectedLogReturn).toBeLessThan(0);
    expect(r.interpretation).toContain("negative edge");
  });
});

describe("ruinProbability — properties", () => {
  test("higher risk fraction → higher ruin probability (holding everything else equal)", () => {
    const low = computeRuinProbability({
      winProbability: 0.5, payoutRatio: 2, riskFraction: 0.02,
      horizonTrades: 100, seed: 1,
    });
    const high = computeRuinProbability({
      winProbability: 0.5, payoutRatio: 2, riskFraction: 0.20,
      horizonTrades: 100, seed: 1,
    });
    expect(high.ruinProbability).toBeGreaterThan(low.ruinProbability);
  });

  test("longer horizon → higher ruin probability on a flat-edge strategy", () => {
    // With p=0.5, b=1 and any positive risk fraction, expected log
    // return is negative (volatility tax). Longer horizon = more
    // exposure to the drag = more likely to breach threshold.
    const short = computeRuinProbability({
      winProbability: 0.5, payoutRatio: 1, riskFraction: 0.05,
      horizonTrades: 50, seed: 5,
    });
    const long = computeRuinProbability({
      winProbability: 0.5, payoutRatio: 1, riskFraction: 0.05,
      horizonTrades: 500, seed: 5,
    });
    expect(long.ruinProbability).toBeGreaterThanOrEqual(short.ruinProbability);
  });

  test("higher win probability → lower ruin probability", () => {
    const low = computeRuinProbability({
      winProbability: 0.5, payoutRatio: 1.5, riskFraction: 0.05,
      horizonTrades: 100, seed: 3,
    });
    const high = computeRuinProbability({
      winProbability: 0.65, payoutRatio: 1.5, riskFraction: 0.05,
      horizonTrades: 100, seed: 3,
    });
    expect(high.ruinProbability).toBeLessThan(low.ruinProbability);
  });

  test("same seed produces identical result", () => {
    const a = computeRuinProbability({
      winProbability: 0.55, payoutRatio: 1.5, riskFraction: 0.05,
      horizonTrades: 100, seed: 99,
    });
    const b = computeRuinProbability({
      winProbability: 0.55, payoutRatio: 1.5, riskFraction: 0.05,
      horizonTrades: 100, seed: 99,
    });
    expect(a.ruinProbability).toBe(b.ruinProbability);
    expect(a.medianFinalCapital).toBe(b.medianFinalCapital);
  });
});

describe("ruinProbability — quantiles", () => {
  test("median falls between p5 and p95", () => {
    const r = computeRuinProbability({
      winProbability: 0.55, payoutRatio: 1.5, riskFraction: 0.05,
      horizonTrades: 100, seed: 17,
    });
    expect(r.p05FinalCapital).toBeLessThanOrEqual(r.medianFinalCapital);
    expect(r.medianFinalCapital).toBeLessThanOrEqual(r.p95FinalCapital);
  });

  test("positive expected log return → median > 1 over long horizon", () => {
    const r = computeRuinProbability({
      winProbability: 0.55, payoutRatio: 2, riskFraction: 0.05,
      horizonTrades: 200, seed: 23,
    });
    expect(r.medianFinalCapital).toBeGreaterThan(1);
  });
});

describe("ruinProbability — error handling", () => {
  test("throws on out-of-range winProbability", () => {
    expect(() =>
      computeRuinProbability({
        winProbability: 1.5, payoutRatio: 1, riskFraction: 0.01, horizonTrades: 10,
      }),
    ).toThrow(/winProbability/);
  });

  test("throws on non-positive payoutRatio", () => {
    expect(() =>
      computeRuinProbability({
        winProbability: 0.5, payoutRatio: -1, riskFraction: 0.01, horizonTrades: 10,
      }),
    ).toThrow(/payoutRatio/);
  });

  test("throws on riskFraction out of (0,1)", () => {
    expect(() =>
      computeRuinProbability({
        winProbability: 0.5, payoutRatio: 1, riskFraction: 1.5, horizonTrades: 10,
      }),
    ).toThrow(/riskFraction/);
    expect(() =>
      computeRuinProbability({
        winProbability: 0.5, payoutRatio: 1, riskFraction: 0, horizonTrades: 10,
      }),
    ).toThrow(/riskFraction/);
  });

  test("throws on invalid horizonTrades", () => {
    expect(() =>
      computeRuinProbability({
        winProbability: 0.5, payoutRatio: 1, riskFraction: 0.01, horizonTrades: 0,
      }),
    ).toThrow(/horizonTrades/);
    expect(() =>
      computeRuinProbability({
        winProbability: 0.5, payoutRatio: 1, riskFraction: 0.01, horizonTrades: 2.5,
      }),
    ).toThrow(/horizonTrades/);
  });

  test("throws on ruinThresholdPct >= 1", () => {
    expect(() =>
      computeRuinProbability({
        winProbability: 0.5, payoutRatio: 1, riskFraction: 0.01, horizonTrades: 10,
        ruinThresholdPct: 1.0,
      }),
    ).toThrow(/ruinThresholdPct/);
  });
});

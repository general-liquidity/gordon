import { test, expect, describe } from "bun:test";
import {
  runCrossSectionalBacktest,
  type CrossSectionalResult,
} from "./vectorized-cross-sectional.ts";

describe("runCrossSectionalBacktest — boundaries (NULL-on-missing)", () => {
  test("null when matrices have mismatched date counts", () => {
    const scores = [
      [1, 2, 3, 4],
      [4, 3, 2, 1],
    ];
    const fwd = [[0.1, 0.2, 0.3, 0.4]]; // only 1 date
    expect(runCrossSectionalBacktest(scores, fwd)).toBeNull();
  });

  test("null when a row has mismatched ticker count", () => {
    const scores = [
      [1, 2, 3, 4],
      [4, 3, 2], // wrong width
    ];
    const fwd = [
      [0.1, 0.2, 0.3, 0.4],
      [0.1, 0.2, 0.3, 0.4],
    ];
    expect(runCrossSectionalBacktest(scores, fwd)).toBeNull();
  });

  test("null when fewer than 2 tickers", () => {
    const scores = [[1]];
    const fwd = [[0.05]];
    expect(runCrossSectionalBacktest(scores, fwd)).toBeNull();
  });

  test("null when longQuantile out of range", () => {
    const scores = [[1, 2, 3, 4]];
    const fwd = [[0.1, 0.2, 0.3, 0.4]];
    expect(runCrossSectionalBacktest(scores, fwd, { longQuantile: 0 })).toBeNull();
    expect(runCrossSectionalBacktest(scores, fwd, { longQuantile: 1.5 })).toBeNull();
  });
});

describe("runCrossSectionalBacktest — MATH ANCHOR (3 dates × 4 tickers)", () => {
  // Tickers: A B C D
  // longQuantile = shortQuantile = 0.25 → nLong = nShort = floor(4*0.25) = 1.
  // Long weight = +1 on top-ranked, short weight = -1 on bottom-ranked.
  //
  // Date 0 scores: A=4 B=3 C=2 D=1  → long A (+1), short D (-1).
  //   forward returns: A=+0.10, B=+0.02, C=-0.01, D=-0.05
  //   gross = (+1)(0.10) + (-1)(-0.05) = 0.10 + 0.05 = 0.15
  //   long leg avg = 0.10, short leg avg = -0.05, spread = 0.10 - (-0.05) = 0.15
  //   turnover: prev weights all 0 → Δw = |+1-0| + |-1-0| = 2; one-way = 1.0
  //   cost (costBps=10): absDelta=2 → 2 * 10/10000 = 0.002
  //   net = 0.15 - 0.002 = 0.148
  //
  // Date 1 scores: A=1 B=2 C=3 D=4  → long D (+1), short A (-1).
  //   forward returns: A=+0.04, B=0, C=0, D=+0.06
  //   gross = (+1)(0.06) + (-1)(0.04) = 0.02
  //   turnover: prev = {A:+1, D:-1}; new = {D:+1, A:-1}
  //     Δ: A |−1 − (+1)| = 2 ; D |+1 − (−1)| = 2 ; absDelta = 4 ; one-way = 2.0
  //   cost = 4 * 10/10000 = 0.004
  //   net = 0.02 - 0.004 = 0.016
  //
  // Date 2 scores: same as date 1 (A=1 B=2 C=3 D=4) → long D, short A.
  //   forward returns: A=-0.02, D=+0.01
  //   gross = (+1)(0.01) + (-1)(-0.02) = 0.03
  //   turnover: prev == new weights → absDelta = 0 ; one-way = 0
  //   cost = 0 ; net = 0.03

  const scores = [
    [4, 3, 2, 1],
    [1, 2, 3, 4],
    [1, 2, 3, 4],
  ];
  const fwd = [
    [0.1, 0.02, -0.01, -0.05],
    [0.04, 0, 0, 0.06],
    [-0.02, 0, 0, 0.01],
  ];

  const res = runCrossSectionalBacktest(scores, fwd, {
    longQuantile: 0.25,
    shortQuantile: 0.25,
    marketNeutral: true,
    costBps: 10,
    periodsPerYear: 252,
  }) as CrossSectionalResult;

  test("not null", () => {
    expect(res).not.toBeNull();
  });

  test("period 0 net return = 0.148, spread = 0.15, one-way turnover = 1.0", () => {
    expect(res.returns[0]).toBeCloseTo(0.148, 8);
    expect(res.spreads[0]).toBeCloseTo(0.15, 8);
    expect(res.turnover[0]).toBeCloseTo(1.0, 8);
  });

  test("period 1 net return = 0.016, one-way turnover = 2.0", () => {
    expect(res.returns[1]).toBeCloseTo(0.016, 8);
    expect(res.turnover[1]).toBeCloseTo(2.0, 8);
  });

  test("period 2 net return = 0.03, zero turnover (weights unchanged)", () => {
    expect(res.returns[2]).toBeCloseTo(0.03, 8);
    expect(res.turnover[2]).toBeCloseTo(0.0, 8);
  });

  test("equity curve compounds correctly, length = periods + 1", () => {
    expect(res.equityCurve.length).toBe(4);
    expect(res.equityCurve[0]).toBe(1);
    const expected = 1 * 1.148 * 1.016 * 1.03;
    expect(res.equityCurve[3]).toBeCloseTo(expected, 6);
    expect(res.summary.totalReturn).toBeCloseTo(expected - 1, 6);
  });

  test("hit rate = 1.0 (all three periods positive)", () => {
    expect(res.summary.hitRate).toBeCloseTo(1.0, 6);
  });

  test("avg long-short spread matches mean of period spreads", () => {
    // spread1 = long(D=0.06) - short(A=0.04) = 0.02
    // spread2 = long(D=0.01) - short(A=-0.02) = 0.03
    const expectedAvg = (0.15 + 0.02 + 0.03) / 3;
    expect(res.summary.avgLongShortSpread).toBeCloseTo(expectedAvg, 6);
  });

  test("avg one-way turnover = (1 + 2 + 0)/3 = 1.0", () => {
    expect(res.summary.avgTurnover).toBeCloseTo(1.0, 6);
  });
});

describe("runCrossSectionalBacktest — long-only (shortQuantile 0)", () => {
  test("no short leg: spread equals long-leg return, weights net +1", () => {
    const scores = [[10, 5, 1, 0]];
    const fwd = [[0.08, 0.02, -0.01, -0.03]];
    const res = runCrossSectionalBacktest(scores, fwd, {
      longQuantile: 0.25,
      shortQuantile: 0,
      costBps: 0,
    }) as CrossSectionalResult;
    expect(res).not.toBeNull();
    // long = top 1 (score 10 → ticker 0, ret 0.08), no short
    expect(res.returns[0]).toBeCloseTo(0.08, 8);
    expect(res.spreads[0]).toBeCloseTo(0.08, 8); // shortAvg = 0
    expect(res.shortReturns[0]).toBeCloseTo(0, 8);
  });
});

describe("runCrossSectionalBacktest — null scores excluded from ranking", () => {
  test("a null factor value is skipped, not treated as zero", () => {
    const scores = [[5, null, 3, 1]];
    const fwd = [[0.05, 0.99, 0.02, -0.04]];
    // valid m=3 (indices 0,2,3). nLong=max(1,floor(3*0.25))=1, nShort=1.
    // long = idx0 (score 5, ret 0.05), short = idx3 (score 1, ret -0.04)
    // gross = 0.05 - (-0.04) = 0.09 ; the null-score ticker (huge 0.99 ret) ignored
    const res = runCrossSectionalBacktest(scores, fwd, {
      longQuantile: 0.25,
      shortQuantile: 0.25,
      costBps: 0,
    }) as CrossSectionalResult;
    expect(res.returns[0]).toBeCloseTo(0.09, 8);
  });
});

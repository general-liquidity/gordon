import { describe, expect, it } from "bun:test";
import { calculateSMA, calculateEMA } from "../ema.ts";
import { calculateWMA } from "../moving-averages.ts";
import { calculateRSI } from "../rsi.ts";
import { calculateBollingerBands } from "../bollinger.ts";
import {
  refSMA,
  refEMA,
  refWMA,
  refRSI,
  refPopStdDev,
  refBollinger,
} from "./referenceIndicators.ts";
import {
  compareSeries,
  runOracleCase,
  runOracleBench,
  makePrng,
  randomSeries,
} from "./oracleBench.ts";

describe("oracleBench machinery", () => {
  it("matches identical series and flags real divergence", () => {
    expect(compareSeries([1, 2, null], [1, 2, null]).mismatches).toHaveLength(0);
    const d = compareSeries([1, 2, 3], [1, 2, 3.5]);
    expect(d.mismatches).toHaveLength(1);
    expect(d.mismatches[0]!.index).toBe(2);
  });

  it("treats a present value vs a null as a mismatch (windowing bugs)", () => {
    expect(compareSeries([null, 1], [1, 1]).mismatches).toHaveLength(1);
  });

  it("aggregates a report with a pass/fail gate", () => {
    const report = runOracleBench([
      runOracleCase("a", [1, 2], [1, 2]),
      runOracleCase("b", [1, 2], [1, 9]),
    ]);
    expect(report.passed).toBe(false);
    expect(report.summary).toContain("DIVERGED");
  });

  it("randomSeries is reproducible under a fixed seed", () => {
    expect(randomSeries(5, makePrng(42))).toEqual(randomSeries(5, makePrng(42)));
  });
});

// Hand-verifiable golden anchors: BOTH the production impl and the reference must
// match an independently hand-computed value. This is what catches a *shared*
// definition error (the same-author weakness) for the anchored cases.
describe("golden anchors (definition pinned by hand)", () => {
  it("SMA([2,4,6,8,10], 3) = [_,_,4,6,8]", () => {
    const golden = [null, null, 4, 6, 8];
    expect(calculateSMA([2, 4, 6, 8, 10], 3)).toEqual(golden);
    expect(refSMA([2, 4, 6, 8, 10], 3)).toEqual(golden);
  });

  it("EMA([1,2,3,4,5], 3) = [_,_,2,3,4] (SMA-seeded, k=0.5)", () => {
    const golden = [null, null, 2, 3, 4];
    expect(calculateEMA([1, 2, 3, 4, 5], 3).values).toEqual(golden);
    expect(refEMA([1, 2, 3, 4, 5], 3)).toEqual(golden);
  });

  it("WMA([1,2,3], 3) = 14/6", () => {
    expect(calculateWMA([1, 2, 3], 3)[2]).toBeCloseTo(14 / 6, 10);
    expect(refWMA([1, 2, 3], 3)[2]).toBeCloseTo(14 / 6, 10);
  });

  it("RSI of a pure uptrend = 100, pure downtrend = 0", () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    const down = Array.from({ length: 20 }, (_, i) => 20 - i);
    for (const v of calculateRSI(up, 14).values) if (v !== null) expect(v).toBeCloseTo(100, 9);
    for (const v of refRSI(up, 14)) if (v !== null) expect(v).toBeCloseTo(100, 9);
    for (const v of calculateRSI(down, 14).values) if (v !== null) expect(v).toBeCloseTo(0, 9);
    for (const v of refRSI(down, 14)) if (v !== null) expect(v).toBeCloseTo(0, 9);
  });

  it("Bollinger of a constant series collapses to the mean (zero stddev)", () => {
    const flat = [5, 5, 5, 5, 5];
    const bb = calculateBollingerBands(flat, 3, 2);
    expect(bb.upper[4]).toBeCloseTo(5, 9);
    expect(bb.lower[4]).toBeCloseTo(5, 9);
    expect(refPopStdDev([5, 5, 5])).toBe(0);
    expect(refPopStdDev([2, 4, 6])).toBeCloseTo(Math.sqrt(8 / 3), 10);
  });
});

// Differential leg: production vs reference over reproducible random series. This
// catches optimization / edge-case divergence (the most common bug class) even
// where no hand anchor exists.
describe("differential oracle — production vs reference over random series", () => {
  const seeds = [1, 7, 42, 1337];

  it("every core indicator matches its reference on every seed (the gate)", () => {
    const results = [];
    for (const seed of seeds) {
      const s = randomSeries(90, makePrng(seed));
      results.push(runOracleCase(`SMA/${seed}`, calculateSMA(s, 14), refSMA(s, 14)));
      results.push(runOracleCase(`EMA/${seed}`, calculateEMA(s, 14).values, refEMA(s, 14)));
      results.push(runOracleCase(`WMA/${seed}`, calculateWMA(s, 14), refWMA(s, 14)));
      results.push(runOracleCase(`RSI/${seed}`, calculateRSI(s, 14).values, refRSI(s, 14)));
      const bb = calculateBollingerBands(s, 20, 2);
      const rb = refBollinger(s, 20, 2);
      results.push(runOracleCase(`BB.upper/${seed}`, bb.upper, rb.upper));
      results.push(runOracleCase(`BB.middle/${seed}`, bb.middle, rb.middle));
      results.push(runOracleCase(`BB.lower/${seed}`, bb.lower, rb.lower));
    }
    const report = runOracleBench(results);
    if (!report.passed) throw new Error(report.summary); // readable failure
    expect(report.passed).toBe(true);
    expect(report.matchRate).toBe(1);
  });
});

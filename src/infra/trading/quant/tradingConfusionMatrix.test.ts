import { describe, it, expect } from "bun:test";
import {
  computeTradingConfusionMatrix,
  tradingConfusionMatrixToPayload,
} from "./tradingConfusionMatrix.ts";

describe("computeTradingConfusionMatrix — perfect agreement", () => {
  it("identical sequences yield accuracy = 1", () => {
    const r = computeTradingConfusionMatrix({
      actualPositions: [1, -1, 1, 0, -1],
      oraclePositions: [1, -1, 1, 0, -1],
    });
    expect(r.accuracy).toBe(1);
    expect(r.longPrecision).toBe(1);
    expect(r.longRecall).toBe(1);
    expect(r.shortPrecision).toBe(1);
    expect(r.shortRecall).toBe(1);
  });

  it("opposite sequences yield accuracy = 0", () => {
    const r = computeTradingConfusionMatrix({
      actualPositions: [1, 1, -1, -1],
      oraclePositions: [-1, -1, 1, 1],
    });
    expect(r.accuracy).toBe(0);
    expect(r.longPrecision).toBe(0);
    expect(r.shortPrecision).toBe(0);
  });
});

describe("computeTradingConfusionMatrix — cell counts", () => {
  it("populates 3x3 correctly", () => {
    // t=0: actual=+1, oracle=+1 → LL
    // t=1: actual=+1, oracle=-1 → LS
    // t=2: actual=-1, oracle=-1 → SS
    // t=3: actual= 0, oracle= 0 → FF
    // t=4: actual=-1, oracle=+1 → SL
    const r = computeTradingConfusionMatrix({
      actualPositions: [1, 1, -1, 0, -1],
      oraclePositions: [1, -1, -1, 0, 1],
    });
    expect(r.cells.longLong).toBe(1);
    expect(r.cells.longShort).toBe(1);
    expect(r.cells.shortShort).toBe(1);
    expect(r.cells.flatFlat).toBe(1);
    expect(r.cells.shortLong).toBe(1);
    expect(r.totalPeriods).toBe(5);
  });

  it("treats fractional positions by sign", () => {
    const r = computeTradingConfusionMatrix({
      actualPositions: [0.3, -0.7, 0.1],
      oraclePositions: [1, -1, 1],
    });
    expect(r.accuracy).toBe(1);
  });
});

describe("computeTradingConfusionMatrix — precision / recall / F1", () => {
  it("computes precision = TP / (TP + FP) for long class", () => {
    // actual long at t=0, t=1; oracle long only at t=0
    const r = computeTradingConfusionMatrix({
      actualPositions: [1, 1, -1],
      oraclePositions: [1, -1, -1],
    });
    // longLong=1, longShort=1; actual long total = 2 → precision = 1/2
    expect(r.longPrecision).toBeCloseTo(0.5, 9);
  });

  it("F1 = harmonic mean of precision and recall", () => {
    const r = computeTradingConfusionMatrix({
      actualPositions: [1, 1, 1, -1],
      oraclePositions: [1, -1, 1, 1],
    });
    // longLong=2, longShort=1, shortLong=1
    // actual long = 3, oracle long = 3 → precision = 2/3, recall = 2/3 → F1 = 2/3
    expect(r.longF1).toBeCloseTo(2 / 3, 6);
  });
});

describe("computeTradingConfusionMatrix — alpha leakage", () => {
  it("zero leakage when actual matches oracle", () => {
    const r = computeTradingConfusionMatrix({
      actualPositions: [1, -1, 1],
      oraclePositions: [1, -1, 1],
      realisedReturns: [0.01, -0.02, 0.015],
    });
    expect(r.alphaLeakage).toBe(0);
  });

  it("positive leakage when actual underperforms oracle", () => {
    const r = computeTradingConfusionMatrix({
      actualPositions: [-1, -1, -1],
      oraclePositions: [1, 1, 1],
      realisedReturns: [0.01, 0.01, 0.01],
    });
    // actual PnL = -0.03, oracle PnL = +0.03 → leakage = 0.06
    expect(r.alphaLeakage).toBeCloseTo(0.06, 9);
  });

  it("null leakage when returns omitted", () => {
    const r = computeTradingConfusionMatrix({
      actualPositions: [1, -1],
      oraclePositions: [1, -1],
    });
    expect(r.alphaLeakage).toBeNull();
  });
});

describe("computeTradingConfusionMatrix — validation", () => {
  it("throws on length mismatch", () => {
    expect(() =>
      computeTradingConfusionMatrix({
        actualPositions: [1, -1],
        oraclePositions: [1],
      }),
    ).toThrow();
  });

  it("throws on returns length mismatch", () => {
    expect(() =>
      computeTradingConfusionMatrix({
        actualPositions: [1, -1],
        oraclePositions: [1, -1],
        realisedReturns: [0.01],
      }),
    ).toThrow();
  });
});

describe("tradingConfusionMatrixToPayload", () => {
  it("emits stable shape", () => {
    const r = computeTradingConfusionMatrix({
      actualPositions: [1, -1],
      oraclePositions: [1, -1],
    });
    const p = tradingConfusionMatrixToPayload(r) as { kind: string };
    expect(p.kind).toBe("trading_confusion_matrix.computed");
  });
});

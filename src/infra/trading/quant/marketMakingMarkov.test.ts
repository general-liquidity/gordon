import { describe, expect, test } from "bun:test";
import { computeMarketMakingMarkov } from "./marketMakingMarkov.ts";

describe("computeMarketMakingMarkov", () => {
  test("hand-built matrix matches closed-form metrics (W=5)", () => {
    const matrix = [
      [0.5, 0.4, 0.1],
      [0.3, 0.5, 0.2],
      [1, 0, 0],
    ];
    const W = 5;

    // By hand:
    // p01=0.4, p02=0.1, p10=0.3, p11=0.5, p12=0.2
    // waitFillSum = Σ_{n=0..5} 0.5^n · 0.2
    let waitFillSum = 0;
    for (let n = 0; n <= W; n++) waitFillSum += 0.5 ** n * 0.2;
    // = 0.2 * (1 + 0.5 + 0.25 + 0.125 + 0.0625 + 0.03125) = 0.2 * 1.96875 = 0.39375
    const expectedMakeSpread = 0.1 + 0.4 * waitFillSum; // 0.1 + 0.1575 = 0.2575
    const expectedOneSide = 0.4 * 0.5 ** W * 0.3; // 0.4 * 0.03125 * 0.3 = 0.00375

    expect(expectedMakeSpread).toBeCloseTo(0.2575, 9);
    expect(expectedOneSide).toBeCloseTo(0.00375, 9);

    const r = computeMarketMakingMarkov({ transitionMatrix: matrix, waitingPeriods: W });
    expect(r.pMakeSpread).toBeCloseTo(expectedMakeSpread, 6);
    expect(r.pOneSideFill).toBeCloseTo(expectedOneSide, 6);
    expect(r.waitingPeriods).toBe(5);
    expect(r.transitionMatrix).toEqual(matrix);
  });

  test("estimate from state sequence: row-normalized transition counts", () => {
    // Path: 0,1,2,0,1,1,0,2
    const states: Array<0 | 1 | 2> = [0, 1, 2, 0, 1, 1, 0, 2];
    const r = computeMarketMakingMarkov({ states });

    // Transition counts:
    //  0->1 (idx0), 1->2 (idx1), 2->0 (idx2), 0->1 (idx3),
    //  1->1 (idx4), 1->0 (idx5), 0->2 (idx6)
    // Row 0: {1:2, 2:1} total 3 -> [0, 2/3, 1/3]
    // Row 1: {2:1, 1:1, 0:1} total 3 -> [1/3, 1/3, 1/3]
    // Row 2: {0:1} total 1 -> [1, 0, 0]
    expect(r.transitionMatrix[0]![0]).toBeCloseTo(0, 6);
    expect(r.transitionMatrix[0]![1]).toBeCloseTo(2 / 3, 6);
    expect(r.transitionMatrix[0]![2]).toBeCloseTo(1 / 3, 6);
    expect(r.transitionMatrix[1]![0]).toBeCloseTo(1 / 3, 6);
    expect(r.transitionMatrix[1]![1]).toBeCloseTo(1 / 3, 6);
    expect(r.transitionMatrix[1]![2]).toBeCloseTo(1 / 3, 6);
    expect(r.transitionMatrix[2]![0]).toBeCloseTo(1, 6);
    expect(r.transitionMatrix[2]![1]).toBeCloseTo(0, 6);
    expect(r.transitionMatrix[2]![2]).toBeCloseTo(0, 6);

    // Each row sums to 1.
    for (let i = 0; i < 3; i++) {
      const row = r.transitionMatrix[i]!;
      expect(row[0]! + row[1]! + row[2]!).toBeCloseTo(1, 5);
    }

    expect(r.sampleSize).toBe(8);
  });

  test("maker that always captures immediately: pMakeSpread≈1, pOneSideFill≈0", () => {
    const matrix = [
      [0, 0, 1], // 0 -> 2 always
      [0, 0, 1],
      [1, 0, 0],
    ];
    const r = computeMarketMakingMarkov({ transitionMatrix: matrix });
    expect(r.pMakeSpread).toBeCloseTo(1, 6);
    expect(r.pOneSideFill).toBeCloseTo(0, 6);
  });

  test("invalid / empty input → neutral", () => {
    const empty = computeMarketMakingMarkov({});
    expect(empty.pMakeSpread).toBe(0);
    expect(empty.pOneSideFill).toBe(0);
    expect(empty.sampleSize).toBe(0);
    expect(empty.interpretation.length).toBeGreaterThan(0);

    const badMatrix = computeMarketMakingMarkov({
      transitionMatrix: [
        [0.5, 0.5, 0.5],
        [0.3, 0.5, 0.2],
        [1, 0, 0],
      ],
    });
    expect(badMatrix.pMakeSpread).toBe(0);
    expect(badMatrix.transitionMatrix).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);

    const tooFewStates = computeMarketMakingMarkov({ states: [0] });
    expect(tooFewStates.pMakeSpread).toBe(0);
    expect(tooFewStates.sampleSize).toBe(0);
  });
});

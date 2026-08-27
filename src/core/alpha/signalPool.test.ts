import { describe, expect, test } from "bun:test";
import { computeSignalPool } from "./signalPool.ts";

describe("computeSignalPool — basic voting", () => {
  test("all signals agree → fraction 1.0, fired = true at majority threshold", () => {
    const r = computeSignalPool({
      signals: [
        [true, true, true],
        [true, true, true],
        [true, true, true],
      ],
    });
    expect(r.fractions).toEqual([1, 1, 1]);
    expect(r.fired).toEqual([true, true, true]);
    expect(r.firedCount).toBe(3);
    expect(r.meanFraction).toBe(1);
  });

  test("no signals agree → fraction 0, fired = false", () => {
    const r = computeSignalPool({
      signals: [
        [false, false, false],
        [false, false, false],
      ],
    });
    expect(r.fractions).toEqual([0, 0, 0]);
    expect(r.fired).toEqual([false, false, false]);
    expect(r.firedCount).toBe(0);
  });

  test("partial agreement — 2/3 true crosses default 0.5 threshold", () => {
    const r = computeSignalPool({
      signals: [[true], [true], [false]],
    });
    expect(r.fractions[0]).toBeCloseTo(2 / 3, 5);
    expect(r.fired[0]).toBe(true);
  });

  test("1/3 true does NOT cross 0.5 threshold", () => {
    const r = computeSignalPool({
      signals: [[true], [false], [false]],
    });
    expect(r.fired[0]).toBe(false);
  });
});

describe("computeSignalPool — thresholds", () => {
  test("threshold 0.6 requires more agreement", () => {
    const r = computeSignalPool({
      signals: [[true], [true], [false]],
      threshold: 0.7,
    });
    expect(r.fired[0]).toBe(false);
  });

  test("threshold 0 fires on any signal", () => {
    const r = computeSignalPool({
      signals: [
        [false, true, false],
        [false, false, true],
      ],
      threshold: 0,
    });
    // Threshold 0 means fired whenever fraction >= 0 — always true.
    expect(r.fired).toEqual([true, true, true]);
  });

  test("threshold 1 requires unanimous", () => {
    const r = computeSignalPool({
      signals: [
        [true, true, true],
        [true, false, true],
      ],
      threshold: 1,
    });
    expect(r.fired).toEqual([true, false, true]);
  });
});

describe("computeSignalPool — input forms", () => {
  test("accepts number arrays (0 = false, non-zero = true)", () => {
    const r = computeSignalPool({
      signals: [
        [1, 0, 1],
        [1, 1, 0],
        [0, 1, 1],
      ],
    });
    expect(r.fractions[0]).toBeCloseTo(2 / 3, 5);
    expect(r.fractions[1]).toBeCloseTo(2 / 3, 5);
    expect(r.fractions[2]).toBeCloseTo(2 / 3, 5);
  });

  test("rejects mismatched signal lengths", () => {
    expect(() =>
      computeSignalPool({
        signals: [
          [true, true],
          [true, true, true],
        ],
      }),
    ).toThrow(/length/);
  });

  test("empty signals returns empty result", () => {
    const r = computeSignalPool({ signals: [] });
    expect(r.barCount).toBe(0);
    expect(r.signalCount).toBe(0);
  });
});

describe("computeSignalPool — error handling", () => {
  test("throws on out-of-range threshold", () => {
    expect(() => computeSignalPool({ signals: [[true]], threshold: 1.5 })).toThrow(/threshold/);
    expect(() => computeSignalPool({ signals: [[true]], threshold: -0.1 })).toThrow(/threshold/);
  });
});

describe("computeSignalPool — aggregate stats", () => {
  test("meanFraction is the average across bars", () => {
    const r = computeSignalPool({
      signals: [
        [true, false, true, false],
        [true, false, false, true],
      ],
    });
    // fractions: 1, 0, 0.5, 0.5 → mean = 0.5
    expect(r.meanFraction).toBeCloseTo(0.5, 5);
  });
});

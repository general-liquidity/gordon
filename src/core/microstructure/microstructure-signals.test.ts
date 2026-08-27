import { describe, expect, test } from "bun:test";
import {
  imbalanceSignal,
  micropriceMomentum,
  orderFlowPressure,
} from "./microstructure-signals.ts";

describe("micropriceMomentum", () => {
  test("empty / invalid lookback → 0", () => {
    expect(micropriceMomentum([], 5)).toBe(0);
    expect(micropriceMomentum([0.1, 0.2], 0)).toBe(0);
    expect(micropriceMomentum([0.1, 0.2], -3)).toBe(0);
  });

  test("persistent positive lean → positive momentum (long pressure)", () => {
    const m = micropriceMomentum([0.1, 0.2, 0.3, 0.25, 0.3], 5);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThanOrEqual(1);
  });

  test("persistent negative lean → negative momentum (short pressure)", () => {
    const m = micropriceMomentum([-0.1, -0.2, -0.3, -0.25, -0.3], 5);
    expect(m).toBeLessThan(0);
    expect(m).toBeGreaterThanOrEqual(-1);
  });

  test("balanced window → near-0", () => {
    expect(micropriceMomentum([0.2, -0.2, 0.2, -0.2], 4)).toBeCloseTo(0, 6);
  });

  test("only the last `lookback` values matter", () => {
    // Early strong-negative drift, recent strong-positive — windowed to recent.
    const series = [-0.9, -0.9, -0.9, 0.4, 0.5, 0.6];
    expect(micropriceMomentum(series, 3)).toBeGreaterThan(0);
  });

  test("NaN entries are ignored, output stays unit-scaled", () => {
    const m = micropriceMomentum([NaN, 0.3, 0.3, NaN, 0.3], 5);
    expect(Number.isFinite(m)).toBe(true);
    expect(Math.abs(m)).toBeLessThanOrEqual(1);
    expect(m).toBeGreaterThan(0);
  });
});

describe("imbalanceSignal", () => {
  test("z above +threshold → long (+1)", () => {
    expect(imbalanceSignal(1.5, 1)).toBe(1);
  });

  test("z below −threshold → short (−1)", () => {
    expect(imbalanceSignal(-1.5, 1)).toBe(-1);
  });

  test("inside the band → flat (0)", () => {
    expect(imbalanceSignal(0.5, 1)).toBe(0);
    expect(imbalanceSignal(-0.5, 1)).toBe(0);
    expect(imbalanceSignal(0, 1)).toBe(0);
  });

  test("threshold is respected (custom + at-boundary is exclusive)", () => {
    expect(imbalanceSignal(2.5, 2)).toBe(1);
    expect(imbalanceSignal(1.5, 2)).toBe(0);
    expect(imbalanceSignal(2.0, 2)).toBe(0); // exactly at threshold → no view
    expect(imbalanceSignal(-2.0, 2)).toBe(0);
  });

  test("default threshold = 1", () => {
    expect(imbalanceSignal(1.2)).toBe(1);
    expect(imbalanceSignal(0.9)).toBe(0);
  });

  test("NaN inputs → 0", () => {
    expect(imbalanceSignal(NaN)).toBe(0);
    expect(imbalanceSignal(2, NaN)).toBe(0);
  });
});

describe("orderFlowPressure", () => {
  test("bid-heavy book + microprice above mid → strong positive (long)", () => {
    const p = orderFlowPressure({ imbalance: 0.8, micropriceVsMid: 1e-5 });
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThanOrEqual(1);
  });

  test("ask-heavy book + microprice below mid → strong negative (short)", () => {
    const p = orderFlowPressure({ imbalance: -0.8, micropriceVsMid: -1e-5 });
    expect(p).toBeLessThan(-0.5);
    expect(p).toBeGreaterThanOrEqual(-1);
  });

  test("conflicting signals → near-0", () => {
    // bid-heavy imbalance but microprice leans the other way.
    const p = orderFlowPressure({ imbalance: 0.8, micropriceVsMid: -1e-5 });
    expect(Math.abs(p)).toBeLessThan(0.2);
  });

  test("agree pressure exceeds conflict pressure for the same imbalance", () => {
    const agree = orderFlowPressure({ imbalance: 0.8, micropriceVsMid: 1e-5 });
    const conflict = orderFlowPressure({ imbalance: 0.8, micropriceVsMid: -1e-5 });
    expect(agree).toBeGreaterThan(conflict);
  });

  test("flat microprice → imbalance-only, scaled down but same sign", () => {
    const p = orderFlowPressure({ imbalance: 0.8, micropriceVsMid: 0 });
    expect(p).toBeGreaterThan(0);
    // weaker than the agreeing case (no microprice confirmation).
    const agree = orderFlowPressure({ imbalance: 0.8, micropriceVsMid: 1e-5 });
    expect(p).toBeLessThan(agree);
  });

  test("output is clamped to [−1, +1] even with extreme inputs", () => {
    expect(orderFlowPressure({ imbalance: 5, micropriceVsMid: 1 })).toBeLessThanOrEqual(1);
    expect(orderFlowPressure({ imbalance: -5, micropriceVsMid: -1 })).toBeGreaterThanOrEqual(-1);
  });

  test("imbalanceWeight tilts the blend toward the imbalance leg", () => {
    // High weight → microprice confirmation contributes less.
    const lowW = orderFlowPressure(
      { imbalance: 0.5, micropriceVsMid: 1e-5 },
      { imbalanceWeight: 0.2 },
    );
    const highW = orderFlowPressure(
      { imbalance: 0.5, micropriceVsMid: 1e-5 },
      { imbalanceWeight: 0.95 },
    );
    // With imb 0.5: lowW = 0.2*0.5 + 0.8 = 0.9 ; highW = 0.95*0.5 + 0.05 = 0.525
    expect(lowW).toBeGreaterThan(highW);
  });

  test("NaN / missing fields treated as neutral", () => {
    expect(orderFlowPressure({ imbalance: NaN, micropriceVsMid: NaN })).toBe(0);
    expect(Number.isFinite(orderFlowPressure({ imbalance: 0.5, micropriceVsMid: NaN }))).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { kalmanFilterAdaptiveQ, DEFAULT_KALMAN_CONFIG } from "./kalmanFilter.ts";

describe("kalmanFilterAdaptiveQ", () => {
  test("returns empty result for an empty price series", () => {
    const r = kalmanFilterAdaptiveQ([], []);
    expect(r.filtered.length).toBe(0);
    expect(r.qSeries.length).toBe(0);
  });

  test("scales Q per step by (vol / referenceVol)^2", () => {
    const prices = [100, 101, 102, 103];
    const vol = [1, 1, 1, 4];
    const r = kalmanFilterAdaptiveQ(prices, vol, {
      ...DEFAULT_KALMAN_CONFIG,
      referenceVol: 1,
    });
    const baseQ = DEFAULT_KALMAN_CONFIG.processVariance;
    expect(r.qSeries.length).toBe(prices.length);
    expect(r.qSeries[0]!).toBeCloseTo(baseQ, 12);
    expect(r.qSeries[3]!).toBeCloseTo(baseQ * 16, 12); // (4/1)^2 = 16
    expect(r.qSeries[3]!).toBeGreaterThan(r.qSeries[0]!);
  });

  test("carries the last vol value forward when the vol series is shorter", () => {
    const prices = [100, 101, 102, 103, 104];
    const vol = [1, 2, 3]; // shorter than prices
    const r = kalmanFilterAdaptiveQ(prices, vol, {
      ...DEFAULT_KALMAN_CONFIG,
      referenceVol: 2,
    });
    const baseQ = DEFAULT_KALMAN_CONFIG.processVariance;
    // Steps 3 and 4 carry vol = 3 → scale 1.5 → Q = baseQ * 2.25.
    expect(r.qSeries.length).toBe(prices.length);
    expect(r.qSeries[4]!).toBeCloseTo(baseQ * 2.25, 12);
    expect(r.qSeries[3]!).toBeCloseTo(r.qSeries[4]!, 12);
  });

  test("clamps the vol scale at maxScale", () => {
    const prices = [100, 100];
    const vol = [1, 100];
    const r = kalmanFilterAdaptiveQ(prices, vol, {
      ...DEFAULT_KALMAN_CONFIG,
      referenceVol: 1,
      maxScale: 5,
    });
    const baseQ = DEFAULT_KALMAN_CONFIG.processVariance;
    expect(r.qSeries[1]!).toBeCloseTo(baseQ * 25, 12); // min(100,5)^2 = 25
  });

  test("responds faster to a jump during a high-vol step", () => {
    // Flat then a jump. Mark the jump region as high-vol so Q inflates there.
    const prices = [...Array(20).fill(100), 110, 110, 110];
    const constVol = new Array(prices.length).fill(1);
    const spikeVol = [...Array(20).fill(1), 8, 8, 8];
    const flat = kalmanFilterAdaptiveQ(prices, constVol, {
      ...DEFAULT_KALMAN_CONFIG,
      referenceVol: 1,
    });
    const adaptive = kalmanFilterAdaptiveQ(prices, spikeVol, {
      ...DEFAULT_KALMAN_CONFIG,
      referenceVol: 1,
    });
    const errFlat = Math.abs(flat.filtered[flat.filtered.length - 1]! - 110);
    const errAdaptive = Math.abs(adaptive.filtered[adaptive.filtered.length - 1]! - 110);
    expect(errAdaptive).toBeLessThan(errFlat);
  });

  test("falls back to scale 1 when no reference vol is derivable", () => {
    const prices = [100, 101, 102];
    const r = kalmanFilterAdaptiveQ(prices, [0, 0, 0]); // no positive vols
    const baseQ = DEFAULT_KALMAN_CONFIG.processVariance;
    for (const q of r.qSeries) expect(q).toBeCloseTo(baseQ, 12);
  });
});

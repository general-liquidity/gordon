import { describe, expect, test } from "bun:test";
import { computeKalmanTrend } from "./kalmanTrend.ts";

function ramp(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  if (step > 0) for (let p = start; p <= end; p += step) out.push(p);
  else for (let p = start; p >= end; p += step) out.push(p);
  return out;
}

describe("computeKalmanTrend", () => {
  test("returns a neutral guard result for < 2 observations", () => {
    const r = computeKalmanTrend({ prices: [100] });
    expect(r.currentLevel).toBeNull();
    expect(r.currentVelocity).toBeNull();
    expect(r.trend).toBe("neutral");
    expect(r.signal).toBe("none");
    expect(r.levels.length).toBe(0);
  });

  test("tracks a rising series with positive velocity + bullish trend", () => {
    const prices = ramp(100, 150, 1);
    const r = computeKalmanTrend({ prices });
    expect(r.levels.length).toBe(prices.length);
    expect(r.velocities.length).toBe(prices.length);
    expect(r.currentVelocity!).toBeGreaterThan(0);
    expect(r.trend).toBe("bullish");
    // Filtered level should sit near the last price on a clean linear ramp.
    expect(Math.abs(r.currentLevel! - 150)).toBeLessThan(5);
  });

  test("tracks a falling series with negative velocity + bearish trend", () => {
    const prices = ramp(150, 100, -1);
    const r = computeKalmanTrend({ prices });
    expect(r.currentVelocity!).toBeLessThan(0);
    expect(r.trend).toBe("bearish");
  });

  test("detects a bearish velocity zero-crossing on an up-then-down triangle", () => {
    const up = ramp(100, 150, 1);
    const down = ramp(149, 100, -1);
    const prices = [...up, ...down];
    const r = computeKalmanTrend({ prices });

    // Ends in a downtrend.
    expect(r.currentVelocity!).toBeLessThan(0);
    // A crossing was found, and the most recent one is downward (the peak turn).
    expect(r.lastCrossingIndex).not.toBeNull();
    expect(r.lastCrossingDirection).toBe("down");
    // The turn should land somewhere near the peak (allowing for filter lag).
    expect(r.lastCrossingIndex!).toBeGreaterThan(up.length - 5);
    expect(r.lastCrossingIndex!).toBeLessThan(up.length + 25);
  });

  test("signal is consistent with the last-bar crossing", () => {
    const prices = [...ramp(100, 150, 1), ...ramp(149, 100, -1)];
    const r = computeKalmanTrend({ prices });
    if (r.lastCrossingIndex === prices.length - 1) {
      expect(r.signal).not.toBe("none");
      expect(r.signal).toBe(
        r.lastCrossingDirection === "up" ? "bullish_reversal" : "bearish_reversal",
      );
    } else {
      expect(r.signal).toBe("none");
    }
  });

  test("velocities are all finite (covariance stays well-conditioned)", () => {
    const prices = ramp(100, 160, 0.5);
    const r = computeKalmanTrend({ prices });
    for (const v of r.velocities) expect(Number.isFinite(v)).toBe(true);
    for (const l of r.levels) expect(Number.isFinite(l)).toBe(true);
  });

  test("higher processNoise tracks price more responsively", () => {
    // A step change: flat, then a jump. Higher q should close the gap faster.
    const prices = [...Array(30).fill(100), ...Array(30).fill(110)];
    const smooth = computeKalmanTrend({ prices, processNoise: 1e-6, measurementNoise: 1 });
    const responsive = computeKalmanTrend({ prices, processNoise: 1, measurementNoise: 1 });
    const errSmooth = Math.abs(smooth.currentLevel! - 110);
    const errResponsive = Math.abs(responsive.currentLevel! - 110);
    expect(errResponsive).toBeLessThan(errSmooth);
  });
});

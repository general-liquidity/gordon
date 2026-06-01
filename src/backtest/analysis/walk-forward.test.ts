import { describe, it, expect } from "bun:test";
import { walkForwardTest } from "./walk-forward.ts";
import type { OHLC } from "../types.ts";

/**
 * Deterministic HOLD-only strategy — produces no trades, so the test
 * isolates the train/test window-splitting logic (purge/embargo) from
 * any backtest-engine behavior. Cast to the exact param type
 * walkForwardTest expects (the rich strategies/types Strategy); only
 * generateSignal is exercised on a HOLD path, so the thin mock suffices
 * at runtime.
 */
const holdStrategy = {
  id: "hold-only",
  name: "Hold Only",
  generateSignal(bar: OHLC) {
    return { type: "HOLD", price: bar.close, timestamp: bar.timestamp, reason: "test" };
  },
} as unknown as Parameters<typeof walkForwardTest>[0];

/**
 * Build `n` bars whose `timestamp === index`, so window-boundary
 * timestamps in the result map directly back to slice indices.
 */
function makeBars(n: number): OHLC[] {
  const bars: OHLC[] = [];
  for (let i = 0; i < n; i++) {
    const price = 100 + Math.sin(i / 7) * 2;
    bars.push({ timestamp: i, open: price, high: price + 1, low: price - 1, close: price, volume: 1000 });
  }
  return bars;
}

describe("walkForwardTest — purge/embargo splitting", () => {
  const N = 300; // numWindows=3 → windowSize=100, trainSize=70, testSize=30

  it("default behavior is unchanged (no purge, no embargo)", async () => {
    const result = await walkForwardTest(holdStrategy, makeBars(N), {
      trainRatio: 0.7,
      numWindows: 3,
      parameterRanges: {},
      optimizeFor: "sharpeRatio",
    });

    expect(result.windows.length).toBe(3);
    // Window 0: train [0,70) → last index 69, test starts at 70.
    const w0 = result.windows[0]!;
    expect(w0.trainStart).toBe(0); // timestamp of train[0]
    expect(w0.trainEnd).toBe(69); // timestamp of train[last] = trainSize - 1
    expect(w0.testStart).toBe(70); // timestamp of test[0] = trainEnd index
  });

  it("purgeBars drops the last N train bars; train ends at testStart-1-purgeBars", async () => {
    const purgeBars = 5;
    const result = await walkForwardTest(holdStrategy, makeBars(N), {
      trainRatio: 0.7,
      numWindows: 3,
      parameterRanges: {},
      optimizeFor: "sharpeRatio",
      purgeBars,
    });

    const w0 = result.windows[0]!;
    const testStartIdx = 70; // unchanged by purge
    expect(w0.testStart).toBe(testStartIdx);
    // Train last index = testStart - 1 - purgeBars
    expect(w0.trainEnd).toBe(testStartIdx - 1 - purgeBars); // 64
    expect(w0.trainStart).toBe(0);
    // The 5 purged bars (65..69) are excluded from train.
    expect(w0.trainEnd).toBeLessThan(testStartIdx - purgeBars);
  });

  it("embargoBars shifts subsequent windows forward by the cumulative gap", async () => {
    const embargoBars = 4;
    const base = await walkForwardTest(holdStrategy, makeBars(N), {
      trainRatio: 0.7,
      numWindows: 3,
      parameterRanges: {},
      optimizeFor: "sharpeRatio",
    });
    const embargoed = await walkForwardTest(holdStrategy, makeBars(N), {
      trainRatio: 0.7,
      numWindows: 3,
      parameterRanges: {},
      optimizeFor: "sharpeRatio",
      embargoBars,
    });

    // Window 0 unchanged (offset i*embargo = 0); window 1 shifted by embargoBars.
    expect(embargoed.windows[0]!.trainStart).toBe(base.windows[0]!.trainStart);
    expect(embargoed.windows[1]!.trainStart).toBe(base.windows[1]!.trainStart + embargoBars);
  });

  it("purge + embargo combine: train end accounts for purge, start for embargo", async () => {
    const purgeBars = 5;
    const embargoBars = 4;
    const result = await walkForwardTest(holdStrategy, makeBars(N), {
      trainRatio: 0.7,
      numWindows: 3,
      parameterRanges: {},
      optimizeFor: "sharpeRatio",
      purgeBars,
      embargoBars,
    });

    const w1 = result.windows[1]!;
    // Window 1 base windowStart = windowSize + embargo = 100 + 4 = 104.
    const windowStart = 100 + embargoBars;
    const trainSize = 70;
    const testStartIdx = windowStart + trainSize; // 174
    expect(w1.trainStart).toBe(windowStart);
    expect(w1.testStart).toBe(testStartIdx);
    expect(w1.trainEnd).toBe(testStartIdx - 1 - purgeBars);
  });
});

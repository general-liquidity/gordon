import { describe, expect, test } from "bun:test";
import { reversalScore, reversalSignal } from "./reversal-strategy.ts";

/** A flat series with one sharp drop at the end → clearly oversold. */
function oversoldSeries(): number[] {
  const xs = Array.from({ length: 20 }, () => 100);
  xs.push(90); // sharp dip below the recent mean
  return xs;
}

/** A flat series with one sharp spike at the end → clearly overbought. */
function overboughtSeries(): number[] {
  const xs = Array.from({ length: 20 }, () => 100);
  xs.push(110); // sharp pop above the recent mean
  return xs;
}

describe("reversalScore", () => {
  test("oversold (price below recent mean) → positive score", () => {
    expect(reversalScore(oversoldSeries(), 14)).toBeGreaterThan(0);
  });

  test("overbought (price above recent mean) → negative score", () => {
    expect(reversalScore(overboughtSeries(), 14)).toBeLessThan(0);
  });

  test("defensive: too-short input → 0", () => {
    expect(reversalScore([100, 101, 102], 14)).toBe(0);
  });

  test("defensive: zero-dispersion window → 0", () => {
    const flat = Array.from({ length: 20 }, () => 100);
    expect(reversalScore(flat, 14)).toBe(0);
  });
});

describe("reversalSignal", () => {
  test("clearly oversold series → long", () => {
    const sig = reversalSignal(oversoldSeries(), { lookback: 14, zThreshold: 1.0 });
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe("long");
    expect(sig!.strength).toBeGreaterThan(1.0);
  });

  test("clearly overbought series → short", () => {
    const sig = reversalSignal(overboughtSeries(), { lookback: 14, zThreshold: 1.0 });
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe("short");
    expect(sig!.strength).toBeGreaterThan(1.0);
  });

  test("flat / neutral series → null", () => {
    const flat = Array.from({ length: 20 }, () => 100);
    expect(reversalSignal(flat, { lookback: 14 })).toBeNull();
  });

  test("mild deviation inside the neutral band → null", () => {
    // A small wiggle that won't exceed a z of 1.0.
    const xs = [100, 101, 99, 100, 101, 99, 100, 101, 99, 100, 101, 99, 100, 100.3];
    const sig = reversalSignal(xs, { lookback: 14, zThreshold: 1.0 });
    expect(sig).toBeNull();
  });

  test("defensive: too-short input → null", () => {
    expect(reversalSignal([100, 99, 101], { lookback: 14 })).toBeNull();
  });

  test("stop & target scale with recent volatility", () => {
    // Same terminal dip, but one series has a noisier (higher-vol) history.
    const calmHist = Array.from({ length: 20 }, () => 100);
    const calm = [...calmHist, 90];

    const noisyHist: number[] = [];
    for (let i = 0; i < 20; i++) noisyHist.push(i % 2 === 0 ? 95 : 105);
    const noisy = [...noisyHist, 90];

    const calmSig = reversalSignal(calm, { lookback: 14 });
    const noisySig = reversalSignal(noisy, { lookback: 14 });
    expect(calmSig).not.toBeNull();
    expect(noisySig).not.toBeNull();
    // Higher recent return-vol → wider stop and target.
    expect(noisySig!.stopDistance).toBeGreaterThan(calmSig!.stopDistance);
    expect(noisySig!.targetDistance).toBeGreaterThan(calmSig!.targetDistance);
  });

  test("stop/target obey their multipliers (target < stop at defaults)", () => {
    const sig = reversalSignal(oversoldSeries(), { lookback: 14, stopMult: 2, targetMult: 1.5 });
    expect(sig).not.toBeNull();
    // stopMult 2 vs targetMult 1.5 → stop is wider in the default config.
    expect(sig!.stopDistance).toBeGreaterThan(sig!.targetDistance);
    // Ratio reflects the multiplier ratio (vol factor cancels).
    expect(sig!.stopDistance / sig!.targetDistance).toBeCloseTo(2 / 1.5, 5);
  });

  test("threshold behavior: a higher zThreshold suppresses a marginal signal", () => {
    // Build a series whose reversal score is moderate (~1.x stdevs).
    const xs = Array.from({ length: 20 }, () => 100);
    xs.push(97);
    const lowThresh = reversalSignal(xs, { lookback: 14, zThreshold: 1.0 });
    const highThresh = reversalSignal(xs, { lookback: 14, zThreshold: 5.0 });
    expect(lowThresh).not.toBeNull();
    expect(highThresh).toBeNull();
  });

  test("volForStops override is honored", () => {
    const sig = reversalSignal(oversoldSeries(), { lookback: 14, volForStops: 0.05, stopMult: 2 });
    expect(sig).not.toBeNull();
    const price = 90;
    expect(sig!.stopDistance).toBeCloseTo(price * 0.05 * 2, 6);
  });
});

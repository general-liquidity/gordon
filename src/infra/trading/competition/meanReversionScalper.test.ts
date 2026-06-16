import { describe, it, expect } from "bun:test";
import { makeMeanReversionScalper } from "./meanReversionScalper.ts";
import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";

/** Bars from a close path; high/low straddle close by ±halfRange. */
function bars(closes: number[], halfRange = 0.2): Mt5Bar[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 900,
    open: c,
    high: c + halfRange,
    low: c - halfRange,
    close: c,
    tick_volume: 1,
    spread: 0,
    real_volume: 0,
  })) as unknown as Mt5Bar[];
}

/** A choppy oscillation around 100 with a final spike DOWN (stretched below mean). */
function choppyThenDown(n: number, spike: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(100 + (i % 2 === 0 ? 0.5 : -0.5));
  out.push(100 - spike); // last bar far below the ~100 mean → z very negative
  return out;
}

describe("makeMeanReversionScalper", () => {
  const sig = makeMeanReversionScalper({ lookback: 20, entryZ: 1.5, stopStd: 2 });

  it("FADES a downward deviation in chop → long (buy below mean)", () => {
    const s = sig(bars(choppyThenDown(20, 3)));
    expect(s).not.toBeNull();
    expect(s!.side).toBe("long");
    expect(s!.stopDistance).toBeGreaterThan(0);
    expect(s!.targetDistance!).toBeGreaterThan(0);
  });

  it("FADES an upward deviation in chop → short (sell above mean)", () => {
    const up = choppyThenDown(20, 3).slice(0, -1);
    up.push(100 + 3); // spike UP instead
    const s = sig(bars(up));
    expect(s).not.toBeNull();
    expect(s!.side).toBe("short");
  });

  it("stands aside when the deviation is small (|z| < entryZ)", () => {
    const calm = Array.from({ length: 21 }, (_, i) => 100 + (i % 2 === 0 ? 0.3 : -0.3));
    expect(sig(bars(calm))).toBeNull();
  });

  it("does NOT fade a clean trend (efficiency-ratio gate)", () => {
    // Monotone ramp: high efficiency ratio → the chop gate blocks the fade even
    // though the last close is far from the window mean.
    const ramp = Array.from({ length: 21 }, (_, i) => 100 + i * 2);
    expect(sig(bars(ramp))).toBeNull();
  });

  it("returns null without enough history", () => {
    expect(sig(bars([100, 101, 99, 100]))).toBeNull();
  });

  it("scales brackets with volatility (wider stdev → wider stop)", () => {
    const calmChop = choppyThenDown(20, 3); // ±0.5 wiggle, spike 3
    const wildChop: number[] = [];
    for (let i = 0; i < 20; i++) wildChop.push(100 + (i % 2 === 0 ? 2 : -2)); // ±2 wiggle
    wildChop.push(100 - 12);
    const calmSig = sig(bars(calmChop));
    const wildSig = sig(bars(wildChop));
    expect(calmSig).not.toBeNull();
    expect(wildSig).not.toBeNull();
    expect(wildSig!.stopDistance).toBeGreaterThan(calmSig!.stopDistance);
  });
});

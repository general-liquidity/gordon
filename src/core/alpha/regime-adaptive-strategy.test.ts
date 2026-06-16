import { describe, it, expect } from "bun:test";
import {
  regimeAdaptiveSignal,
  classifyRegime,
  efficiencyRatio,
} from "./regime-adaptive-strategy.ts";

const LB = 20;

describe("efficiencyRatio / classifyRegime", () => {
  it("a clean straight uptrend has high ER → trending", () => {
    const closes = Array.from({ length: LB + 1 }, (_, i) => 100 + i); // +1 per bar, monotone
    expect(efficiencyRatio(closes, LB)).toBeGreaterThan(0.9);
    expect(classifyRegime(closes, LB)).toBe("trending");
  });

  it("an oscillating series with no net travel has low ER → choppy", () => {
    // Zig-zag around 100: lots of path, near-zero net move.
    const closes = Array.from({ length: LB + 1 }, (_, i) => 100 + (i % 2 === 0 ? -1 : 1));
    expect(efficiencyRatio(closes, LB)).toBeLessThan(0.4);
    expect(classifyRegime(closes, LB)).toBe("choppy");
  });

  it("degenerate flat series → ER 0 → choppy", () => {
    const flat = new Array(LB + 1).fill(100);
    expect(efficiencyRatio(flat, LB)).toBe(0);
    expect(classifyRegime(flat, LB)).toBe("choppy");
  });
});

describe("regimeAdaptiveSignal — trending branch (momentum)", () => {
  it("clean uptrend with a fresh breakout fires momentum LONG", () => {
    // Steady rise so ER is high (trending); the latest close is a new high vs the
    // prior window → breakout long.
    const closes = Array.from({ length: LB + 1 }, (_, i) => 100 + i * 0.5);
    expect(classifyRegime(closes, LB)).toBe("trending");
    const sig = regimeAdaptiveSignal(closes, { lookback: LB });
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe("long");
    expect(sig!.stopDistance).toBeGreaterThan(0);
    expect(sig!.targetDistance!).toBeGreaterThan(0);
  });

  it("clean downtrend with a fresh breakdown fires momentum SHORT", () => {
    const closes = Array.from({ length: LB + 1 }, (_, i) => 100 - i * 0.5);
    expect(classifyRegime(closes, LB)).toBe("trending");
    const sig = regimeAdaptiveSignal(closes, { lookback: LB });
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe("short");
  });
});

describe("regimeAdaptiveSignal — choppy branch (mean-reversion)", () => {
  it("choppy series with an oversold final bar fires mean-reversion LONG", () => {
    // Oscillate around 100 (low ER → choppy), then drop the last close well below
    // the recent mean so the reversal z-score crosses the long threshold.
    const closes: number[] = [];
    for (let i = 0; i < LB; i++) closes.push(100 + (i % 2 === 0 ? -1 : 1));
    closes.push(94); // sharp dip → oversold → fade-long
    expect(classifyRegime(closes, LB)).toBe("choppy");
    const sig = regimeAdaptiveSignal(closes, { lookback: LB, reversal: { zThreshold: 1.0 } });
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe("long");
    expect(sig!.stopDistance).toBeGreaterThan(0);
  });

  it("choppy series with an overbought final bar fires mean-reversion SHORT", () => {
    const closes: number[] = [];
    for (let i = 0; i < LB; i++) closes.push(100 + (i % 2 === 0 ? -1 : 1));
    closes.push(106); // sharp spike → overbought → fade-short
    expect(classifyRegime(closes, LB)).toBe("choppy");
    const sig = regimeAdaptiveSignal(closes, { lookback: LB, reversal: { zThreshold: 1.0 } });
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe("short");
  });
});

describe("regimeAdaptiveSignal — neutral / no fire", () => {
  it("choppy but final bar inside the band → null (reversal does not fire)", () => {
    // Gentle oscillation, last bar near the mean → no oversold/overbought.
    const closes = Array.from({ length: LB + 1 }, (_, i) => 100 + (i % 2 === 0 ? -1 : 1));
    expect(classifyRegime(closes, LB)).toBe("choppy");
    const sig = regimeAdaptiveSignal(closes, { lookback: LB, reversal: { zThreshold: 1.5 } });
    expect(sig).toBeNull();
  });

  it("trending but latest close is NOT a fresh breakout → null", () => {
    // Rising window, but the final close pulls back below the prior high → no break.
    const closes = Array.from({ length: LB }, (_, i) => 100 + i * 0.5);
    closes.push(100 + (LB - 2) * 0.5 - 1); // below the prior high
    expect(classifyRegime(closes, LB)).toBe("trending");
    const sig = regimeAdaptiveSignal(closes, { lookback: LB });
    expect(sig).toBeNull();
  });

  it("insufficient history → null", () => {
    expect(regimeAdaptiveSignal([100, 101, 102], { lookback: LB })).toBeNull();
  });
});

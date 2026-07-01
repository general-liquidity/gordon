import { describe, expect, it } from "bun:test";
import {
  computeExposureCeiling,
  formatExposureCoach,
} from "./exposure-coach.ts";

describe("computeExposureCeiling", () => {
  it("gives a strong uptrend with positive breadth a high ceiling and allows entries", () => {
    const r = computeExposureCeiling({
      regime: "trending_up",
      breadth: 0.6,
      participation: 1.3,
    });
    expect(r.baseCeiling).toBe(100);
    // base 100 + breadth (0.6*30=18) + participation (+1*0.3*20=6) clamped at 100.
    expect(r.netExposureCeiling).toBe(100);
    expect(r.entriesAllowed).toBe(true);
    expect(r.posture).toBe("aggressive");
  });

  it("forces cash-priority in a downtrend with negative breadth", () => {
    const r = computeExposureCeiling({
      regime: "trending_down",
      breadth: -0.7,
      participation: 1.5,
    });
    expect(r.entriesAllowed).toBe(false);
    expect(r.posture).toBe("cash_priority");
    // base 10, breadth -21, participation risk-off (-1 * +0.5 * 20 = -10) -> clamped to 0.
    expect(r.netExposureCeiling).toBe(0);
    expect(r.summary).toContain("Cash-priority");
  });

  it("treats elevated participation as confirmation in a breakout", () => {
    const strong = computeExposureCeiling({
      regime: "breakout",
      breadth: 0.2,
      participation: 1.5,
    });
    const weak = computeExposureCeiling({
      regime: "breakout",
      breadth: 0.2,
      participation: 0.6,
    });
    // Higher participation -> higher ceiling in a risk-on regime.
    expect(strong.netExposureCeiling).toBeGreaterThan(weak.netExposureCeiling);
  });

  it("treats elevated participation as distribution in a volatile regime", () => {
    const heavy = computeExposureCeiling({
      regime: "volatile",
      breadth: 0,
      participation: 1.8,
    });
    const calm = computeExposureCeiling({
      regime: "volatile",
      breadth: 0,
      participation: 1.0,
    });
    // Risk-off regime: MORE volume -> LOWER ceiling.
    expect(heavy.netExposureCeiling).toBeLessThan(calm.netExposureCeiling);
  });

  it("leaves neutral regimes unaffected by participation", () => {
    const a = computeExposureCeiling({
      regime: "ranging",
      breadth: 0,
      participation: 0.5,
    });
    const b = computeExposureCeiling({
      regime: "ranging",
      breadth: 0,
      participation: 2.0,
    });
    expect(a.participationAdjustment).toBe(0);
    expect(b.participationAdjustment).toBe(0);
    expect(a.netExposureCeiling).toBe(b.netExposureCeiling);
    expect(a.netExposureCeiling).toBe(50);
  });

  it("clamps breadth to [-1, 1]", () => {
    const over = computeExposureCeiling({ regime: "ranging", breadth: 5 });
    const one = computeExposureCeiling({ regime: "ranging", breadth: 1 });
    expect(over.breadthAdjustment).toBe(one.breadthAdjustment);
  });

  it("puts the book on cash-priority when the ceiling drops to/below the floor", () => {
    const r = computeExposureCeiling({
      regime: "volatile",
      breadth: -0.5,
      participation: 1.0,
    });
    // base 25, breadth -15 = 10 -> below default floor 20.
    expect(r.netExposureCeiling).toBe(10);
    expect(r.entriesAllowed).toBe(false);
    expect(r.posture).toBe("cash_priority");
  });

  it("honors a custom entriesFloor", () => {
    const base = computeExposureCeiling({ regime: "quiet", breadth: 0 });
    expect(base.netExposureCeiling).toBe(40);
    expect(base.entriesAllowed).toBe(true);
    const strict = computeExposureCeiling(
      { regime: "quiet", breadth: 0 },
      { entriesFloor: 50 },
    );
    expect(strict.entriesAllowed).toBe(false);
  });

  it("honors a custom maxCeiling clamp", () => {
    const r = computeExposureCeiling(
      { regime: "trending_up", breadth: 1, participation: 2 },
      { maxCeiling: 60 },
    );
    expect(r.netExposureCeiling).toBe(60);
  });

  it("defaults participation to 1 (no adjustment) when omitted", () => {
    const r = computeExposureCeiling({ regime: "breakout", breadth: 0 });
    expect(r.participationAdjustment).toBe(0);
    expect(r.netExposureCeiling).toBe(80);
  });

  it("maps ceiling bands to postures", () => {
    expect(computeExposureCeiling({ regime: "trending_up", breadth: 0 }).posture).toBe(
      "aggressive",
    );
    expect(computeExposureCeiling({ regime: "ranging", breadth: 0.2 }).posture).toBe(
      "constructive",
    );
    expect(computeExposureCeiling({ regime: "quiet", breadth: 0 }).posture).toBe(
      "neutral",
    );
    // base 40 - breadth 15 = 25 -> defensive (above floor 20, below 35).
    expect(computeExposureCeiling({ regime: "quiet", breadth: -0.5 }).posture).toBe(
      "defensive",
    );
  });

  it("formats a readable report", () => {
    const r = computeExposureCeiling({
      regime: "trending_up",
      breadth: 0.5,
      participation: 1.2,
    });
    const text = formatExposureCoach(r);
    expect(text).toContain("Exposure Coach");
    expect(text).toContain("Net-long ceiling");
  });
});

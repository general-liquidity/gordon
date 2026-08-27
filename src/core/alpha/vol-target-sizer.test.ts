import { describe, expect, test } from "bun:test";
import { sizeWithVolTarget, formatVolTargetSizer } from "./vol-target-sizer.ts";

describe("sizeWithVolTarget", () => {
  test("zero or negative target vol → insufficient_data", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0,
      currentAnnualVol: 0.2,
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("zero current vol → insufficient_data", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 0,
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("target = current → multiplier 1, no rebalance", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 0.1,
      currentNotionalFraction: 1.0,
    });
    expect(r.rawMultiplier).toBeCloseTo(1.0, 4);
    expect(r.clippedMultiplier).toBeCloseTo(1.0, 4);
    expect(r.verdict).toBe("within_band_no_rebalance");
  });

  test("current vol 2× target → de-risk to 50%, rebalance", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 0.2,
      currentNotionalFraction: 1.0,
    });
    expect(r.rawMultiplier).toBeCloseTo(0.5, 4);
    expect(r.clippedMultiplier).toBeCloseTo(0.5, 4);
    expect(r.targetNotionalFraction).toBeCloseTo(0.5, 4);
    expect(r.verdict).toBe("rebalance_recommended");
  });

  test("current vol 0.5× target → lever to 2×, hits cap", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 0.05,
      currentNotionalFraction: 1.0,
    });
    expect(r.rawMultiplier).toBeCloseTo(2.0, 4);
    expect(r.cappedAtLimit).toBeNull(); // exactly at cap, not over
    expect(r.targetNotionalFraction).toBeCloseTo(2.0, 4);
  });

  test("current vol 0.25× target → would want 4×, clipped to 2× cap", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 0.025,
      currentNotionalFraction: 1.0,
    });
    expect(r.rawMultiplier).toBeCloseTo(4.0, 4);
    expect(r.clippedMultiplier).toBeCloseTo(2.0, 4);
    expect(r.cappedAtLimit).toBe("cap");
    expect(r.verdict).toBe("at_leverage_cap");
    expect(r.expectedAnnualVol).toBeCloseTo(0.05, 4); // 2× × 0.025
  });

  test("current vol 10× target → floor binds at 0.20×", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 1.0,
      currentNotionalFraction: 1.0,
    });
    expect(r.rawMultiplier).toBeCloseTo(0.1, 4);
    expect(r.clippedMultiplier).toBeCloseTo(0.2, 4); // floor
    expect(r.cappedAtLimit).toBe("floor");
    expect(r.verdict).toBe("at_leverage_floor");
  });

  test("floor of 0 allows full exit", () => {
    const r = sizeWithVolTarget(
      {
        targetAnnualVol: 0.1,
        currentAnnualVol: 1.0,
        currentNotionalFraction: 1.0,
      },
      { leverageFloor: 0 },
    );
    expect(r.clippedMultiplier).toBeCloseTo(0.1, 4);
    expect(r.targetNotionalFraction).toBeCloseTo(0.1, 4);
    // 90% drift, well above 10% band
    expect(r.verdict).toBe("rebalance_recommended");
  });

  test("no-trade band prevents small-drift rebalance", () => {
    // Target/current ratio of 1.05 → 5% drift, below default 10% band
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.105,
      currentAnnualVol: 0.1,
      currentNotionalFraction: 1.0,
    });
    expect(r.driftFraction).toBeCloseTo(0.05, 2);
    expect(r.shouldRebalance).toBe(false);
    expect(r.verdict).toBe("within_band_no_rebalance");
  });

  test("custom no-trade band tightens or loosens hold zone", () => {
    // target/current = 1.07 → 7% drift; default 10% band holds, 4% band trips.
    const input = {
      targetAnnualVol: 0.107,
      currentAnnualVol: 0.1,
      currentNotionalFraction: 1.0,
    };
    const lax = sizeWithVolTarget(input);
    const strict = sizeWithVolTarget(input, { noTradeBandPct: 0.04 });
    expect(lax.verdict).toBe("within_band_no_rebalance");
    expect(strict.verdict).toBe("rebalance_recommended");
  });

  test("expected vol equals target when not clipped", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.08,
      currentAnnualVol: 0.16,
      currentNotionalFraction: 1.0,
    });
    expect(r.expectedAnnualVol).toBeCloseTo(0.08, 4);
  });

  test("expected vol < target when capped", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 0.02,
      currentNotionalFraction: 1.0,
    });
    expect(r.cappedAtLimit).toBe("cap");
    expect(r.expectedAnnualVol).toBeLessThan(0.1);
  });

  test("starting from notional 0.5: applies multiplier on top", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 0.1,
      currentNotionalFraction: 0.5,
    });
    expect(r.clippedMultiplier).toBeCloseTo(1.0, 4);
    expect(r.targetNotionalFraction).toBeCloseTo(0.5, 4);
    expect(r.shouldRebalance).toBe(false);
  });

  test("invalid floor > cap → insufficient_data", () => {
    const r = sizeWithVolTarget(
      {
        targetAnnualVol: 0.1,
        currentAnnualVol: 0.1,
      },
      { leverageFloor: 3, leverageCap: 2 },
    );
    expect(r.verdict).toBe("insufficient_data");
  });

  test("custom cap overrides default", () => {
    const r = sizeWithVolTarget(
      {
        targetAnnualVol: 0.1,
        currentAnnualVol: 0.02,
        currentNotionalFraction: 1.0,
      },
      { leverageCap: 4 },
    );
    expect(r.clippedMultiplier).toBeCloseTo(4.0, 4);
    expect(r.cappedAtLimit).toBe("cap");
  });
});

describe("formatVolTargetSizer", () => {
  test("renders verdict + diagnostic table", () => {
    const r = sizeWithVolTarget({
      targetAnnualVol: 0.1,
      currentAnnualVol: 0.2,
      currentNotionalFraction: 1.0,
    });
    const text = formatVolTargetSizer(r);
    expect(text).toContain("Vol-Target Sizer");
    expect(text).toContain("Raw multiplier");
    expect(text).toContain("Target notional");
    expect(text).toContain("Drift");
  });
});

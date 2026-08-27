import { describe, it, expect } from "bun:test";
import { computeDealerGreeksExposure, type OptionContract } from "./dealerGreeksExposure.ts";

// NOTE on the model: at a single strike γ_call = γ_put (and vanna_call =
// vanna_put), so a perfectly balanced chain under the long-call/short-put
// convention nets to synthetic forwards — zero second-order exposure. The
// signal comes from call/put OI IMBALANCE, which is what these chains exercise.
describe("computeDealerGreeksExposure", () => {
  const spot = 100;
  const params = { spot, rate: 0.03, dividendYield: 0 };

  // Call-heavy book across strikes (more call OI than put OI at each strike).
  const callHeavy: OptionContract[] = [90, 95, 100, 105, 110].flatMap((strike) => [
    { strike, timeYears: 0.08, openInterest: 2000, optionType: "call" as const, iv: 0.3 },
    { strike, timeYears: 0.08, openInterest: 1000, optionType: "put" as const, iv: 0.3 },
  ]);

  it("produces a finite exposure profile of the requested length", () => {
    const r = computeDealerGreeksExposure(callHeavy, { ...params, gridLevels: 21 });
    expect(r.profile).toHaveLength(21);
    for (const p of r.profile) {
      expect(Number.isFinite(p.gammaExposure)).toBe(true);
      expect(Number.isFinite(p.vannaExposure)).toBe(true);
      expect(Number.isFinite(p.charmExposure)).toBe(true);
    }
  });

  it("a call-heavy book is long gamma under the default convention", () => {
    const r = computeDealerGreeksExposure(callHeavy, params);
    expect(r.atSpot.gammaExposure).toBeGreaterThan(0);
  });

  it("flipping the dealer-position assumption flips the gamma sign", () => {
    const longBook = computeDealerGreeksExposure(callHeavy, params);
    const shortBook = computeDealerGreeksExposure(callHeavy, {
      ...params,
      callSign: -1,
      putSign: 1,
    });
    expect(Math.sign(shortBook.atSpot.gammaExposure)).toBe(
      -Math.sign(longBook.atSpot.gammaExposure),
    );
  });

  it("finds a gamma flip when puts cluster low and calls cluster high", () => {
    // Short-gamma pocket near 90 (heavy put OI), long-gamma near 110 (heavy call
    // OI) → the net-gamma profile must cross zero somewhere in between.
    const skewed: OptionContract[] = [
      { strike: 90, timeYears: 0.08, openInterest: 5000, optionType: "put", iv: 0.35 },
      { strike: 90, timeYears: 0.08, openInterest: 500, optionType: "call", iv: 0.35 },
      { strike: 110, timeYears: 0.08, openInterest: 5000, optionType: "call", iv: 0.3 },
      { strike: 110, timeYears: 0.08, openInterest: 500, optionType: "put", iv: 0.3 },
    ];
    const r = computeDealerGreeksExposure(skewed, { ...params, gridHalfWidthPct: 0.25 });
    expect(r.profile[0]!.gammaExposure).toBeLessThan(0);
    expect(r.profile[r.profile.length - 1]!.gammaExposure).toBeGreaterThan(0);
    expect(r.gammaFlipPrice).not.toBeNull();
    expect(r.gammaFlipPrice!).toBeGreaterThan(spot * 0.75);
    expect(r.gammaFlipPrice!).toBeLessThan(spot * 1.25);
    expect(r.interpretation).toContain("gamma flip");
  });

  it("skips expired / zero-OI / zero-IV contracts without throwing", () => {
    const dirty: OptionContract[] = [
      { strike: 100, timeYears: 0, openInterest: 1000, optionType: "call", iv: 0.3 },
      { strike: 100, timeYears: 0.08, openInterest: 0, optionType: "put", iv: 0.3 },
      { strike: 100, timeYears: 0.08, openInterest: 1000, optionType: "call", iv: 0 },
      { strike: 105, timeYears: 0.08, openInterest: 1500, optionType: "call", iv: 0.3 },
    ];
    const r = computeDealerGreeksExposure(dirty, params);
    expect(Number.isFinite(r.atSpot.gammaExposure)).toBe(true);
  });

  it("throws on a non-positive spot", () => {
    expect(() => computeDealerGreeksExposure(callHeavy, { ...params, spot: 0 })).toThrow();
  });
});

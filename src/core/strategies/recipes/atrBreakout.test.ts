import { describe, it, expect } from "bun:test";
import { evaluateAtrBreakout, DEFAULT_ATR_BREAKOUT_SETTINGS } from "./atrBreakout.ts";

describe("evaluateAtrBreakout — invalid input", () => {
  it("returns invalid_input when atrLong <= 0", () => {
    const result = evaluateAtrBreakout({ barOpen: 100, atrShort: 1, atrLong: 0 });
    expect(result.verdict).toBe("invalid_input");
    expect(result.levels).toBeNull();
  });

  it("returns invalid_input when atrShort is negative", () => {
    const result = evaluateAtrBreakout({ barOpen: 100, atrShort: -1, atrLong: 1 });
    expect(result.verdict).toBe("invalid_input");
  });

  it("returns invalid_input when barOpen is non-finite", () => {
    const result = evaluateAtrBreakout({ barOpen: NaN, atrShort: 1, atrLong: 1 });
    expect(result.verdict).toBe("invalid_input");
  });
});

describe("evaluateAtrBreakout — expansion filter", () => {
  it("filters when atrShort = atrLong (no expansion)", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.0,
      atrLong: 1.0,
    });
    expect(result.verdict).toBe("filtered_no_expansion");
    expect(result.levels).toBeNull();
  });

  it("filters when atrShort < atrLong", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 0.5,
      atrLong: 1.0,
    });
    expect(result.verdict).toBe("filtered_no_expansion");
  });

  it("arms when atrShort > atrLong", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
    });
    expect(result.verdict).toBe("armed");
    expect(result.levels).not.toBeNull();
  });

  it("respects custom expansionRatio threshold", () => {
    // ratio = 1.1, threshold = 1.2 → filtered
    const filtered = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.1,
      atrLong: 1.0,
      settings: { expansionRatio: 1.2 },
    });
    expect(filtered.verdict).toBe("filtered_no_expansion");

    // ratio = 1.3, threshold = 1.2 → armed
    const armed = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.3,
      atrLong: 1.0,
      settings: { expansionRatio: 1.2 },
    });
    expect(armed.verdict).toBe("armed");
  });
});

describe("evaluateAtrBreakout — low-vol filter", () => {
  it("filters when atrLong < minAtrLong", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 0.05,
      atrLong: 0.02,
      settings: { minAtrLong: 0.5 },
    });
    expect(result.verdict).toBe("filtered_low_vol");
  });

  it("does not filter when atrLong >= minAtrLong", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
      settings: { minAtrLong: 0.5 },
    });
    expect(result.verdict).toBe("armed");
  });
});

describe("evaluateAtrBreakout — entry / exit levels (the post's recipe)", () => {
  it("computes long + short entry stops at ±(entryMultiplier × ATR_long) from open", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
      settings: { entryMultiplier: 2.5, exitMultiplier: 1.0, expansionRatio: 1.0, minAtrLong: 0 },
    });
    expect(result.levels!.longEntryStop).toBe(102.5);
    expect(result.levels!.shortEntryStop).toBe(97.5);
  });

  it("exitStopDistance = exitMultiplier × ATR_long (smaller than entry)", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
      settings: { entryMultiplier: 2.5, exitMultiplier: 1.0, expansionRatio: 1.0, minAtrLong: 0 },
    });
    expect(result.levels!.exitStopDistance).toBe(1.0);
    expect(result.levels!.exitStopDistance).toBeLessThan(2.5);
  });

  it("computes implied stops if entry fills at exactly the entry stop", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
      settings: { entryMultiplier: 2.5, exitMultiplier: 1.0, expansionRatio: 1.0, minAtrLong: 0 },
    });
    // Long fills at 102.5, stop at 102.5 - 1.0 = 101.5
    expect(result.levels!.longImpliedStopLoss).toBe(101.5);
    // Short fills at 97.5, stop at 97.5 + 1.0 = 98.5
    expect(result.levels!.shortImpliedStopLoss).toBe(98.5);
  });

  it("scales correctly with ATR magnitude", () => {
    // 30-min ES bar at 4500 with ATR(20) = 12, ATR(5) = 18 (vol expanding)
    const result = evaluateAtrBreakout({
      barOpen: 4500,
      atrShort: 18,
      atrLong: 12,
      settings: { entryMultiplier: 2.5, exitMultiplier: 1.0, expansionRatio: 1.0, minAtrLong: 0 },
    });
    expect(result.levels!.longEntryStop).toBe(4530); // 4500 + 2.5*12
    expect(result.levels!.shortEntryStop).toBe(4470); // 4500 - 2.5*12
    expect(result.levels!.exitStopDistance).toBe(12);
  });
});

describe("evaluateAtrBreakout — direction permissions", () => {
  it("respects allowLong=false", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
      allowLong: false,
    });
    expect(result.verdict).toBe("armed");
    expect(result.longActive).toBe(false);
    expect(result.shortActive).toBe(true);
  });

  it("respects allowShort=false", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
      allowShort: false,
    });
    expect(result.verdict).toBe("armed");
    expect(result.longActive).toBe(true);
    expect(result.shortActive).toBe(false);
  });

  it("both directions default to true", () => {
    const result = evaluateAtrBreakout({ barOpen: 100, atrShort: 1.5, atrLong: 1.0 });
    expect(result.longActive).toBe(true);
    expect(result.shortActive).toBe(true);
  });
});

describe("evaluateAtrBreakout — defaults + diagnostics", () => {
  it("uses DEFAULT_ATR_BREAKOUT_SETTINGS when settings omitted", () => {
    const result = evaluateAtrBreakout({ barOpen: 100, atrShort: 1.5, atrLong: 1.0 });
    expect(result.effectiveSettings).toEqual(DEFAULT_ATR_BREAKOUT_SETTINGS);
  });

  it("merges partial settings with defaults", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
      settings: { entryMultiplier: 3.0 },
    });
    expect(result.effectiveSettings.entryMultiplier).toBe(3.0);
    expect(result.effectiveSettings.exitMultiplier).toBe(
      DEFAULT_ATR_BREAKOUT_SETTINGS.exitMultiplier,
    );
  });

  it("reports the expansion ratio in the result", () => {
    const result = evaluateAtrBreakout({
      barOpen: 100,
      atrShort: 1.5,
      atrLong: 1.0,
    });
    expect(result.expansionRatio).toBe(1.5);
  });

  it("includes operator-readable reason text", () => {
    const armed = evaluateAtrBreakout({ barOpen: 100, atrShort: 1.5, atrLong: 1.0 });
    expect(armed.reason).toContain("armed");

    const filtered = evaluateAtrBreakout({ barOpen: 100, atrShort: 1.0, atrLong: 1.0 });
    expect(filtered.reason).toContain("not above");
  });
});

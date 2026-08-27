import { describe, expect, it } from "bun:test";
import {
  evaluateDeleveragingVeto,
  formatDeleveragingVeto,
  type OversoldAsset,
} from "./deleveraging-veto.ts";

// Helper: build an asset that flips oversold this cycle.
const flip = (symbol: string, osc = 25): OversoldAsset => ({
  symbol,
  oscillator: osc,
  priorOscillator: 55,
});

// Helper: a healthy (momentum) name.
const strong = (symbol: string, osc = 62): OversoldAsset => ({
  symbol,
  oscillator: osc,
  priorOscillator: 58,
});

describe("evaluateDeleveragingVeto", () => {
  it("returns insufficient_data below minUniverse", () => {
    const r = evaluateDeleveragingVeto([flip("A"), flip("B")], { minUniverse: 5 });
    expect(r.verdict).toBe("insufficient_data");
    expect(r.vetoTriggered).toBe(false);
    expect(r.assets).toHaveLength(0);
  });

  it("triggers the veto when >=60% of the universe flips oversold", () => {
    // 6 names, 4 flip oversold (66%) -> above 60% and above min 3.
    const assets = [flip("A"), flip("B"), flip("C"), flip("D"), strong("E"), strong("F")];
    const r = evaluateDeleveragingVeto(assets);
    expect(r.verdict).toBe("veto");
    expect(r.vetoTriggered).toBe(true);
    expect(r.flippedCount).toBe(4);
    expect(r.flipFraction).toBeCloseTo(0.6667, 3);
    expect(r.vetoedSymbols.sort()).toEqual(["A", "B", "C", "D"]);
    // Momentum names untouched.
    expect(r.assets.find((a) => a.symbol === "E")?.status).toBe("not_oversold");
    expect(r.dipSymbols).toHaveLength(0);
  });

  it("does NOT veto when the flush is idiosyncratic (below fraction)", () => {
    // 6 names, only 2 flip oversold (33%) -> no veto, treat as dips.
    const assets = [flip("A"), flip("B"), strong("C"), strong("D"), strong("E"), strong("F")];
    const r = evaluateDeleveragingVeto(assets);
    expect(r.verdict).toBe("no_veto");
    expect(r.vetoTriggered).toBe(false);
    expect(r.vetoedSymbols).toHaveLength(0);
    expect(r.dipSymbols.sort()).toEqual(["A", "B"]);
    expect(r.assets.find((a) => a.symbol === "A")?.status).toBe("oversold_dip");
  });

  it("respects minOversold even when fraction clears (tiny complex)", () => {
    // 5 names, 3 flip = 60% fraction but exactly meets min 3 -> veto.
    const assets = [flip("A"), flip("B"), flip("C"), strong("D"), strong("E")];
    const meets = evaluateDeleveragingVeto(assets);
    expect(meets.vetoTriggered).toBe(true);

    // Raise minOversold to 4: same set no longer triggers.
    const raised = evaluateDeleveragingVeto(assets, { minOversold: 4 });
    expect(raised.vetoTriggered).toBe(false);
    expect(raised.verdict).toBe("no_veto");
  });

  it("counts fresh flips only, but vetoes the whole oversold set", () => {
    // C is already oversold both cycles (standing weakness, not a flip).
    const assets: OversoldAsset[] = [
      flip("A"),
      flip("B"),
      flip("C"),
      { symbol: "D", oscillator: 20, priorOscillator: 22 }, // already oversold
      strong("E"),
    ];
    const r = evaluateDeleveragingVeto(assets);
    // 3 fresh flips of 5 = 60% -> veto fires.
    expect(r.flippedCount).toBe(3);
    expect(r.oversoldCount).toBe(4);
    expect(r.vetoTriggered).toBe(true);
    // Standing-weak D is vetoed too (part of the oversold set).
    expect(r.vetoedSymbols.sort()).toEqual(["A", "B", "C", "D"]);
    expect(r.assets.find((a) => a.symbol === "D")?.flippedThisCycle).toBe(false);
  });

  it("ignores assets with no prior reading for the flip trigger", () => {
    // 5 names oversold now but no prior -> 0 flips -> no trigger.
    const assets: OversoldAsset[] = ["A", "B", "C", "D", "E"].map((s) => ({
      symbol: s,
      oscillator: 25,
    }));
    const r = evaluateDeleveragingVeto(assets);
    expect(r.flippedCount).toBe(0);
    expect(r.oversoldCount).toBe(5);
    expect(r.vetoTriggered).toBe(false);
  });

  it("honors a custom oversoldThreshold + vetoFraction", () => {
    // Threshold 40, all 5 flip below 40, fraction 1.0 >= custom 0.8.
    const assets: OversoldAsset[] = ["A", "B", "C", "D", "E"].map((s) => ({
      symbol: s,
      oscillator: 35,
      priorOscillator: 50,
    }));
    const r = evaluateDeleveragingVeto(assets, {
      oversoldThreshold: 40,
      vetoFraction: 0.8,
    });
    expect(r.vetoTriggered).toBe(true);
    expect(r.vetoedSymbols).toHaveLength(5);
  });

  it("drops non-finite oscillator readings from the valid universe", () => {
    const assets: OversoldAsset[] = [
      flip("A"),
      flip("B"),
      flip("C"),
      { symbol: "BAD", oscillator: NaN, priorOscillator: 50 },
      strong("E"),
    ];
    const r = evaluateDeleveragingVeto(assets, { minUniverse: 4 });
    expect(r.validSymbols).toBe(4);
    expect(r.flippedCount).toBe(3);
    // 3/4 = 75% -> veto.
    expect(r.vetoTriggered).toBe(true);
  });

  it("formats a readable report", () => {
    const r = evaluateDeleveragingVeto([
      flip("A"),
      flip("B"),
      flip("C"),
      flip("D"),
      strong("E"),
      strong("F"),
    ]);
    const text = formatDeleveragingVeto(r);
    expect(text).toContain("Deleveraging Veto — VETO");
    expect(text).toContain("Vetoed longs");
  });
});

import { describe, it, expect } from "bun:test";
import { enhanceRankedResults, importanceMultiplier, type RankedEntry } from "./enhance.ts";

describe("importanceMultiplier", () => {
  it("is neutral (1.0) for undefined / non-finite importance", () => {
    expect(importanceMultiplier(undefined)).toBe(1);
    expect(importanceMultiplier(Number.NaN)).toBe(1);
  });

  it("maps importance to a [0.5, 1.5] weight centered on the default write value", () => {
    expect(importanceMultiplier(0)).toBeCloseTo(0.5, 6);
    expect(importanceMultiplier(0.5)).toBeCloseTo(1.0, 6);
    expect(importanceMultiplier(1)).toBeCloseTo(1.5, 6);
  });

  it("clamps out-of-range importance", () => {
    expect(importanceMultiplier(2)).toBeCloseTo(1.5, 6);
    expect(importanceMultiplier(-1)).toBeCloseTo(0.5, 6);
  });
});

describe("enhanceRankedResults — importance folding", () => {
  // No decay so we isolate the importance x relevance interaction.
  const noDecay = { decay: { enabled: false, halfLifeDays: 30 } };

  it("lifts a higher-importance entry above a same-relevance rival", () => {
    const results: RankedEntry[] = [
      { id: "low", content: "alpha one", score: 0.5, timestamp: null, importance: 0.2 },
      { id: "high", content: "beta two", score: 0.5, timestamp: null, importance: 0.9 },
    ];
    const out = enhanceRankedResults(results, noDecay);
    expect(out[0]?.id).toBe("high");
  });

  it("is a strict no-op on ordering when importance is absent", () => {
    const results: RankedEntry[] = [
      { id: "a", content: "alpha one", score: 0.9, timestamp: null },
      { id: "b", content: "beta two", score: 0.4, timestamp: null },
    ];
    const out = enhanceRankedResults(results, noDecay);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("can flip ordering when importance outweighs a small relevance gap", () => {
    // b has higher raw relevance, but a's importance advantage wins:
    // a: 0.5 * (0.5 + 1.0) = 0.75 ; b: 0.6 * (0.5 + 0.1) = 0.36
    const results: RankedEntry[] = [
      { id: "a", content: "alpha one", score: 0.5, timestamp: null, importance: 1.0 },
      { id: "b", content: "beta two", score: 0.6, timestamp: null, importance: 0.1 },
    ];
    const out = enhanceRankedResults(results, noDecay);
    expect(out[0]?.id).toBe("a");
  });
});

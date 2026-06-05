import { describe, expect, it } from "bun:test";
import { computeRegimeFilterValue } from "./regime-filter-value.ts";

/** Block-structured labels/returns: each entry is [regime, perBarReturn, count]. */
function build(blocks: Array<[string, number, number]>): {
  returns: number[];
  regimeLabels: string[];
} {
  const returns: number[] = [];
  const regimeLabels: string[] = [];
  for (const [regime, ret, count] of blocks) {
    for (let i = 0; i < count; i++) {
      returns.push(ret);
      regimeLabels.push(regime);
    }
  }
  return { returns, regimeLabels };
}

describe("computeRegimeFilterValue", () => {
  it("returns neutral on insufficient bars", () => {
    const r = computeRegimeFilterValue({ returns: [0.01, -0.01], regimeLabels: ["a", "b"] });
    expect(r.verdict).toBe("insufficient_data");
    expect(r.interpretation).toContain("Neutral");
  });

  it("returns neutral with a single regime", () => {
    const { returns, regimeLabels } = build([["bull", 0.01, 30]]);
    const r = computeRegimeFilterValue({ returns, regimeLabels });
    expect(r.verdict).toBe("insufficient_data");
    expect(r.interpretation).toContain("2 distinct regimes");
  });

  it("attributes per-regime expectancy and derives the hostile regime", () => {
    const { returns, regimeLabels } = build([
      ["bull", 0.01, 20],
      ["bear", -0.01, 20],
      ["bull", 0.01, 20],
    ]);
    const r = computeRegimeFilterValue({ returns, regimeLabels });
    const bear = r.perRegime.find((p) => p.regime === "bear")!;
    const bull = r.perRegime.find((p) => p.regime === "bull")!;
    expect(bear.meanReturn).toBeCloseTo(-0.01, 6);
    expect(bull.meanReturn).toBeCloseTo(0.01, 6);
    expect(bear.hostile).toBe(true);
    expect(bull.hostile).toBe(false);
    expect(r.hostileRegimes).toContain("bear");
  });

  it("verdict=build_filter when losses concentrate and the edge survives a realistic lag", () => {
    const { returns, regimeLabels } = build([
      ["bull", 0.01, 20],
      ["bear", -0.01, 20],
      ["bull", 0.01, 20],
    ]);
    const r = computeRegimeFilterValue({ returns, regimeLabels, options: { detectionLagBars: 2, flipFraction: 0.15 } });
    expect(r.cleanFilterValue).toBeGreaterThan(0);
    expect(r.filterValue).toBeGreaterThan(0);
    expect(r.verdict).toBe("build_filter");
    expect(r.edgeRetention).not.toBeNull();
  });

  it("verdict=complexity_tax when fast regime flips + lag eat the edge", () => {
    // 2-bar alternating blocks; a 2-bar detection lag shifts the filter a full
    // block, so it goes flat during bull and in-market during bear.
    const blocks: Array<[string, number, number]> = [];
    for (let k = 0; k < 15; k++) {
      blocks.push(["bull", 0.01, 2]);
      blocks.push(["bear", -0.01, 2]);
    }
    const { returns, regimeLabels } = build(blocks);
    const r = computeRegimeFilterValue({ returns, regimeLabels, options: { detectionLagBars: 2, flipFraction: 0.3 } });
    expect(r.cleanFilterValue).toBeGreaterThan(0); // a perfect filter WOULD help
    expect(r.filterValue).toBeLessThanOrEqual(0); // but the realistic one doesn't
    expect(r.verdict).toBe("complexity_tax");
  });

  it("verdict=regime_insensitive when expectancy is flat across regimes", () => {
    const { returns, regimeLabels } = build([
      ["a", 0.001, 20],
      ["b", 0.001, 20],
      ["a", 0.001, 20],
    ]);
    const r = computeRegimeFilterValue({ returns, regimeLabels });
    expect(r.regimeSensitivity).toBeCloseTo(0, 6);
    expect(r.verdict).toBe("regime_insensitive");
    expect(r.hostileRegimes.length).toBe(0);
  });

  it("honors explicit hostileRegimes override", () => {
    const { returns, regimeLabels } = build([
      ["calm", 0.01, 20],
      ["storm", 0.005, 20], // positive mean, but operator declares it hostile
      ["calm", 0.01, 20],
    ]);
    const r = computeRegimeFilterValue({
      returns,
      regimeLabels,
      options: { hostileRegimes: ["storm"], detectionLagBars: 0, flipFraction: 0 },
    });
    expect(r.hostileRegimes).toEqual(["storm"]);
    // Filtering a positive-expectancy regime with a perfect filter REMOVES positive return.
    expect(r.cleanFilterValue).toBeLessThan(0);
  });
});

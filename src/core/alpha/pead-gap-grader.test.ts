import { describe, expect, it } from "bun:test";
import { gradePeadGapUp, formatPeadGapGrade, type PeadGapInput } from "./pead-gap-grader.ts";

const STRONG: PeadGapInput = {
  gapPercent: 12,
  preEarningsTrendPercent: 25,
  volumeRatio: 4,
  maPositionPercent: 12,
};

const WEAK: PeadGapInput = {
  gapPercent: 0,
  preEarningsTrendPercent: -10,
  volumeRatio: 0.8,
  maPositionPercent: -5,
};

describe("gradePeadGapUp", () => {
  it("grades a strong setup A with a near-max composite", () => {
    const r = gradePeadGapUp(STRONG);
    expect(r.grade).toBe("A");
    expect(r.composite).toBeGreaterThanOrEqual(0.75);
    expect(r.composite).toBeLessThanOrEqual(1);
  });

  it("grades an all-weak setup D at composite 0", () => {
    const r = gradePeadGapUp(WEAK);
    expect(r.grade).toBe("D");
    expect(r.composite).toBe(0);
  });

  it("normalizes weights to sum 1", () => {
    const r = gradePeadGapUp(STRONG);
    const totalWeight = r.components.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 5);
  });

  it("clamps each sub-score into 0..1", () => {
    const r = gradePeadGapUp(STRONG);
    for (const c of r.components) {
      expect(c.subScore).toBeGreaterThanOrEqual(0);
      expect(c.subScore).toBeLessThanOrEqual(1);
    }
  });

  it("respects configurable weights — zeroing a component drops its contribution", () => {
    const r = gradePeadGapUp(STRONG, {
      gap: { weight: 0 },
    });
    const gap = r.components.find((c) => c.name === "gap")!;
    expect(gap.weight).toBe(0);
    expect(gap.contribution).toBe(0);
  });

  it("respects configurable ramp bounds", () => {
    // With fullAt lowered to 5, a 12% gap saturates the sub-score to 1.
    const r = gradePeadGapUp(
      { gapPercent: 12, preEarningsTrendPercent: 0, volumeRatio: 1, maPositionPercent: 0 },
      { gap: { fullAt: 5 } },
    );
    const gap = r.components.find((c) => c.name === "gap")!;
    expect(gap.subScore).toBe(1);
  });

  it("supports an inverted ramp (fullAt < zeroAt)", () => {
    // Reward SMALL gaps: score 1 at gap 0, 0 at gap 10.
    const small = gradePeadGapUp(
      { gapPercent: 0, preEarningsTrendPercent: 0, volumeRatio: 1, maPositionPercent: 0 },
      { gap: { zeroAt: 10, fullAt: 0 } },
    );
    const big = gradePeadGapUp(
      { gapPercent: 10, preEarningsTrendPercent: 0, volumeRatio: 1, maPositionPercent: 0 },
      { gap: { zeroAt: 10, fullAt: 0 } },
    );
    const smallGap = small.components.find((c) => c.name === "gap")!;
    const bigGap = big.components.find((c) => c.name === "gap")!;
    expect(smallGap.subScore).toBe(1);
    expect(bigGap.subScore).toBe(0);
  });

  it("respects configurable grade bands", () => {
    const mid: PeadGapInput = {
      gapPercent: 5,
      preEarningsTrendPercent: 10,
      volumeRatio: 2,
      maPositionPercent: 5,
    };
    const base = gradePeadGapUp(mid);
    const strict = gradePeadGapUp(mid, { gradeBands: { a: 0.99, b: 0.9, c: 0.8 } });
    // Same composite, stricter bands can only lower or hold the grade.
    expect(strict.composite).toBeCloseTo(base.composite, 5);
    expect(["C", "D"]).toContain(strict.grade);
  });

  it("treats non-finite inputs as zero sub-score without throwing", () => {
    const r = gradePeadGapUp({
      gapPercent: Number.NaN,
      preEarningsTrendPercent: Number.POSITIVE_INFINITY,
      volumeRatio: 1,
      maPositionPercent: 0,
    });
    for (const c of r.components) {
      expect(Number.isFinite(c.subScore)).toBe(true);
    }
    expect(r.grade).toBe("D");
  });

  it("orders grade bands monotonically A >= B >= C across composites", () => {
    const grades = [WEAK, STRONG].map((i) => gradePeadGapUp(i));
    expect(grades[0]!.composite).toBeLessThanOrEqual(grades[1]!.composite);
  });

  it("formats a human-readable block", () => {
    const out = formatPeadGapGrade(gradePeadGapUp(STRONG));
    expect(out).toContain("PEAD Gap-Up Grade");
    expect(out).toContain("Summary:");
  });
});

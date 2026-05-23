import { describe, expect, test } from "bun:test";
import { computeMarginOfError, formatMarginOfError } from "./margin-of-error.ts";

describe("computeMarginOfError", () => {
  test("fully in-sync (long+trending+breakout long) → B grade, aggressive", () => {
    const r = computeMarginOfError({
      directionalBias: "long_favoring",
      structuralBias: "trending",
      strategyDirection: "long",
      strategyType: "breakout",
    });
    expect(r.directionalInSync).toBe(true);
    expect(r.structuralInSync).toBe(true);
    expect(r.rawScore).toBe(2);
    expect(r.grade).toBe("B");
    expect(r.recommendation).toBe("take_aggressively");
    expect(r.suggestedRiskMultiplier).toBe(2.0);
  });

  test("fully out-of-sync (long+ranging+breakout short) → C grade, skip", () => {
    const r = computeMarginOfError({
      directionalBias: "long_favoring",
      structuralBias: "ranging",
      strategyDirection: "short",
      strategyType: "breakout",
    });
    expect(r.directionalInSync).toBe(false);
    expect(r.structuralInSync).toBe(false);
    expect(r.rawScore).toBe(-2);
    expect(r.grade).toBe("C");
    expect(r.recommendation).toBe("skip");
    expect(r.suggestedRiskMultiplier).toBe(0);
  });

  test("half in-sync (long+trending+mean_reversion long) → A normal", () => {
    const r = computeMarginOfError({
      directionalBias: "long_favoring",
      structuralBias: "trending",
      strategyDirection: "long",
      strategyType: "mean_reversion",
    });
    // dir in-sync (+1), struct out-of-sync (-1) → 0
    expect(r.rawScore).toBe(0);
    expect(r.grade).toBe("A");
    expect(r.suggestedRiskMultiplier).toBe(0.75);
  });

  test("ranging + mean-reversion long, no directional bias → +1 A normal", () => {
    const r = computeMarginOfError({
      directionalBias: "none",
      structuralBias: "ranging",
      strategyDirection: "long",
      strategyType: "mean_reversion",
    });
    expect(r.rawScore).toBe(1);
    expect(r.grade).toBe("A");
    expect(r.recommendation).toBe("take_normally");
  });

  test("dir in-sync + struct neutral → +1 A", () => {
    const r = computeMarginOfError({
      directionalBias: "long_favoring",
      structuralBias: "none",
      strategyDirection: "long",
      strategyType: "breakout",
    });
    expect(r.rawScore).toBe(1);
    expect(r.grade).toBe("A");
  });

  test("no bias at all → 0 score → A take-only-high-quality", () => {
    const r = computeMarginOfError({
      directionalBias: "none",
      structuralBias: "none",
      strategyDirection: "long",
      strategyType: "breakout",
    });
    expect(r.rawScore).toBe(0);
    expect(r.recommendation).toBe("take_only_high_quality");
  });

  test("dir in-sync but struct out-of-sync (long+ranging+breakout long) → 0", () => {
    const r = computeMarginOfError({
      directionalBias: "long_favoring",
      structuralBias: "ranging",
      strategyDirection: "long",
      strategyType: "breakout",
    });
    expect(r.rawScore).toBe(0);
  });

  test("dir out-of-sync only (-1) → A+ defensive", () => {
    const r = computeMarginOfError({
      directionalBias: "short_favoring",
      structuralBias: "none",
      strategyDirection: "long",
      strategyType: "breakout",
    });
    expect(r.rawScore).toBe(-1);
    expect(r.grade).toBe("A+");
    expect(r.suggestedRiskMultiplier).toBe(0.5);
  });

  test("short breakout in trending market with short bias → fully in-sync", () => {
    const r = computeMarginOfError({
      directionalBias: "short_favoring",
      structuralBias: "trending",
      strategyDirection: "short",
      strategyType: "breakout",
    });
    expect(r.rawScore).toBe(2);
    expect(r.recommendation).toBe("take_aggressively");
  });

  test("mean-reversion short in ranging market with short bias → fully in-sync", () => {
    const r = computeMarginOfError({
      directionalBias: "short_favoring",
      structuralBias: "ranging",
      strategyDirection: "short",
      strategyType: "mean_reversion",
    });
    expect(r.rawScore).toBe(2);
    expect(r.grade).toBe("B");
  });
});

describe("formatMarginOfError", () => {
  test("renders grade and multiplier", () => {
    const r = computeMarginOfError({
      directionalBias: "long_favoring",
      structuralBias: "trending",
      strategyDirection: "long",
      strategyType: "breakout",
    });
    const text = formatMarginOfError(r);
    expect(text).toContain("Margin-of-Error");
    expect(text).toContain("2.00×");
  });
});

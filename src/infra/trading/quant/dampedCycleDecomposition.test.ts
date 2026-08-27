import { describe, expect, it } from "bun:test";
import { computeDampedCycleDecomposition } from "./dampedCycleDecomposition.ts";

function series(fn: (n: number) => number, len: number): number[] {
  return Array.from({ length: len }, (_, n) => fn(n));
}

describe("computeDampedCycleDecomposition", () => {
  it("returns neutral on insufficient data", () => {
    const r = computeDampedCycleDecomposition({ values: [1, 2, 3, 4, 5] });
    expect(r.components.length).toBe(0);
    expect(r.interpretation).toContain("Neutral");
  });

  it("returns neutral on a constant series", () => {
    const r = computeDampedCycleDecomposition({ values: series(() => 7, 60) });
    expect(r.interpretation).toContain("constant");
  });

  it("recovers a persistent (undamped) cycle: period and λ≈0", () => {
    // x[n] = cos(2π n / 10): pure standing oscillation, period 10, no decay.
    const x = series((n) => Math.cos((2 * Math.PI * n) / 10), 120);
    const r = computeDampedCycleDecomposition({ values: x, options: { order: 2 } });
    expect(r.dominantPeriodBars).not.toBeNull();
    expect(r.dominantPeriodBars!).toBeCloseTo(10, 1);
    expect(r.dominantDecayPerBar!).toBeCloseTo(0, 2);
    expect(r.varianceExplained).toBeGreaterThan(0.99);
    const dom = r.components[0]!;
    expect(dom.persistence).toBe("persistent");
    expect(dom.halfLifeBars).toBeNull();
  });

  it("recovers a decaying cycle: period, negative λ, and half-life", () => {
    // x[n] = 0.95^n · cos(2π n / 12): period 12, r=0.95 → λ=ln(0.95)≈-0.0513.
    const decay = 0.95;
    const x = series((n) => decay ** n * Math.cos((2 * Math.PI * n) / 12), 120);
    const r = computeDampedCycleDecomposition({ values: x, options: { order: 2 } });
    expect(r.dominantPeriodBars!).toBeCloseTo(12, 1);
    const expectedLambda = Math.log(decay); // ≈ -0.0513
    expect(r.dominantDecayPerBar!).toBeCloseTo(expectedLambda, 2);
    const dom = r.components[0]!;
    expect(dom.persistence).toBe("decaying");
    // half-life = ln2 / -λ ≈ 13.5 bars.
    expect(dom.halfLifeBars!).toBeCloseTo(Math.LN2 / -expectedLambda, 0);
  });

  it("flags a growing (unstable) cycle", () => {
    const grow = 1.02;
    const x = series((n) => grow ** n * Math.cos((2 * Math.PI * n) / 9), 100);
    const r = computeDampedCycleDecomposition({ values: x, options: { order: 2 } });
    expect(r.dominantDecayPerBar!).toBeGreaterThan(0);
    expect(r.components[0]!.persistence).toBe("growing");
    expect(r.dominantPeriodBars!).toBeCloseTo(9, 1);
  });

  it("separates two superimposed cycles and ranks the larger as dominant", () => {
    // period-8 amplitude 1 (dominant) + period-20 amplitude 0.5.
    const x = series(
      (n) => Math.cos((2 * Math.PI * n) / 8) + 0.5 * Math.cos((2 * Math.PI * n) / 20),
      160,
    );
    const r = computeDampedCycleDecomposition({ values: x, options: { order: 4 } });
    expect(r.varianceExplained).toBeGreaterThan(0.95);
    expect(r.dominantPeriodBars!).toBeCloseTo(8, 0);
    const periods = r.components.map((c) => c.periodBars).filter((p): p is number => p != null);
    expect(periods.some((p) => Math.abs(p - 8) < 1)).toBe(true);
    expect(periods.some((p) => Math.abs(p - 20) < 1.5)).toBe(true);
  });

  it("runs at the default order (6) on a realistic multi-cycle signal and finds the dominant cycle", () => {
    // Default order 6 is well-matched to a few cycles. Dominant period-14 (amp 1)
    // over a weaker period-7 (amp 0.4) — the regime order 6 is built for.
    const x = series(
      (n) => Math.cos((2 * Math.PI * n) / 14) + 0.4 * Math.cos((2 * Math.PI * n) / 7),
      150,
    );
    const r = computeDampedCycleDecomposition({ values: x });
    expect(r.order).toBe(6);
    expect(r.dominantPeriodBars!).toBeCloseTo(14, 0);
    expect(r.varianceExplained).toBeGreaterThan(0.9);
  });
});

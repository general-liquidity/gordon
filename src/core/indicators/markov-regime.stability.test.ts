import { describe, it, expect } from "bun:test";
import { assessMatrixStability, calculateMarkovRegime } from "./markov-regime.ts";
import type { Candle } from "./types.ts";

// ============================================================================
// assessMatrixStability — direct
// ============================================================================

describe("assessMatrixStability", () => {
  it("returns insufficient_data when series is too short", () => {
    const s = [1, 0, -1, 1, 0]; // 5 states
    const result = assessMatrixStability(s);
    expect(result.verdict).toBe("insufficient_data");
    expect(result.degreesOfFreedom).toBe(0);
  });

  it("classifies a stationary series as stable", () => {
    // Construct a long series where transitions are identically
    // distributed in both halves: alternate bull/neutral with a fixed
    // 90/10 pattern. Both halves should show the same transition table.
    const half: number[] = [];
    for (let i = 0; i < 50; i++) {
      half.push(i % 10 === 0 ? -1 : 1); // bull-heavy with occasional bear
    }
    const states = [...half, ...half];
    const result = assessMatrixStability(states);
    expect(result.verdict).toBe("stable");
    expect(result.pValue).toBeGreaterThan(0.1);
  });

  it("classifies a series with a hard regime break as unstable", () => {
    // First half: mostly bull with occasional neutral
    // Second half: mostly bear with occasional neutral
    // Both halves have row overlap (transitions from neutral exist in
    // both) so the chi-square test has positive degrees of freedom and
    // the bull/bear cell-count difference shows up.
    const firstHalf: number[] = [];
    for (let i = 0; i < 60; i++) firstHalf.push(i % 6 === 0 ? 0 : 1);
    const secondHalf: number[] = [];
    for (let i = 0; i < 60; i++) secondHalf.push(i % 6 === 0 ? 0 : -1);
    const states = [...firstHalf, ...secondHalf];
    const result = assessMatrixStability(states);
    expect(result.verdict).toBe("unstable");
    expect(result.pValue).toBeLessThanOrEqual(0.01);
    expect(result.frobeniusDistance).toBeGreaterThan(0.3);
  });

  it("returns insufficient_data when both halves use mutually exclusive rows", () => {
    // Pathological case: first half all bull→bull, second half all
    // bear→bear. No row is observed in both halves so chi-square has
    // df=0 — the right verdict is "we can't test this", not "unstable".
    // The Frobenius distance still flags the difference, but
    // statistical significance can't be claimed without overlap.
    const firstHalf: number[] = [];
    for (let i = 0; i < 50; i++) firstHalf.push(1);
    const secondHalf: number[] = [];
    for (let i = 0; i < 50; i++) secondHalf.push(-1);
    const result = assessMatrixStability([...firstHalf, ...secondHalf]);
    expect(result.verdict).toBe("insufficient_data");
    expect(result.frobeniusDistance).toBeGreaterThan(0.5);
  });

  it("reports degrees-of-freedom > 0 when sample is sufficient", () => {
    // Mix of all three states across both halves
    const half: number[] = [];
    for (let i = 0; i < 50; i++) {
      half.push((i % 3) - 1); // -1, 0, 1, -1, 0, 1, ...
    }
    const states = [...half, ...half];
    const result = assessMatrixStability(states);
    expect(result.degreesOfFreedom).toBeGreaterThan(0);
    expect(result.chiSquare).toBeGreaterThanOrEqual(0);
  });

  it("Frobenius distance is zero when halves are identical", () => {
    const half: number[] = [];
    for (let i = 0; i < 50; i++) half.push(i % 3 === 0 ? 1 : 0);
    const result = assessMatrixStability([...half, ...half]);
    expect(result.frobeniusDistance).toBeLessThan(0.1); // near-zero
  });
});

// ============================================================================
// calculateMarkovRegime — stability surface
// ============================================================================

function makeCandles(closes: number[]): Candle[] {
  const t0 = 1_700_000_000_000;
  return closes.map((c, i) => ({
    openTime: t0 + i * 60_000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
    closeTime: t0 + i * 60_000 + 59_999,
  }));
}

describe("calculateMarkovRegime — stability integration", () => {
  it("returns stability field with insufficient_data when below minimum candle count", () => {
    const result = calculateMarkovRegime(makeCandles([100, 101, 102]));
    expect(result.stability.verdict).toBe("insufficient_data");
  });

  it("returns stability field with verdict + chi-square when long-enough", () => {
    // Generate 200 candles with smooth trending behavior — should be
    // classified by the regime detector and produce a non-trivial
    // matrix. Doesn't need to be deterministic which verdict; just
    // assert the field is populated.
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 200; i++) {
      p *= 1 + Math.sin(i / 10) * 0.005;
      closes.push(p);
    }
    const result = calculateMarkovRegime(makeCandles(closes));
    expect(result.stability).toBeDefined();
    expect(["stable", "drifting", "unstable", "insufficient_data"]).toContain(
      result.stability.verdict,
    );
    expect(typeof result.stability.chiSquare).toBe("number");
    expect(typeof result.stability.pValue).toBe("number");
    expect(typeof result.stability.frobeniusDistance).toBe("number");
  });
});

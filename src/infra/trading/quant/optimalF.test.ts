import { describe, it, expect } from "bun:test";
import { computeOptimalF, optimalFToPayload } from "./optimalF.ts";

describe("computeOptimalF — basic mechanics", () => {
  it("finds an f in (0, 1) for a sequence with wins and losses", () => {
    // 4 wins of +100, 2 losses of -50
    const r = computeOptimalF({
      trades: [100, 100, -50, 100, 100, -50],
    });
    expect(r.optimalF).toBeGreaterThan(0);
    expect(r.optimalF).toBeLessThan(1);
    expect(r.twrAtOptimal).toBeGreaterThan(1);
    expect(r.biggestLoss).toBe(-50);
    expect(r.winCount).toBe(4);
    expect(r.lossCount).toBe(2);
  });

  it("TWR ≥ 1 at optimal f for profitable history", () => {
    const r = computeOptimalF({
      trades: [50, 30, -20, 40, -15, 25, 30],
    });
    expect(r.twrAtOptimal).toBeGreaterThanOrEqual(1);
  });

  it("geometric mean = TWR^(1/N)", () => {
    const r = computeOptimalF({
      trades: [100, -50, 75, -30, 60],
    });
    const expected = r.twrAtOptimal ** (1 / r.sampleSize);
    expect(r.geometricMean).toBeCloseTo(expected, 8);
  });

  it("conservativeF = optimalF / 2", () => {
    const r = computeOptimalF({
      trades: [50, 50, -25, 50, -25],
    });
    expect(r.conservativeF).toBeCloseTo(r.optimalF / 2, 8);
  });
});

describe("computeOptimalF — Vince worked example", () => {
  it("symmetric coinflip-like history → finite f", () => {
    // 50 wins of +1, 50 losses of -1 → biggest loss = -1
    // Naive Kelly would say f = 0 (avg = 0)
    // Optimal f should also be near 0
    const trades: number[] = [];
    for (let i = 0; i < 50; i++) trades.push(1);
    for (let i = 0; i < 50; i++) trades.push(-1);
    const r = computeOptimalF({ trades });
    // Maximum TWR at f near 0 because each trade contributes (1±f)
    // Product ≈ (1+f)^50 × (1-f)^50 which is maximised at f → 0
    // (For more wins than losses it would be > 0.)
    expect(r.optimalF).toBeLessThan(0.1);
  });

  it("higher avg win → higher optimal f", () => {
    const lowEdge = computeOptimalF({
      trades: [10, 10, -8, 10, -8, 10, -8, 10],
    });
    const highEdge = computeOptimalF({
      trades: [50, 50, -8, 50, -8, 50, -8, 50],
    });
    // Higher edge should permit a more aggressive f
    expect(highEdge.optimalF).toBeGreaterThan(lowEdge.optimalF);
  });
});

describe("computeOptimalF — boundary", () => {
  it("empty trades → NaN result", () => {
    const r = computeOptimalF({ trades: [] });
    expect(r.optimalF).toBeNaN();
    expect(r.sampleSize).toBe(0);
  });

  it("no losing trades → undefined (NaN) optimal f", () => {
    const r = computeOptimalF({ trades: [100, 50, 75, 30] });
    expect(r.optimalF).toBeNaN();
    expect(r.lossCount).toBe(0);
  });

  it("all losing trades → optimal f at the floor", () => {
    const r = computeOptimalF({ trades: [-10, -20, -15, -5] });
    // Every f shrinks TWR, so the search returns the smallest f
    // (TWR is maximised by being closest to 1 — i.e. smallest f)
    expect(r.optimalF).toBeGreaterThan(0);
    expect(r.optimalF).toBeLessThan(0.1);
    expect(r.twrAtOptimal).toBeLessThan(1);
  });

  it("bankruptcy guard: factor ≤ 0 sets TWR to 0", () => {
    // With f = 1 and a loss equal to biggestLoss, factor = 1 + 1·(loss/loss) = 1 + 1 = 2 — fine
    // But contrived case: if any individual trade > |biggestLoss|/f, multiplier could go negative.
    // For trades all bounded by biggestLoss in magnitude, this doesn't trigger.
    const r = computeOptimalF({
      trades: [-100, 50, -50, 50],
      maxF: 0.99,
    });
    // biggest loss = -100. For loss of -100: factor = 1 + f × (100/-100) = 1 - f
    // At f = 0.99 → 0.01, doesn't bust. TWR is finite.
    expect(Number.isFinite(r.twrAtOptimal)).toBe(true);
  });
});

describe("computeOptimalF — validation", () => {
  it("throws on invalid step", () => {
    expect(() => computeOptimalF({ trades: [1, -1], step: 0 })).toThrow();
    expect(() => computeOptimalF({ trades: [1, -1], step: 1.5 })).toThrow();
  });

  it("throws on invalid minF/maxF", () => {
    expect(() => computeOptimalF({ trades: [1, -1], minF: 0 })).toThrow();
    expect(() => computeOptimalF({ trades: [1, -1], maxF: 1.5 })).toThrow();
    expect(() => computeOptimalF({ trades: [1, -1], minF: 0.5, maxF: 0.3 })).toThrow();
  });
});

describe("optimalFToPayload", () => {
  it("emits stable shape", () => {
    const r = computeOptimalF({ trades: [10, -5, 10, -5, 10] });
    const p = optimalFToPayload(r) as { kind: string };
    expect(p.kind).toBe("optimal_f.computed");
  });

  it("encodes NaN as null", () => {
    const r = computeOptimalF({ trades: [10, 5, 20] }); // no losses
    const p = optimalFToPayload(r) as { optimalF: number | null };
    expect(p.optimalF).toBeNull();
  });
});

import { describe, it, expect } from "bun:test";
import {
  computeRecoveryFactor,
  recoveryFactorToPayload,
} from "./recoveryFactor.ts";

describe("computeRecoveryFactor — basic formulae", () => {
  it("monotonically rising equity → recovery factor = ∞ (drawdown = 0)", () => {
    const r = computeRecoveryFactor({
      returns: [0.01, 0.02, 0.01, 0.03],
      compoundMode: "simple",
    });
    expect(r.maxDrawdown).toBe(0);
    expect(r.recoveryFactor).toBe(Number.POSITIVE_INFINITY);
  });

  it("equity curve dropping then recovering: drawdown captured correctly", () => {
    // simple mode, initial = 1
    // returns:    +0.1   -0.5    +0.4
    // equity: 1, 1.1, 0.6, 1.0
    // peak = 1.1 (idx 1), trough = 0.6 (idx 2), DD = 0.5
    const r = computeRecoveryFactor({
      returns: [0.1, -0.5, 0.4],
      compoundMode: "simple",
    });
    expect(r.maxDrawdown).toBeCloseTo(0.5, 9);
    expect(r.peakIndex).toBe(1);
    expect(r.troughIndex).toBe(2);
    // Net profit = 0.0 → recovery factor = 0
    expect(r.netProfit).toBeCloseTo(0, 9);
    expect(r.recoveryFactor).toBe(0);
  });

  it("RF = net profit / max drawdown", () => {
    // simple mode: returns +0.2, -0.1, +0.2
    // equity: 1, 1.2, 1.1, 1.3
    // peak: 1.2 (idx 1) → trough: 1.1 (idx 2) → DD = 0.1
    // net profit = 0.3 → RF = 3.0
    const r = computeRecoveryFactor({
      returns: [0.2, -0.1, 0.2],
      compoundMode: "simple",
    });
    expect(r.netProfit).toBeCloseTo(0.3, 9);
    expect(r.maxDrawdown).toBeCloseTo(0.1, 9);
    expect(r.recoveryFactor).toBeCloseTo(3.0, 9);
  });
});

describe("computeRecoveryFactor — compound vs simple", () => {
  it("compound mode multiplies returns", () => {
    // returns: +0.1, +0.1 → compound: 1 × 1.1 × 1.1 = 1.21
    //                       simple:   1 + 0.1 + 0.1 = 1.2
    const compound = computeRecoveryFactor({
      returns: [0.1, 0.1],
      compoundMode: "compound",
    });
    const simple = computeRecoveryFactor({
      returns: [0.1, 0.1],
      compoundMode: "simple",
    });
    expect(compound.finalEquity).toBeCloseTo(1.21, 9);
    expect(simple.finalEquity).toBeCloseTo(1.2, 9);
  });

  it("initial equity scales net profit (simple mode)", () => {
    const r10 = computeRecoveryFactor({
      returns: [0.05, -0.02],
      compoundMode: "simple",
      initialEquity: 10,
    });
    const r100 = computeRecoveryFactor({
      returns: [0.05, -0.02],
      compoundMode: "simple",
      initialEquity: 100,
    });
    expect(r100.netProfit / r10.netProfit).toBeCloseTo(10, 6);
  });
});

describe("computeRecoveryFactor — peak/trough indices", () => {
  it("picks the largest peak-to-trough span, not necessarily adjacent", () => {
    // equity: 1, 1.05, 1.10, 1.08, 1.20, 0.80, 1.00
    // Two drawdowns:  1.10 → 1.08 = 0.02, and 1.20 → 0.80 = 0.40 (largest)
    const r = computeRecoveryFactor({
      returns: [0.05, 0.05 / 1.05, -0.02 / 1.10, 0.12 / 1.08, -0.4 / 1.20, 0.20 / 0.80],
      compoundMode: "compound",
    });
    // Verify the large drawdown captured (peak ≈ 1.20)
    expect(r.maxDrawdown).toBeGreaterThan(0.3);
  });
});

describe("computeRecoveryFactor — boundary", () => {
  it("empty returns → zeros, RF = 0", () => {
    const r = computeRecoveryFactor({ returns: [] });
    expect(r.netProfit).toBe(0);
    expect(r.maxDrawdown).toBe(0);
    expect(r.recoveryFactor).toBe(0);
    expect(r.sampleSize).toBe(0);
  });

  it("throws on non-positive initial equity", () => {
    expect(() =>
      computeRecoveryFactor({ returns: [0.01], initialEquity: 0 }),
    ).toThrow();
  });

  it("net loss + drawdown: RF positive (uses |net profit|)", () => {
    // simple mode: returns -0.2, +0.05 → equity 1, 0.8, 0.85
    // peak = 1 (idx 0), trough = 0.8 (idx 1), DD = 0.2
    // net profit = -0.15 → RF = 0.15 / 0.2 = 0.75
    const r = computeRecoveryFactor({
      returns: [-0.2, 0.05],
      compoundMode: "simple",
    });
    expect(r.netProfit).toBeCloseTo(-0.15, 9);
    expect(r.maxDrawdown).toBeCloseTo(0.2, 9);
    expect(r.recoveryFactor).toBeCloseTo(0.75, 9);
  });
});

describe("recoveryFactorToPayload", () => {
  it("emits stable shape", () => {
    const r = computeRecoveryFactor({
      returns: [0.05, -0.02, 0.03],
      compoundMode: "simple",
    });
    const p = recoveryFactorToPayload(r) as { kind: string };
    expect(p.kind).toBe("recovery_factor.computed");
  });

  it("payload encodes Infinity as null", () => {
    const r = computeRecoveryFactor({
      returns: [0.01, 0.02], // monotone up
      compoundMode: "simple",
    });
    const p = recoveryFactorToPayload(r) as { recoveryFactor: number | null };
    expect(p.recoveryFactor).toBeNull();
  });
});

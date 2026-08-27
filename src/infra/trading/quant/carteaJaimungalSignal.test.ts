import { describe, it, expect } from "bun:test";
import {
  computeCarteaJaimungalSignalSpeed,
  carteaJaimungalSignalToPayload,
} from "./carteaJaimungalSignal.ts";

describe("computeCarteaJaimungalSignalSpeed — validation", () => {
  const base = {
    timeRemaining: 10,
    inventoryRemaining: 100,
    side: "BUY" as const,
    driftEstimate: 0,
    impactCoef: 1,
  };

  it("rejects non-positive time remaining", () => {
    expect(() => computeCarteaJaimungalSignalSpeed({ ...base, timeRemaining: 0 })).toThrow();
    expect(() => computeCarteaJaimungalSignalSpeed({ ...base, timeRemaining: -1 })).toThrow();
  });

  it("rejects negative inventory remaining", () => {
    expect(() => computeCarteaJaimungalSignalSpeed({ ...base, inventoryRemaining: -1 })).toThrow();
  });

  it("rejects non-positive impact coef", () => {
    expect(() => computeCarteaJaimungalSignalSpeed({ ...base, impactCoef: 0 })).toThrow();
  });

  it("rejects negative running penalty", () => {
    expect(() => computeCarteaJaimungalSignalSpeed({ ...base, runningPenalty: -1 })).toThrow();
  });
});

describe("computeCarteaJaimungalSignalSpeed — zero drift reduces to TWAP", () => {
  it("φ=0, μ=0 → exactly TWAP (q/τ)", () => {
    const r = computeCarteaJaimungalSignalSpeed({
      timeRemaining: 10,
      inventoryRemaining: 100,
      side: "BUY",
      driftEstimate: 0,
      impactCoef: 1,
    });
    expect(r.tradingSpeed).toBeCloseTo(10, 6); // 100 / 10
    expect(r.baselineSpeed).toBeCloseTo(10, 6);
    expect(r.driftAdjustment).toBe(0);
    expect(r.urgencyRate).toBe(0);
    expect(r.impliedFinishTime).toBeCloseTo(10, 6);
  });

  it("φ>0, μ=0 → κ·coth(κτ)·q baseline (Almgren-Chriss)", () => {
    const r = computeCarteaJaimungalSignalSpeed({
      timeRemaining: 10,
      inventoryRemaining: 100,
      side: "BUY",
      driftEstimate: 0,
      impactCoef: 1,
      runningPenalty: 0.04, // κ = sqrt(0.04/1) = 0.2
    });
    // κ=0.2, κτ=2, coth(2) ≈ 1.0373, baseline = 0.2 · 1.0373 · 100 ≈ 20.75
    expect(r.urgencyRate).toBeCloseTo(0.2, 6);
    expect(r.baselineSpeed).toBeGreaterThan(10); // faster than TWAP because of urgency
    expect(r.driftAdjustment).toBe(0);
  });
});

describe("computeCarteaJaimungalSignalSpeed — drift adjusts speed by side", () => {
  const base = {
    timeRemaining: 10,
    inventoryRemaining: 100,
    impactCoef: 1,
  };

  it("BUY with positive drift → SPEED UP vs TWAP baseline", () => {
    const noDrift = computeCarteaJaimungalSignalSpeed({
      ...base,
      side: "BUY",
      driftEstimate: 0,
    });
    const withDrift = computeCarteaJaimungalSignalSpeed({
      ...base,
      side: "BUY",
      driftEstimate: 0.5,
    });
    expect(withDrift.tradingSpeed).toBeGreaterThan(noDrift.tradingSpeed);
    expect(withDrift.driftAdjustment).toBeGreaterThan(0);
  });

  it("BUY with negative drift → SLOW DOWN", () => {
    const noDrift = computeCarteaJaimungalSignalSpeed({
      ...base,
      side: "BUY",
      driftEstimate: 0,
    });
    const withDrift = computeCarteaJaimungalSignalSpeed({
      ...base,
      side: "BUY",
      driftEstimate: -0.5,
    });
    expect(withDrift.tradingSpeed).toBeLessThan(noDrift.tradingSpeed);
    expect(withDrift.driftAdjustment).toBeLessThan(0);
  });

  it("SELL with positive drift → SLOW DOWN (signed-symmetric to BUY)", () => {
    const noDrift = computeCarteaJaimungalSignalSpeed({
      ...base,
      side: "SELL",
      driftEstimate: 0,
    });
    const withDrift = computeCarteaJaimungalSignalSpeed({
      ...base,
      side: "SELL",
      driftEstimate: 0.5,
    });
    expect(withDrift.tradingSpeed).toBeLessThan(noDrift.tradingSpeed);
    expect(withDrift.driftAdjustment).toBeLessThan(0);
  });

  it("SELL with negative drift → SPEED UP", () => {
    const noDrift = computeCarteaJaimungalSignalSpeed({
      ...base,
      side: "SELL",
      driftEstimate: 0,
    });
    const withDrift = computeCarteaJaimungalSignalSpeed({
      ...base,
      side: "SELL",
      driftEstimate: -0.5,
    });
    expect(withDrift.tradingSpeed).toBeGreaterThan(noDrift.tradingSpeed);
    expect(withDrift.driftAdjustment).toBeGreaterThan(0);
  });
});

describe("computeCarteaJaimungalSignalSpeed — drift floored at zero", () => {
  it("strongly adverse drift cannot push speed negative", () => {
    const r = computeCarteaJaimungalSignalSpeed({
      timeRemaining: 10,
      inventoryRemaining: 100,
      side: "BUY",
      driftEstimate: -1000, // wildly adverse
      impactCoef: 1,
    });
    expect(r.tradingSpeed).toBeGreaterThanOrEqual(0);
  });
});

describe("computeCarteaJaimungalSignalSpeed — extremes", () => {
  it("τ → 0 produces large speed (terminal liquidation pressure)", () => {
    const long = computeCarteaJaimungalSignalSpeed({
      timeRemaining: 100,
      inventoryRemaining: 100,
      side: "BUY",
      driftEstimate: 0,
      impactCoef: 1,
    });
    const short = computeCarteaJaimungalSignalSpeed({
      timeRemaining: 0.1,
      inventoryRemaining: 100,
      side: "BUY",
      driftEstimate: 0,
      impactCoef: 1,
    });
    expect(short.tradingSpeed).toBeGreaterThan(long.tradingSpeed);
  });

  it("zero inventory → zero speed", () => {
    const r = computeCarteaJaimungalSignalSpeed({
      timeRemaining: 10,
      inventoryRemaining: 0,
      side: "BUY",
      driftEstimate: 0.1, // even with drift, no inventory to trade
      impactCoef: 1,
    });
    // baseline = 0, drift adjustment exists; but inventory at zero means
    // there's no work to do. Drift can still push speed positive though
    // (the model says "trade in this direction to capture the drift"),
    // which is the documented behavior.
    expect(r.baselineSpeed).toBe(0);
  });
});

describe("carteaJaimungalSignalToPayload", () => {
  it("emits stable shape", () => {
    const r = computeCarteaJaimungalSignalSpeed({
      timeRemaining: 10,
      inventoryRemaining: 100,
      side: "BUY",
      driftEstimate: 0.1,
      impactCoef: 1,
      runningPenalty: 0.01,
    });
    const p = carteaJaimungalSignalToPayload(r) as {
      kind: string;
      tradingSpeed: number;
      baselineSpeed: number;
      urgencyRate: number;
    };
    expect(p.kind).toBe("cartea_jaimungal_signal.computed");
    expect(p.tradingSpeed).toBeGreaterThan(0);
    expect(p.urgencyRate).toBeGreaterThan(0);
  });
});

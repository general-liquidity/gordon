import { describe, expect, test } from "bun:test";
import {
  computeInventoryAdjustedSpread,
  formatInventoryAdjustedSpread,
} from "./inventory-adjusted-spread.ts";

describe("computeInventoryAdjustedSpread", () => {
  test("invalid inputs → invalid_inputs verdict", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 0,
      inventory: 0,
      volatility: 0.01,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    expect(r.verdict).toBe("invalid_inputs");
  });

  test("flat inventory → reservation = mid, symmetric quotes", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 0,
      riskAversion: 0.1,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    expect(r.reservationPrice).toBeCloseTo(100, 6);
    expect(r.reservationSkew).toBeCloseTo(0, 6);
    expect(r.askPrice - r.midPrice).toBeCloseTo(r.midPrice - r.bidPrice, 6);
    expect(r.verdict).toBe("two_sided");
  });

  test("long inventory → reservation BELOW mid (skew negative)", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 1000,
      riskAversion: 0.1,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    expect(r.reservationPrice).toBeLessThan(r.midPrice);
    expect(r.reservationSkew).toBeLessThan(0);
    // Both bid and ask shift down → makes selling easier and buying harder
    expect(r.askPrice).toBeLessThan(100 + r.halfSpread);
  });

  test("short inventory → reservation ABOVE mid (skew positive)", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: -1000,
      riskAversion: 0.1,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    expect(r.reservationPrice).toBeGreaterThan(r.midPrice);
    expect(r.reservationSkew).toBeGreaterThan(0);
  });

  test("higher risk aversion → larger inventory skew (at same nonzero inventory)", () => {
    // The AS spread is non-monotonic in γ (the competitive term decreases
    // and the inventory term increases). The unambiguous prediction is
    // that the inventory-induced reservation skew scales with γ.
    const low = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 1000,
      riskAversion: 0.05,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    const high = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 1000,
      riskAversion: 0.50,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    expect(Math.abs(high.reservationSkew)).toBeGreaterThan(Math.abs(low.reservationSkew));
  });

  test("higher volatility → wider spread", () => {
    const low = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 0,
      volatility: 0.01,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    const high = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 0,
      volatility: 0.10,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    expect(high.totalSpread).toBeGreaterThan(low.totalSpread);
  });

  test("higher intensity decay → tighter spread (orders die off faster, must be aggressive)", () => {
    const lowDecay = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 0,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 0.5,
    });
    const highDecay = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 0,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 5.0,
    });
    expect(highDecay.totalSpread).toBeLessThan(lowDecay.totalSpread);
  });

  test("longer time horizon → wider spread (can be patient)", () => {
    const short = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 0,
      volatility: 0.02,
      timeRemaining: 0.1,
      intensityDecay: 1.5,
    });
    const long = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 0,
      volatility: 0.02,
      timeRemaining: 10,
      intensityDecay: 1.5,
    });
    expect(long.totalSpread).toBeGreaterThan(short.totalSpread);
  });

  test("inventory hard limit triggers bid pull when over-long", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 5000,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
      inventoryHardLimit: 1000,
    });
    expect(r.bidPulled).toBe(true);
    expect(r.askPulled).toBe(false);
    expect(r.verdict).toBe("long_capped");
  });

  test("inventory hard limit triggers ask pull when over-short", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: -5000,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
      inventoryHardLimit: 1000,
    });
    expect(r.bidPulled).toBe(false);
    expect(r.askPulled).toBe(true);
    expect(r.verdict).toBe("short_capped");
  });

  test("inventory below hard limit → no pull", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 500,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
      inventoryHardLimit: 1000,
    });
    expect(r.bidPulled).toBe(false);
    expect(r.askPulled).toBe(false);
  });

  test("symmetric inventory positions produce symmetric reservation skew", () => {
    const longR = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 100,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    const shortR = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: -100,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    expect(longR.reservationSkew).toBeCloseTo(-shortR.reservationSkew, 6);
    expect(longR.totalSpread).toBeCloseTo(shortR.totalSpread, 6);
  });
});

describe("formatInventoryAdjustedSpread", () => {
  test("renders header + skew + verdict", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 1000,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
    });
    const text = formatInventoryAdjustedSpread(r);
    expect(text).toContain("Inventory-Adjusted Spread");
    expect(text).toContain("Reservation");
    expect(text).toContain("TWO_SIDED");
  });

  test("flags pulled side in output", () => {
    const r = computeInventoryAdjustedSpread({
      midPrice: 100,
      inventory: 5000,
      volatility: 0.02,
      timeRemaining: 1,
      intensityDecay: 1.5,
      inventoryHardLimit: 1000,
    });
    const text = formatInventoryAdjustedSpread(r);
    expect(text).toContain("PULLED");
  });
});

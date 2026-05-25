import { describe, expect, test } from "bun:test";
import {
  computeInventoryAdjustedPrice,
  inventoryAwareSizeMultiplier,
  summarizeInventoryAdjustment,
} from "./inventoryAdjustedPrice.ts";

describe("computeInventoryAdjustedPrice — sign + magnitude", () => {
  test("zero inventory → no adjustment, neutral bias", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0,
      volatility: 0.02,
      horizon: 1,
    });
    expect(Math.abs(r.adjustment)).toBe(0);
    expect(r.adjustedPrice).toBe(100);
    expect(r.bias).toBe("neutral");
  });

  test("long inventory → r below mid → long_inventory_sell_bias", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5, // long
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.5,
    });
    expect(r.adjustedPrice).toBeLessThan(100);
    expect(r.adjustment).toBeLessThan(0);
    expect(r.bias).toBe("long_inventory_sell_bias");
  });

  test("short inventory → r above mid → short_inventory_buy_bias", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: -0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.5,
    });
    expect(r.adjustedPrice).toBeGreaterThan(100);
    expect(r.adjustment).toBeGreaterThan(0);
    expect(r.bias).toBe("short_inventory_buy_bias");
  });

  test("magnitude scales with γ", () => {
    const small = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.1,
    });
    const large = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.5,
    });
    expect(Math.abs(large.adjustment)).toBeGreaterThan(Math.abs(small.adjustment));
    expect(Math.abs(large.adjustment) / Math.abs(small.adjustment)).toBeCloseTo(5, 6);
  });

  test("magnitude scales with σ²", () => {
    const low = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
    });
    const high = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.04,
      horizon: 1,
    });
    // σ doubled → adjustment 4× larger.
    expect(Math.abs(high.adjustment) / Math.abs(low.adjustment)).toBeCloseTo(4, 6);
  });

  test("magnitude scales with horizon", () => {
    const short = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
    });
    const long = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 5,
    });
    expect(Math.abs(long.adjustment) / Math.abs(short.adjustment)).toBeCloseTo(5, 6);
  });

  test("formula matches r = s - q·γ·σ²·(T-t)", () => {
    const inputs = {
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.1,
    };
    const r = computeInventoryAdjustedPrice(inputs);
    const expected =
      inputs.mid -
      inputs.inventory *
        inputs.riskAversion *
        inputs.volatility *
        inputs.volatility *
        inputs.horizon;
    expect(r.adjustedPrice).toBeCloseTo(expected, 10);
  });
});

describe("computeInventoryAdjustedPrice — neutral threshold", () => {
  test("very small inventory → neutral bias label even though signed", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.0001,
      volatility: 0.02,
      horizon: 1,
    });
    // adjustment ≈ -0.0001 * 0.1 * 0.0004 * 1 = -4e-9
    expect(r.bias).toBe("neutral");
  });
});

describe("computeInventoryAdjustedPrice — edge cases", () => {
  test("zero mid → no division explosion", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 0,
      inventory: 1,
      volatility: 0.02,
      horizon: 1,
    });
    expect(r.adjustmentPct).toBe(0);
  });

  test("default risk aversion is 0.1", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
    });
    expect(r.inputs.riskAversion).toBe(0.1);
  });

  test("inputs are echoed in result for audit", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.3,
    });
    expect(r.inputs).toEqual({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.3,
    });
  });
});

describe("inventoryAwareSizeMultiplier", () => {
  test("opposite direction → multiplier = 1.0 (full size, reducing exposure)", () => {
    const m = inventoryAwareSizeMultiplier(0.5, -1, -0.001);
    expect(m).toBe(1.0);
  });

  test("same direction, small adjustment → multiplier near 1", () => {
    const m = inventoryAwareSizeMultiplier(0.5, 1, -0.00001);
    expect(m).toBeGreaterThan(0.99);
  });

  test("same direction, larger adjustment → multiplier < 1 but ≥ cap", () => {
    const m = inventoryAwareSizeMultiplier(0.5, 1, -0.01);
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThanOrEqual(0.5);
  });

  test("respects custom cap", () => {
    const m = inventoryAwareSizeMultiplier(0.5, 1, -0.5, 0.3);
    expect(m).toBeGreaterThanOrEqual(0.3);
  });

  test("zero inventory → full size regardless of side", () => {
    expect(inventoryAwareSizeMultiplier(0, 1, -0.01)).toBe(1.0);
    expect(inventoryAwareSizeMultiplier(0, -1, 0.01)).toBe(1.0);
  });
});

describe("summarizeInventoryAdjustment", () => {
  test("long-inventory message", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.5,
    });
    const summary = summarizeInventoryAdjustment(r);
    expect(summary).toContain("long inventory");
    expect(summary).toContain("bias toward selling");
  });

  test("short-inventory message", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: -0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.5,
    });
    const summary = summarizeInventoryAdjustment(r);
    expect(summary).toContain("short inventory");
    expect(summary).toContain("covering");
  });

  test("neutral message", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0,
      volatility: 0.02,
      horizon: 1,
    });
    const summary = summarizeInventoryAdjustment(r);
    expect(summary).toContain("inventory-neutral");
  });

  test("includes basis-point figure", () => {
    const r = computeInventoryAdjustedPrice({
      mid: 100,
      inventory: 0.5,
      volatility: 0.02,
      horizon: 1,
      riskAversion: 0.5,
    });
    const summary = summarizeInventoryAdjustment(r);
    expect(summary).toMatch(/bp/);
  });
});

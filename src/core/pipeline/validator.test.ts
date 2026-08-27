/**
 * Tests for validator module
 *
 * Tests plan validation rules including structure, risk, and warnings
 */

import { describe, test, expect } from "bun:test";
import { validatePlan, calculateRiskReward, calculateAllocationPercent } from "./validator.ts";
import { createMockPlan, createMockConfig, createMockPortfolio } from "../../test-utils/mocks.ts";
import type { Plan } from "../../types/index.ts";

describe("calculateRiskReward", () => {
  test("returns 0 for market orders with null entry price", () => {
    const plan = createMockPlan({
      entry: { type: "market", price: null },
    });
    const result = calculateRiskReward(plan);
    expect(result).toBe(0);
  });

  test("returns 0 when no take profit levels exist", () => {
    const plan = createMockPlan({
      takeProfit: [],
    });
    const result = calculateRiskReward(plan);
    expect(result).toBe(0);
  });

  test("returns 0 when stop loss equals or exceeds entry (invalid setup)", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 100 },
      takeProfit: [{ price: 110, percentToSell: 1 }],
    });
    const result = calculateRiskReward(plan);
    expect(result).toBe(0);
  });

  test("calculates correct risk/reward ratio for valid plan", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 95 },
      takeProfit: [{ price: 110, percentToSell: 1 }],
    });
    // Risk: 100 - 95 = 5
    // Reward: 110 - 100 = 10
    // R:R = 10/5 = 2
    const result = calculateRiskReward(plan);
    expect(result).toBe(2);
  });

  test("uses first take profit level for calculation", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 95 },
      takeProfit: [
        { price: 105, percentToSell: 0.5 }, // First TP used
        { price: 115, percentToSell: 0.5 },
      ],
    });
    // Risk: 100 - 95 = 5
    // Reward: 105 - 100 = 5
    // R:R = 5/5 = 1
    const result = calculateRiskReward(plan);
    expect(result).toBe(1);
  });

  test("calculates risk/reward in the short direction", () => {
    const plan = createMockPlan({
      direction: "short",
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 105 },
      takeProfit: [{ price: 90, percentToSell: 1 }],
    });
    expect(calculateRiskReward(plan)).toBe(2);
  });
});

describe("calculateAllocationPercent", () => {
  test("returns 0 for zero portfolio value", () => {
    const plan = createMockPlan({
      allocation: { currency: "USDT", amount: 500, percentOfPortfolio: 0.05 },
    });
    const result = calculateAllocationPercent(plan, 0);
    expect(result).toBe(0);
  });

  test("returns 0 for negative portfolio value", () => {
    const plan = createMockPlan({
      allocation: { currency: "USDT", amount: 500, percentOfPortfolio: 0.05 },
    });
    const result = calculateAllocationPercent(plan, -1000);
    expect(result).toBe(0);
  });

  test("calculates correct percentage", () => {
    const plan = createMockPlan({
      allocation: { currency: "USDT", amount: 500, percentOfPortfolio: 0.05 },
    });
    const result = calculateAllocationPercent(plan, 10000);
    expect(result).toBe(0.05);
  });
});

describe("validatePlan - Structure Validation", () => {
  test("returns valid for well-formed plan", () => {
    const plan = createMockPlan();
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects limit order without entry price", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: null },
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Entry price is required"))).toBe(true);
  });

  test("accepts market order without entry price", () => {
    const plan = createMockPlan({
      entry: { type: "market", price: null },
      stopLoss: { price: 95 },
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    // Should not have entry price error (but may have other validation issues)
    expect(result.errors.some((e) => e.includes("Entry price is required"))).toBe(false);
  });

  test("rejects plan without stop loss", () => {
    const plan = createMockPlan({
      stopLoss: { price: undefined as unknown as number },
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Stop loss price is required"))).toBe(true);
  });

  test("rejects long position with stop loss above entry", () => {
    const plan = createMockPlan({
      direction: "long",
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 105 },
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be below entry price"))).toBe(true);
  });

  test("accepts valid short geometry", () => {
    const plan = createMockPlan({
      direction: "short",
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 105 },
      takeProfit: [{ price: 90, percentToSell: 1 }],
      dca: [{ price: 103, percentOfAllocation: 1 }],
    });
    const result = validatePlan(plan, createMockConfig(), createMockPortfolio());
    expect(result.errors.filter((error) => /short positions/.test(error))).toEqual([]);
  });

  test("rejects short stop, targets, and DCA on the long side", () => {
    const plan = createMockPlan({
      direction: "short",
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 95 },
      takeProfit: [{ price: 110, percentToSell: 1 }],
      dca: [{ price: 90, percentOfAllocation: 1 }],
    });
    const result = validatePlan(plan, createMockConfig(), createMockPortfolio());
    expect(
      result.errors.some(
        (error) => error.includes("above entry price") && error.includes("Stop loss"),
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (error) => error.includes("below entry price") && error.includes("Take profit"),
      ),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes("above entry price") && error.includes("DCA")),
    ).toBe(true);
  });

  test("rejects plan without take profit levels", () => {
    const plan = createMockPlan({
      takeProfit: [],
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("At least one take profit"))).toBe(true);
  });

  test("rejects take profit percentages not summing to 100%", () => {
    const plan = createMockPlan({
      takeProfit: [
        { price: 110, percentToSell: 0.3 },
        { price: 120, percentToSell: 0.3 },
      ],
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must sum to 100%"))).toBe(true);
  });

  test("rejects long position with take profit below entry", () => {
    const plan = createMockPlan({
      direction: "long",
      entry: { type: "limit", price: 100 },
      takeProfit: [{ price: 95, percentToSell: 1 }],
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be above entry price"))).toBe(true);
  });

  test("rejects invalid symbol format", () => {
    const plan = createMockPlan({
      symbol: "invalid",
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invalid symbol format"))).toBe(true);
  });

  test("accepts valid symbol formats", () => {
    const validSymbols = ["BTCUSDT", "ETHUSDT", "DOTUSDT", "SOLUSDT"];

    for (const symbol of validSymbols) {
      const plan = createMockPlan({ symbol });
      const config = createMockConfig();
      const portfolio = createMockPortfolio();

      const result = validatePlan(plan, config, portfolio);
      expect(result.errors.some((e) => e.includes("Invalid symbol format"))).toBe(false);
    }
  });

  test("validates DCA percentages sum to 100%", () => {
    const plan = createMockPlan({
      dca: [
        { price: 95, percentOfAllocation: 0.3 },
        { price: 90, percentOfAllocation: 0.3 },
      ],
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("DCA percentages must sum to 100%"))).toBe(true);
  });

  test("rejects DCA levels above entry for long positions", () => {
    const plan = createMockPlan({
      direction: "long",
      entry: { type: "limit", price: 100 },
      dca: [{ price: 105, percentOfAllocation: 1 }],
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("DCA level"))).toBe(true);
  });
});

describe("validatePlan - Risk Validation", () => {
  test("rejects allocation exceeding max per trade", () => {
    const plan = createMockPlan({
      allocation: { currency: "USDT", amount: 2000, percentOfPortfolio: 0.2 },
    });
    const config = createMockConfig({
      preferences: {
        maxAllocationPerTrade: 0.1,
        cashReservePercent: 0.2,
        defaultTimeframes: ["1h", "4h"],
        topNCoins: 50,
        maxConcurrentTrades: 5,
      },
    });
    const portfolio = createMockPortfolio({ totalValue: 10000 });

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exceeds maximum allowed"))).toBe(true);
  });

  test("rejects allocation that would violate cash reserve", () => {
    const plan = createMockPlan({
      allocation: { currency: "USDT", amount: 4500, percentOfPortfolio: 0.45 },
    });
    const config = createMockConfig({
      preferences: {
        maxAllocationPerTrade: 0.5,
        cashReservePercent: 0.2,
        defaultTimeframes: ["1h", "4h"],
        topNCoins: 50,
        maxConcurrentTrades: 5,
      },
    });
    const portfolio = createMockPortfolio({
      totalValue: 10000,
      availableCash: 5000,
    });

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Insufficient cash reserve"))).toBe(true);
  });

  test("rejects stop loss too tight (under 1%)", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 99.5 },
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("too tight"))).toBe(true);
  });

  test("rejects stop loss too wide (over 15%)", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 80 },
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("too wide"))).toBe(true);
  });

  test("rejects risk/reward ratio below minimum", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 95 },
      takeProfit: [{ price: 104, percentToSell: 1 }], // R:R = 4/5 = 0.8
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Risk/reward ratio"))).toBe(true);
  });
});

describe("validatePlan - Warnings", () => {
  test("warns about high volatility stop (over 10%)", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 88 }, // 12% from entry
      takeProfit: [{ price: 130, percentToSell: 1 }], // Good R:R
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.warnings.some((w) => w.includes("High volatility"))).toBe(true);
  });

  test("warns about low reward ratio (between 1.2 and 1.5)", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 95 },
      takeProfit: [{ price: 106.5, percentToSell: 1 }], // R:R = 6.5/5 = 1.3
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.warnings.some((w) => w.includes("Low reward ratio"))).toBe(true);
  });

  test("warns about large allocation (over 8%)", () => {
    const plan = createMockPlan({
      allocation: { currency: "USDT", amount: 900, percentOfPortfolio: 0.09 },
    });
    const config = createMockConfig({
      preferences: {
        maxAllocationPerTrade: 0.15,
        cashReservePercent: 0.1,
        defaultTimeframes: ["1h", "4h"],
        topNCoins: 50,
        maxConcurrentTrades: 5,
      },
    });
    const portfolio = createMockPortfolio({ totalValue: 10000 });

    const result = validatePlan(plan, config, portfolio);
    expect(result.warnings.some((w) => w.includes("Large allocation"))).toBe(true);
  });

  test("returns empty warnings for conservative plan", () => {
    const plan = createMockPlan({
      entry: { type: "limit", price: 100 },
      stopLoss: { price: 96 }, // 4% - not too volatile
      takeProfit: [{ price: 112, percentToSell: 1 }], // R:R = 3 - good ratio
      allocation: { currency: "USDT", amount: 500, percentOfPortfolio: 0.05 }, // 5% - not too large
    });
    const config = createMockConfig();
    const portfolio = createMockPortfolio();

    const result = validatePlan(plan, config, portfolio);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("validatePlan - grid_entry", () => {
  const mockConfig = createMockConfig({
    preferences: {
      maxAllocationPerTrade: 0.15, // Allow 15% allocation
      cashReservePercent: 0.1,
      defaultTimeframes: ["1h", "4h"],
      topNCoins: 50,
      maxConcurrentTrades: 5,
    },
  });
  const mockPortfolio = createMockPortfolio();

  // Grid plan with valid risk/reward: entry 3400, stop 3230 (risk=170, 5%), TP1 3650 (reward=250)
  // R:R = 250/170 = 1.47 (above 1.2 minimum)
  const baseGridPlan: Plan = {
    id: "pln_test123",
    createdAt: new Date().toISOString(),
    symbol: "ETHUSDT",
    direction: "long",
    strategy: "grid_entry",
    allocation: {
      currency: "USDT",
      amount: 500,
      percentOfPortfolio: 0.05,
    },
    entry: {
      type: "limit",
      price: 3400,
    },
    dca: null,
    grid: {
      levels: [
        { price: 3400, percentOfAllocation: 0.1 },
        { price: 3360, percentOfAllocation: 0.15 },
        { price: 3320, percentOfAllocation: 0.2 },
        { price: 3280, percentOfAllocation: 0.25 },
        { price: 3240, percentOfAllocation: 0.3 },
      ],
      distribution: "pyramid",
      priceRange: { high: 3400, low: 3240 },
    },
    stopLoss: { price: 3230 },
    takeProfit: [
      { price: 3650, percentToSell: 0.5 },
      { price: 3900, percentToSell: 0.5 },
    ],
    reasoning: "Test grid plan",
    status: "DRAFT",
  };

  test("should validate a correct grid plan", () => {
    const result = validatePlan(baseGridPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("should error if grid percentages don't sum to 1", () => {
    const badPlan = {
      ...baseGridPlan,
      grid: {
        ...baseGridPlan.grid!,
        levels: [
          { price: 3400, percentOfAllocation: 0.1 },
          { price: 3340, percentOfAllocation: 0.1 },
          { price: 3280, percentOfAllocation: 0.1 },
        ],
      },
    };
    const result = validatePlan(badPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sum to 100%"))).toBe(true);
  });

  test("should error if grid levels are not descending", () => {
    const badPlan = {
      ...baseGridPlan,
      grid: {
        ...baseGridPlan.grid!,
        levels: [
          { price: 3200, percentOfAllocation: 0.33 },
          { price: 3400, percentOfAllocation: 0.33 },
          { price: 3300, percentOfAllocation: 0.34 },
        ],
      },
    };
    const result = validatePlan(badPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("descending"))).toBe(true);
  });

  test("should error if stop loss is above lowest grid level", () => {
    const badPlan = {
      ...baseGridPlan,
      stopLoss: { price: 3250 }, // Above lowest grid level (3240)
    };
    const result = validatePlan(badPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("below lowest grid level"))).toBe(true);
  });

  test("should warn if grid range is too wide", () => {
    const widePlan = {
      ...baseGridPlan,
      grid: {
        ...baseGridPlan.grid!,
        priceRange: { high: 3400, low: 2700 },
      },
    };
    const result = validatePlan(widePlan, mockConfig, mockPortfolio);
    expect(result.warnings.some((w) => w.includes("range"))).toBe(true);
  });

  test("should error if grid has fewer than 3 levels", () => {
    const badPlan = {
      ...baseGridPlan,
      grid: {
        ...baseGridPlan.grid!,
        levels: [
          { price: 3400, percentOfAllocation: 0.5 },
          { price: 3300, percentOfAllocation: 0.5 },
        ],
      },
    };
    const result = validatePlan(badPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("3-7 levels"))).toBe(true);
  });

  test("should error if grid has more than 7 levels", () => {
    const badPlan = {
      ...baseGridPlan,
      grid: {
        ...baseGridPlan.grid!,
        levels: [
          { price: 3400, percentOfAllocation: 0.1 },
          { price: 3380, percentOfAllocation: 0.1 },
          { price: 3360, percentOfAllocation: 0.1 },
          { price: 3340, percentOfAllocation: 0.1 },
          { price: 3320, percentOfAllocation: 0.1 },
          { price: 3300, percentOfAllocation: 0.15 },
          { price: 3280, percentOfAllocation: 0.15 },
          { price: 3260, percentOfAllocation: 0.2 },
        ],
      },
    };
    const result = validatePlan(badPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("3-7 levels"))).toBe(true);
  });
});

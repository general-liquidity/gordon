import { describe, it, expect } from "bun:test";
import { calculatePyramidWeights, calculateEqualWeights, calculateGridLevels } from "./grid-calculator.ts";
import type { Level } from "../types/index.ts";

describe("grid-calculator", () => {
  describe("calculatePyramidWeights", () => {
    it("should return weights that sum to 1", () => {
      const weights = calculatePyramidWeights(5);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(0.001);
    });

    it("should have increasing weights (more at lower prices)", () => {
      const weights = calculatePyramidWeights(5);
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeGreaterThan(weights[i - 1]!);
      }
    });

    it("should handle 3 levels", () => {
      const weights = calculatePyramidWeights(3);
      expect(weights).toHaveLength(3);
      expect(weights[0]).toBeCloseTo(1 / 6, 2);
      expect(weights[1]).toBeCloseTo(2 / 6, 2);
      expect(weights[2]).toBeCloseTo(3 / 6, 2);
    });
  });

  describe("calculateEqualWeights", () => {
    it("should return equal weights summing to 1", () => {
      const weights = calculateEqualWeights(5);
      expect(weights).toHaveLength(5);
      weights.forEach(w => expect(w).toBeCloseTo(0.2, 5));
    });
  });

  describe("calculateGridLevels", () => {
    const mockSupports: Level[] = [
      { price: 3400, type: "support", strength: 0.8, touches: 3 },
      { price: 3280, type: "support", strength: 0.7, touches: 2 },
      { price: 3160, type: "support", strength: 0.6, touches: 2 },
    ];

    it("should create correct number of levels", () => {
      const result = calculateGridLevels({
        supports: mockSupports,
        currentPrice: 3450,
        numLevels: 5,
        distribution: "pyramid",
        allocation: 1000,
      });
      expect(result.levels).toHaveLength(5);
    });

    it("should have descending prices", () => {
      const result = calculateGridLevels({
        supports: mockSupports,
        currentPrice: 3450,
        numLevels: 5,
        distribution: "pyramid",
        allocation: 1000,
      });
      for (let i = 1; i < result.levels.length; i++) {
        expect(result.levels[i]!.price).toBeLessThan(result.levels[i - 1]!.price);
      }
    });

    it("should use pyramid distribution correctly", () => {
      const result = calculateGridLevels({
        supports: mockSupports,
        currentPrice: 3450,
        numLevels: 5,
        distribution: "pyramid",
        allocation: 1000,
      });
      expect(result.levels[0]!.amount).toBeLessThan(result.levels[4]!.amount);
    });

    it("should calculate weighted average entry", () => {
      const result = calculateGridLevels({
        supports: mockSupports,
        currentPrice: 3450,
        numLevels: 5,
        distribution: "equal",
        allocation: 1000,
      });
      expect(result.weightedEntryIfAllFill).toBeLessThan(result.levels[0]!.price);
      expect(result.weightedEntryIfAllFill).toBeGreaterThan(result.levels[4]!.price);
    });

    it("should set stop loss below lowest level", () => {
      const result = calculateGridLevels({
        supports: mockSupports,
        currentPrice: 3450,
        numLevels: 5,
        distribution: "pyramid",
        allocation: 1000,
      });
      const lowestLevel = result.levels[result.levels.length - 1]!.price;
      expect(result.stopLossPrice).toBeLessThan(lowestLevel);
    });
  });
});

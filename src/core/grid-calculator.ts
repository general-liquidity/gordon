/**
 * Grid Calculator Module
 *
 * Calculates grid levels and allocations for grid entry strategy.
 * Purely deterministic - no AI involved.
 */

import type { Level } from "../types/index.ts";
import type { GridConfig } from "../types/plan.ts";

// Types
export interface GridCalculationInput {
  supports: Level[];
  currentPrice: number;
  numLevels: number;
  distribution: "pyramid" | "equal";
  allocation: number;
}

export interface GridCalculationResult {
  config: GridConfig;
  levels: Array<{
    price: number;
    percentOfAllocation: number;
    amount: number;
    nearSupport: string | null;
  }>;
  weightedEntryIfAllFill: number;
  stopLossPrice: number;
}

/**
 * Calculate pyramid weights where lower prices get more allocation.
 * Formula: weight[i] = (i + 1) / triangularNumber(n)
 */
export function calculatePyramidWeights(numLevels: number): number[] {
  const triangular = (numLevels * (numLevels + 1)) / 2;
  const weights: number[] = [];
  for (let i = 0; i < numLevels; i++) {
    weights.push((i + 1) / triangular);
  }
  return weights;
}

/**
 * Calculate equal weights for uniform distribution.
 */
export function calculateEqualWeights(numLevels: number): number[] {
  const weight = 1 / numLevels;
  return Array(numLevels).fill(weight);
}

const STOP_LOSS_BUFFER_PERCENT = 0.03;
const SUPPORT_SNAP_THRESHOLD = 0.01;
const MIN_LEVELS = 3;
const MAX_LEVELS = 7;

/**
 * Calculate grid levels based on support zones and allocation settings.
 * Generates buy orders at descending price levels with configurable distribution.
 */
export function calculateGridLevels(input: GridCalculationInput): GridCalculationResult {
  const { supports, currentPrice, numLevels, distribution, allocation } = input;

  const levels = Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, numLevels));

  const sortedSupports = [...supports]
    .filter(s => s.price < currentPrice)
    .sort((a, b) => b.price - a.price);

  const highPrice = sortedSupports[0]?.price ?? currentPrice * 0.98;
  const lowPrice = sortedSupports[2]?.price ?? sortedSupports[1]?.price ?? currentPrice * 0.90;
  const priceStep = (highPrice - lowPrice) / (levels - 1);

  const weights = distribution === "pyramid"
    ? calculatePyramidWeights(levels)
    : calculateEqualWeights(levels);

  const gridLevels: GridCalculationResult["levels"] = [];

  for (let i = 0; i < levels; i++) {
    let price = highPrice - (priceStep * i);

    const nearbySupport = sortedSupports.find(s =>
      Math.abs(s.price - price) / price < SUPPORT_SNAP_THRESHOLD
    );
    if (nearbySupport) price = nearbySupport.price;

    const percent = weights[i]!;
    const amount = allocation * percent;

    let nearSupport: string | null = null;
    const supportIndex = sortedSupports.findIndex(s =>
      Math.abs(s.price - price) / price < SUPPORT_SNAP_THRESHOLD
    );
    if (supportIndex !== -1) nearSupport = `S${supportIndex + 1}`;

    gridLevels.push({
      price: roundPrice(price),
      percentOfAllocation: percent,
      amount: roundAmount(amount),
      nearSupport,
    });
  }

  const weightedEntry = gridLevels.reduce(
    (sum, level) => sum + level.price * level.percentOfAllocation, 0
  );

  const lowestPrice = gridLevels[gridLevels.length - 1]!.price;
  const stopLossPrice = roundPrice(lowestPrice * (1 - STOP_LOSS_BUFFER_PERCENT));

  const config: GridConfig = {
    levels: gridLevels.map(l => ({
      price: l.price,
      percentOfAllocation: l.percentOfAllocation,
    })),
    distribution,
    priceRange: {
      high: gridLevels[0]!.price,
      low: gridLevels[gridLevels.length - 1]!.price,
    },
  };

  return { config, levels: gridLevels, weightedEntryIfAllFill: roundPrice(weightedEntry), stopLossPrice };
}

function roundPrice(price: number): number {
  if (price < 1) return Math.round(price * 10000) / 10000;
  if (price < 10) return Math.round(price * 1000) / 1000;
  return Math.round(price * 100) / 100;
}

function roundAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

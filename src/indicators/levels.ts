/**
 * Support and Resistance level detection
 *
 * Support: Price levels where buying pressure historically overcomes selling
 * Resistance: Price levels where selling pressure historically overcomes buying
 */

import type { Candle, Level } from "../types/index.ts";

interface SwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
}

/**
 * Detect swing highs and lows in price data
 *
 * A swing high is a candle with lower highs on both sides
 * A swing low is a candle with higher lows on both sides
 *
 * @param candles - Array of candle data
 * @param lookback - Number of candles on each side to confirm swing (default: 3)
 * @returns Array of swing points
 */
function detectSwingPoints(candles: Candle[], lookback: number): SwingPoint[] {
  const swingPoints: SwingPoint[] = [];

  if (candles.length < lookback * 2 + 1) {
    return swingPoints;
  }

  for (let i = lookback; i < candles.length - lookback; i++) {
    const currentCandle = candles[i];
    if (!currentCandle) continue;

    const currentHigh = currentCandle.high;
    const currentLow = currentCandle.low;

    let isSwingHigh = true;
    let isSwingLow = true;

    // Check candles on both sides
    for (let j = 1; j <= lookback; j++) {
      // Check left side
      const leftCandle = candles[i - j];
      const rightCandle = candles[i + j];

      if (leftCandle) {
        if (leftCandle.high >= currentHigh) isSwingHigh = false;
        if (leftCandle.low <= currentLow) isSwingLow = false;
      }

      // Check right side
      if (rightCandle) {
        if (rightCandle.high >= currentHigh) isSwingHigh = false;
        if (rightCandle.low <= currentLow) isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      swingPoints.push({ index: i, price: currentHigh, type: "high" });
    }

    if (isSwingLow) {
      swingPoints.push({ index: i, price: currentLow, type: "low" });
    }
  }

  return swingPoints;
}

/**
 * Cluster nearby price levels together
 *
 * @param swingPoints - Array of swing points
 * @param tolerance - Percentage tolerance for clustering (e.g., 0.005 = 0.5%)
 * @returns Clustered levels with touch counts
 */
function clusterLevels(
  swingPoints: SwingPoint[],
  tolerance: number
): { price: number; type: "support" | "resistance"; touches: number }[] {
  if (swingPoints.length === 0) return [];

  // Sort by price
  const sorted = [...swingPoints].sort((a, b) => a.price - b.price);

  const clusters: {
    prices: number[];
    types: ("high" | "low")[];
  }[] = [];

  const firstPoint = sorted[0];
  if (!firstPoint) return [];

  let currentCluster = {
    prices: [firstPoint.price],
    types: [firstPoint.type],
  };

  for (let i = 1; i < sorted.length; i++) {
    const point = sorted[i];
    if (!point) continue;

    const avgPrice =
      currentCluster.prices.reduce((a, b) => a + b, 0) /
      currentCluster.prices.length;
    const diff = Math.abs(point.price - avgPrice) / avgPrice;

    if (diff <= tolerance) {
      // Add to current cluster
      currentCluster.prices.push(point.price);
      currentCluster.types.push(point.type);
    } else {
      // Start new cluster
      clusters.push(currentCluster);
      currentCluster = {
        prices: [point.price],
        types: [point.type],
      };
    }
  }
  clusters.push(currentCluster);

  // Convert clusters to levels
  return clusters.map((cluster) => {
    const avgPrice =
      cluster.prices.reduce((a, b) => a + b, 0) / cluster.prices.length;

    // Determine type based on majority of swing points
    const highCount = cluster.types.filter((t) => t === "high").length;
    const lowCount = cluster.types.filter((t) => t === "low").length;
    const type = highCount > lowCount ? "resistance" : "support";

    return {
      price: avgPrice,
      type: type as "support" | "resistance",
      touches: cluster.prices.length,
    };
  });
}

/**
 * Count how many times price touched a level
 *
 * @param candles - Array of candles
 * @param level - Price level to check
 * @param tolerance - Percentage tolerance for touch detection
 * @returns Number of touches
 */
function countTouches(
  candles: Candle[],
  level: number,
  tolerance: number
): number {
  let touches = 0;
  const threshold = level * tolerance;

  for (const candle of candles) {
    // Check if candle high or low came within tolerance of level
    const highDiff = Math.abs(candle.high - level);
    const lowDiff = Math.abs(candle.low - level);

    if (highDiff <= threshold || lowDiff <= threshold) {
      touches++;
    }
  }

  return touches;
}

/**
 * Detect support and resistance levels from candle data
 *
 * Process:
 * 1. Find swing highs and lows
 * 2. Cluster nearby levels
 * 3. Calculate strength based on touch count
 *
 * @param candles - Array of candle data (oldest first)
 * @param sensitivity - Lookback for swing detection (default: 3, higher = fewer levels)
 * @returns Array of detected levels with strength scores
 */
export function detectLevels(candles: Candle[], sensitivity: number = 3): Level[] {
  if (candles.length < sensitivity * 2 + 1) {
    return [];
  }

  // Find swing points
  const swingPoints = detectSwingPoints(candles, sensitivity);

  if (swingPoints.length === 0) {
    return [];
  }

  // Cluster nearby levels (0.5% tolerance)
  const clusteredLevels = clusterLevels(swingPoints, 0.005);

  // Count actual touches on the price data
  const levelsWithTouches = clusteredLevels.map((level) => ({
    ...level,
    touches: countTouches(candles, level.price, 0.005),
  }));

  // Calculate strength score (0-1)
  // Strength based on number of touches, normalized
  const maxTouches = Math.max(...levelsWithTouches.map((l) => l.touches), 1);

  const levels: Level[] = levelsWithTouches.map((level) => ({
    price: level.price,
    type: level.type,
    touches: level.touches,
    strength: Math.min(level.touches / maxTouches, 1),
  }));

  // Sort by strength descending
  levels.sort((a, b) => b.strength - a.strength);

  return levels;
}

/**
 * Find the nearest support and resistance levels from current price
 *
 * @param levels - Array of detected levels
 * @param currentPrice - Current price
 * @returns Object with nearest support and resistance
 */
export function findNearestLevels(
  levels: Level[],
  currentPrice: number
): { support: Level | null; resistance: Level | null } {
  let nearestSupport: Level | null = null;
  let nearestResistance: Level | null = null;

  for (const level of levels) {
    if (level.price < currentPrice) {
      // Potential support
      if (!nearestSupport || level.price > nearestSupport.price) {
        nearestSupport = level;
      }
    } else if (level.price > currentPrice) {
      // Potential resistance
      if (!nearestResistance || level.price < nearestResistance.price) {
        nearestResistance = level;
      }
    }
  }

  return { support: nearestSupport, resistance: nearestResistance };
}

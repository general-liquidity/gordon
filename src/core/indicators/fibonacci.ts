/**
 * Fibonacci Retracement & Extension Levels
 * Identifies key support/resistance levels based on swing high/low
 */

import type { Candle } from "./types.ts";

export interface FibonacciLevel {
  ratio: number;
  price: number;
  label: string;
  isSupport: boolean;
  isResistance: boolean;
}

export interface FibonacciResult {
  swingHigh: number | null;
  swingLow: number | null;
  levels: FibonacciLevel[];
  trend: "uptrend" | "downtrend" | "neutral";
  nearestLevel: FibonacciLevel | null;
  interpretation: string;
}

export interface FibonacciExtensionResult {
  swingHigh: number | null;
  swingLow: number | null;
  levels: FibonacciLevel[];
  trend: "uptrend" | "downtrend" | "neutral";
  nearestLevel: FibonacciLevel | null;
  interpretation: string;
}

/** Standard Fibonacci retracement ratios */
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Standard Fibonacci extension ratios */
const FIB_EXTENSION_RATIOS = [1, 1.272, 1.618, 2.0, 2.618] as const;

/** Human-readable labels for retracement ratios */
const FIB_LABELS: Record<number, string> = {
  0: "0%",
  0.236: "23.6%",
  0.382: "38.2%",
  0.5: "50%",
  0.618: "61.8%",
  0.786: "78.6%",
  1: "100%",
};

/** Human-readable labels for extension ratios */
const FIB_EXT_LABELS: Record<number, string> = {
  1: "100%",
  1.272: "127.2%",
  1.618: "161.8%",
  2.0: "200%",
  2.618: "261.8%",
};

/**
 * Detect the swing high within the lookback window.
 * Returns the highest high among the given candles.
 */
function findSwingHigh(candles: Candle[]): number {
  let high = -Infinity;
  for (const candle of candles) {
    if (candle.high > high) {
      high = candle.high;
    }
  }
  return high;
}

/**
 * Detect the swing low within the lookback window.
 * Returns the lowest low among the given candles.
 */
function findSwingLow(candles: Candle[]): number {
  let low = Infinity;
  for (const candle of candles) {
    if (candle.low < low) {
      low = candle.low;
    }
  }
  return low;
}

/**
 * Determine trend direction based on where the current price sits
 * relative to the midpoint of the swing range.
 */
function determineTrend(
  price: number,
  swingHigh: number,
  swingLow: number,
): "uptrend" | "downtrend" | "neutral" {
  const midpoint = (swingHigh + swingLow) / 2;
  const range = swingHigh - swingLow;

  // If range is essentially zero, call it neutral
  if (range < Number.EPSILON) {
    return "neutral";
  }

  // Use a 5% dead zone around the midpoint to avoid false signals
  const threshold = range * 0.05;
  if (price > midpoint + threshold) {
    return "uptrend";
  } else if (price < midpoint - threshold) {
    return "downtrend";
  }
  return "neutral";
}

/**
 * Find the Fibonacci level closest to the current price.
 */
function findNearestLevel(levels: FibonacciLevel[], price: number): FibonacciLevel | null {
  if (levels.length === 0) return null;

  let nearest = levels[0]!;
  let minDistance = Math.abs(price - nearest.price);

  for (let i = 1; i < levels.length; i++) {
    const distance = Math.abs(price - levels[i]!.price);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = levels[i]!;
    }
  }

  return nearest ?? null;
}
/**
 * Calculate Fibonacci Retracement Levels
 *
 * Identifies swing high/low within a lookback window and computes
 * standard Fibonacci retracement levels (0%, 23.6%, 38.2%, 50%,
 * 61.8%, 78.6%, 100%).
 *
 * In an uptrend, retracement levels are measured from swing low to
 * swing high and act as potential support on pullbacks. In a downtrend,
 * they are measured from swing high to swing low and act as potential
 * resistance on rallies.
 *
 * @param candles - Array of OHLCV candles
 * @param lookbackPeriod - Number of candles to search for swing points (default 50)
 * @param currentPrice - Current market price for position calculation
 * @returns FibonacciResult with levels and interpretation
 */
export function calculateFibonacci(
  candles: Candle[],
  lookbackPeriod: number = 50,
  currentPrice?: number,
): FibonacciResult {
  if (candles.length < 2) {
    return {
      swingHigh: null,
      swingLow: null,
      levels: [],
      trend: "neutral",
      nearestLevel: null,
      interpretation: "Insufficient data for Fibonacci calculation",
    };
  }

  // Use at most lookbackPeriod candles from the end
  const window = candles.slice(-lookbackPeriod);

  const swingHigh = findSwingHigh(window);
  const swingLow = findSwingLow(window);

  // If swing high equals swing low, we have no range to work with
  if (swingHigh === swingLow) {
    return {
      swingHigh,
      swingLow,
      levels: [],
      trend: "neutral",
      nearestLevel: null,
      interpretation:
        "No price range detected -- swing high equals swing low, Fibonacci levels cannot be computed",
    };
  }

  const lastCandle = candles[candles.length - 1];
  const price = currentPrice ?? lastCandle?.close ?? 0;
  const trend = determineTrend(price, swingHigh, swingLow);
  const range = swingHigh - swingLow;

  // Build Fibonacci levels
  const levels: FibonacciLevel[] = FIB_RATIOS.map((ratio) => {
    // In an uptrend: retracement goes DOWN from the high
    // level = swingHigh - ratio * range  (0% = high, 100% = low)
    // In a downtrend: retracement goes UP from the low
    // level = swingLow + ratio * range   (0% = low, 100% = high)
    let levelPrice: number;
    if (trend === "downtrend") {
      levelPrice = swingLow + ratio * range;
    } else {
      // uptrend or neutral -- measure from high downward
      levelPrice = swingHigh - ratio * range;
    }

    return {
      ratio,
      price: levelPrice,
      label: FIB_LABELS[ratio] ?? `${(ratio * 100).toFixed(1)}%`,
      isSupport: trend === "uptrend" && price > levelPrice,
      isResistance: trend === "downtrend" && price < levelPrice,
    };
  });

  const nearestLevel = findNearestLevel(levels, price);

  // Generate interpretation
  const interpretation = buildRetracementInterpretation(
    price,
    swingHigh,
    swingLow,
    trend,
    nearestLevel,
    range,
  );

  return {
    swingHigh,
    swingLow,
    levels,
    trend,
    nearestLevel,
    interpretation,
  };
}
/**
 * Build a human-readable interpretation string for Fibonacci retracement.
 */
function buildRetracementInterpretation(
  price: number,
  swingHigh: number,
  swingLow: number,
  trend: "uptrend" | "downtrend" | "neutral",
  nearestLevel: FibonacciLevel | null,
  range: number,
): string {
  if (!nearestLevel) {
    return "Unable to determine Fibonacci levels";
  }

  const distancePct = ((Math.abs(price - nearestLevel.price) / range) * 100).toFixed(1);

  if (trend === "uptrend") {
    return (
      `Uptrend detected (range ${swingLow.toFixed(2)}-${swingHigh.toFixed(2)}). ` +
      `Price is near the ${nearestLevel.label} retracement level at ${nearestLevel.price.toFixed(2)} ` +
      `(${distancePct}% of range away). ` +
      `Key support: 38.2% and 61.8% retracement levels. ` +
      `A hold above 61.8% suggests the uptrend remains intact.`
    );
  } else if (trend === "downtrend") {
    return (
      `Downtrend detected (range ${swingLow.toFixed(2)}-${swingHigh.toFixed(2)}). ` +
      `Price is near the ${nearestLevel.label} retracement level at ${nearestLevel.price.toFixed(2)} ` +
      `(${distancePct}% of range away). ` +
      `Key resistance: 38.2% and 61.8% retracement levels. ` +
      `A rejection at 61.8% confirms continued downward pressure.`
    );
  }

  return (
    `Neutral/sideways range ${swingLow.toFixed(2)}-${swingHigh.toFixed(2)}. ` +
    `Price is near the ${nearestLevel.label} level at ${nearestLevel.price.toFixed(2)} ` +
    `(${distancePct}% of range away). ` +
    `Watch for a breakout above ${swingHigh.toFixed(2)} or breakdown below ${swingLow.toFixed(2)} for directional confirmation.`
  );
}
/**
 * Calculate Fibonacci Extension Levels
 *
 * Extension levels project potential price targets beyond the
 * swing range (127.2%, 161.8%, 200%, 261.8%). These are commonly
 * used as take-profit targets when price breaks out of a range.
 *
 * @param candles - Array of OHLCV candles
 * @param lookbackPeriod - Number of candles to search for swing points (default 50)
 * @param currentPrice - Current market price for position calculation
 * @returns FibonacciExtensionResult with extension levels and interpretation
 */
export function calculateFibonacciExtensions(
  candles: Candle[],
  lookbackPeriod: number = 50,
  currentPrice?: number,
): FibonacciExtensionResult {
  if (candles.length < 2) {
    return {
      swingHigh: null,
      swingLow: null,
      levels: [],
      trend: "neutral",
      nearestLevel: null,
      interpretation: "Insufficient data for Fibonacci extension calculation",
    };
  }

  const window = candles.slice(-lookbackPeriod);

  const swingHigh = findSwingHigh(window);
  const swingLow = findSwingLow(window);

  if (swingHigh === swingLow) {
    return {
      swingHigh,
      swingLow,
      levels: [],
      trend: "neutral",
      nearestLevel: null,
      interpretation:
        "No price range detected -- swing high equals swing low, Fibonacci extensions cannot be computed",
    };
  }

  const lastCandle = candles[candles.length - 1];
  const price = currentPrice ?? lastCandle?.close ?? 0;
  const trend = determineTrend(price, swingHigh, swingLow);
  const range = swingHigh - swingLow;

  // Build extension levels
  const levels: FibonacciLevel[] = FIB_EXTENSION_RATIOS.map((ratio) => {
    // In an uptrend: extensions project ABOVE the swing high
    // level = swingLow + ratio * range
    // In a downtrend: extensions project BELOW the swing low
    // level = swingHigh - ratio * range
    let levelPrice: number;
    if (trend === "downtrend") {
      levelPrice = swingHigh - ratio * range;
    } else {
      // uptrend or neutral
      levelPrice = swingLow + ratio * range;
    }

    return {
      ratio,
      price: levelPrice,
      label: FIB_EXT_LABELS[ratio] ?? `${(ratio * 100).toFixed(1)}%`,
      isSupport: trend === "uptrend" && price > levelPrice,
      isResistance: trend === "downtrend" && price < levelPrice,
    };
  });

  const nearestLevel = findNearestLevel(levels, price);

  // Generate interpretation
  const interpretation = buildExtensionInterpretation(
    price,
    swingHigh,
    swingLow,
    trend,
    nearestLevel,
    levels,
  );

  return {
    swingHigh,
    swingLow,
    levels,
    trend,
    nearestLevel,
    interpretation,
  };
}
/**
 * Build a human-readable interpretation string for Fibonacci extensions.
 */
function buildExtensionInterpretation(
  price: number,
  swingHigh: number,
  swingLow: number,
  trend: "uptrend" | "downtrend" | "neutral",
  nearestLevel: FibonacciLevel | null,
  levels: FibonacciLevel[],
): string {
  if (!nearestLevel || levels.length === 0) {
    return "Unable to determine Fibonacci extension levels";
  }

  if (trend === "uptrend") {
    const nextTarget = levels.find((l) => l.price > price && l.ratio > 1);
    if (nextTarget) {
      return (
        `Uptrend extensions from ${swingLow.toFixed(2)}-${swingHigh.toFixed(2)} range. ` +
        `Next upside target: ${nextTarget.label} extension at ${nextTarget.price.toFixed(2)}. ` +
        `Consider partial profit-taking at 127.2% and 161.8% extension levels.`
      );
    }
    return (
      `Uptrend extensions from ${swingLow.toFixed(2)}-${swingHigh.toFixed(2)} range. ` +
      `Price has exceeded all standard extension targets -- momentum is very strong. ` +
      `Use trailing stops to protect gains.`
    );
  } else if (trend === "downtrend") {
    const nextTarget = levels.find((l) => l.price < price && l.ratio > 1);
    if (nextTarget) {
      return (
        `Downtrend extensions from ${swingHigh.toFixed(2)}-${swingLow.toFixed(2)} range. ` +
        `Next downside target: ${nextTarget.label} extension at ${nextTarget.price.toFixed(2)}. ` +
        `Watch for potential support at 127.2% and 161.8% extension levels.`
      );
    }
    return (
      `Downtrend extensions from ${swingHigh.toFixed(2)}-${swingLow.toFixed(2)} range. ` +
      `Price has exceeded all standard extension targets -- selling pressure is very strong. ` +
      `Wait for reversal confirmation before entering long positions.`
    );
  }

  return (
    `Neutral range ${swingLow.toFixed(2)}-${swingHigh.toFixed(2)}. ` +
    `Extension levels are plotted but trend direction is unclear. ` +
    `Wait for a decisive breakout to use extensions as profit targets.`
  );
}

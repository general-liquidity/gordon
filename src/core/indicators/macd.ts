/**
 * MACD (Moving Average Convergence Divergence) Indicator
 * Trend-following momentum indicator
 */

import { calculateEMA } from "./ema.ts";
import type { MACDResult } from "./types.ts";

function assertPrefixOnlyNulls(values: readonly (number | null)[], label: string): void {
  let seenValue = false;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null) {
      if (seenValue) {
        throw new Error(
          `${label} contains a mid-series null at index ${i}; signal-line alignment requires nulls to be prefix-only`,
        );
      }
      continue;
    }
    seenValue = true;
  }
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 *
 * MACD reveals trend direction and momentum by comparing fast and slow EMAs.
 * - Bullish: MACD crosses above signal line
 * - Bearish: MACD crosses below signal line
 * - Histogram shows momentum strength
 *
 * @param closes - Array of closing prices
 * @param fastPeriod - Fast EMA period (default 12)
 * @param slowPeriod - Slow EMA period (default 26)
 * @param signalPeriod - Signal line period (default 9)
 * @returns MACD result with lines, histogram, and signals
 */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const minRequired = slowPeriod + signalPeriod;

  if (closes.length < minRequired) {
    const nullArray = closes.map(() => null);
    return {
      macd: nullArray,
      signal: nullArray,
      histogram: nullArray,
      current: { macd: null, signal: null, histogram: null },
      trend: "neutral",
      crossover: "none",
      interpretation: "Insufficient data for MACD calculation",
    };
  }

  // Calculate fast and slow EMAs
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  // Calculate MACD line (fast EMA - slow EMA)
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const fast = fastEMA.values[i] ?? null;
    const slow = slowEMA.values[i] ?? null;
    if (fast !== null && slow !== null) {
      macdLine.push(fast - slow);
    } else {
      macdLine.push(null);
    }
  }

  // Calculate signal line (EMA of MACD line)
  assertPrefixOnlyNulls(macdLine, "MACD line");
  const validMacd = macdLine.filter((v): v is number => v !== null);
  const signalEMA = calculateEMA(validMacd, signalPeriod);

  // Align signal line with MACD line
  const signalLine: (number | null)[] = [];
  let signalIndex = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) {
      signalLine.push(null);
    } else {
      signalLine.push(signalEMA.values[signalIndex] ?? null);
      signalIndex++;
    }
  }
  if (signalIndex !== validMacd.length) {
    throw new Error(
      `MACD signal-line alignment mismatch: consumed ${signalIndex} values for ${validMacd.length} MACD points`,
    );
  }

  // Calculate histogram (MACD - Signal)
  const histogram: (number | null)[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    const m = macdLine[i] ?? null;
    const s = signalLine[i] ?? null;
    if (m !== null && s !== null) {
      histogram.push(m - s);
    } else {
      histogram.push(null);
    }
  }

  // Get current values
  const currentMacd = macdLine[macdLine.length - 1] ?? null;
  const currentSignal = signalLine[signalLine.length - 1] ?? null;
  const currentHistogram = histogram[histogram.length - 1] ?? null;
  const prevHistogram = histogram[histogram.length - 2] ?? null;

  // Determine trend
  let trend: "bullish" | "bearish" | "neutral" = "neutral";
  if (currentHistogram !== null) {
    if (currentHistogram > 0) {
      trend = "bullish";
    } else if (currentHistogram < 0) {
      trend = "bearish";
    }
  }

  // Detect crossover
  let crossover: "bullish_cross" | "bearish_cross" | "none" = "none";
  if (currentHistogram !== null && prevHistogram !== null) {
    if (currentHistogram > 0 && prevHistogram <= 0) {
      crossover = "bullish_cross";
    } else if (currentHistogram < 0 && prevHistogram >= 0) {
      crossover = "bearish_cross";
    }
  }

  // Generate interpretation
  let interpretation = "";
  if (crossover === "bullish_cross") {
    interpretation = "MACD bullish crossover - momentum shifting positive";
  } else if (crossover === "bearish_cross") {
    interpretation = "MACD bearish crossover - momentum shifting negative";
  } else if (trend === "bullish" && currentHistogram !== null) {
    if (prevHistogram !== null && currentHistogram > prevHistogram) {
      interpretation = "MACD bullish with expanding histogram - strong momentum";
    } else {
      interpretation = "MACD bullish but histogram contracting - momentum weakening";
    }
  } else if (trend === "bearish" && currentHistogram !== null) {
    if (prevHistogram !== null && currentHistogram < prevHistogram) {
      interpretation = "MACD bearish with expanding histogram - strong selling pressure";
    } else {
      interpretation = "MACD bearish but histogram contracting - selling pressure easing";
    }
  } else {
    interpretation = "MACD neutral - no clear momentum signal";
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
    current: {
      macd: currentMacd ?? null,
      signal: currentSignal ?? null,
      histogram: currentHistogram ?? null,
    },
    trend,
    crossover,
    interpretation,
  };
}

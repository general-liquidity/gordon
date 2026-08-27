/**
 * False Breakout Reversal Detection
 * Detects failed breakouts beyond support/resistance for counter-trend entries.
 * Uses wick ratio and volume confirmation.
 *
 * False Breakout Reversal implementation.
 */

import type { Candle } from "./types.ts";

export interface SRLevel {
  price: number;
  type: "support" | "resistance";
  strength: number; // Number of touches
}

export interface FalseBreakoutResult {
  /** Detected support levels */
  supportLevels: SRLevel[];
  /** Detected resistance levels */
  resistanceLevels: SRLevel[];
  /** Whether a false breakout was detected on the last bar */
  falseBreakout: boolean;
  /** Direction of the false breakout signal */
  signal: "bullish_reversal" | "bearish_reversal" | "none";
  /** The S/R level that was falsely broken */
  brokenLevel: number | null;
  /** Wick ratio (0-1): how much of the candle is wick vs body */
  wickRatio: number | null;
  /** Whether volume confirmed the reversal */
  volumeConfirmed: boolean;
  /** Confidence score 0-100 */
  confidence: number;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Find support/resistance levels using rolling high/low
 */
function findSRLevels(
  candles: Candle[],
  lookback: number,
  tolerance: number,
): { supports: SRLevel[]; resistances: SRLevel[] } {
  const supports: { price: number; count: number }[] = [];
  const resistances: { price: number; count: number }[] = [];

  // Find local lows (supports) and highs (resistances)
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isLow = true;
    let isHigh = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j]!.low <= candles[i]!.low) isLow = false;
      if (candles[j]!.high >= candles[i]!.high) isHigh = false;
    }

    if (isLow) {
      // Check if near existing support
      let merged = false;
      for (const s of supports) {
        if (Math.abs(s.price - candles[i]!.low) / s.price < tolerance) {
          s.price = (s.price * s.count + candles[i]!.low) / (s.count + 1);
          s.count++;
          merged = true;
          break;
        }
      }
      if (!merged) {
        supports.push({ price: candles[i]!.low, count: 1 });
      }
    }

    if (isHigh) {
      let merged = false;
      for (const r of resistances) {
        if (Math.abs(r.price - candles[i]!.high) / r.price < tolerance) {
          r.price = (r.price * r.count + candles[i]!.high) / (r.count + 1);
          r.count++;
          merged = true;
          break;
        }
      }
      if (!merged) {
        resistances.push({ price: candles[i]!.high, count: 1 });
      }
    }
  }

  return {
    supports: supports.map((s) => ({
      price: parseFloat(s.price.toFixed(4)),
      type: "support" as const,
      strength: s.count,
    })),
    resistances: resistances.map((r) => ({
      price: parseFloat(r.price.toFixed(4)),
      type: "resistance" as const,
      strength: r.count,
    })),
  };
}

/**
 * Calculate wick ratio for a candle.
 * Returns the proportion of the candle that is wick (vs body).
 */
function calcWickRatio(candle: Candle): { total: number; upper: number; lower: number } {
  const totalRange = candle.high - candle.low;
  if (totalRange < 1e-10) return { total: 0, upper: 0, lower: 0 };

  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  return {
    total: (totalRange - body) / totalRange,
    upper: upperWick / totalRange,
    lower: lowerWick / totalRange,
  };
}

/**
 * Calculate average volume over a window
 */
function avgVolume(candles: Candle[], endIdx: number, window: number): number {
  let sum = 0;
  const start = Math.max(0, endIdx - window);
  for (let i = start; i < endIdx; i++) {
    sum += candles[i]!.volume;
  }
  return sum / (endIdx - start);
}

/**
 * Detect false breakouts.
 *
 * @param candles - OHLCV candle array
 * @param srLookback - Window for S/R pivot detection (default 5)
 * @param breakoutThreshold - Min % beyond level to count as breakout (default 0.001 = 0.1%)
 * @param wickThreshold - Min wick ratio for reversal candle (default 0.6)
 * @param volumeMultiplier - Volume must be N× average for confirmation (default 1.2)
 * @param tolerance - Price tolerance for merging S/R levels (default 0.005 = 0.5%)
 * @returns FalseBreakoutResult
 */
export function calculateFalseBreakout(
  candles: Candle[],
  srLookback: number = 5,
  breakoutThreshold: number = 0.001,
  wickThreshold: number = 0.6,
  volumeMultiplier: number = 1.2,
  tolerance: number = 0.005,
): FalseBreakoutResult {
  const emptyResult: FalseBreakoutResult = {
    supportLevels: [],
    resistanceLevels: [],
    falseBreakout: false,
    signal: "none",
    brokenLevel: null,
    wickRatio: null,
    volumeConfirmed: false,
    confidence: 0,
    interpretation: "Insufficient data for false breakout detection",
  };

  if (candles.length < srLookback * 2 + 5) return emptyResult;

  // Find S/R levels (exclude last few candles for detection)
  const { supports, resistances } = findSRLevels(
    candles.slice(0, -2), // Exclude last 2 bars from S/R detection
    srLookback,
    tolerance,
  );

  if (supports.length === 0 && resistances.length === 0) {
    return {
      ...emptyResult,
      interpretation: "No support/resistance levels found",
    };
  }

  const lastBar = candles[candles.length - 1]!;
  const prevBar = candles[candles.length - 2]!;
  const wick = calcWickRatio(lastBar);
  const avgVol = avgVolume(candles, candles.length - 1, 20);
  const volSpike = avgVol > 0 ? lastBar.volume / avgVol : 1;
  const volumeConfirmed = volSpike >= volumeMultiplier;

  let falseBreakout = false;
  let signal: "bullish_reversal" | "bearish_reversal" | "none" = "none";
  let brokenLevel: number | null = null;
  let confidence = 0;

  // Check for false breakout above resistance (bearish reversal)
  for (const r of resistances) {
    const breakoutDist = (lastBar.high - r.price) / r.price;
    if (
      breakoutDist > breakoutThreshold && // Broke above resistance
      lastBar.close < r.price && // But closed back below
      wick.upper >= wickThreshold * 0.5 // Significant upper wick
    ) {
      falseBreakout = true;
      signal = "bearish_reversal";
      brokenLevel = r.price;
      confidence = 30;
      if (wick.upper >= wickThreshold * 0.8) confidence += 20;
      if (volumeConfirmed) confidence += 20;
      if (r.strength >= 2) confidence += 15;
      if (prevBar.close < r.price) confidence += 15; // Prev bar was below too
      confidence = Math.min(100, confidence);
      break;
    }
  }

  // Check for false breakout below support (bullish reversal)
  if (!falseBreakout) {
    for (const s of supports) {
      const breakoutDist = (s.price - lastBar.low) / s.price;
      if (
        breakoutDist > breakoutThreshold && // Broke below support
        lastBar.close > s.price && // But closed back above
        wick.lower >= wickThreshold * 0.5 // Significant lower wick
      ) {
        falseBreakout = true;
        signal = "bullish_reversal";
        brokenLevel = s.price;
        confidence = 30;
        if (wick.lower >= wickThreshold * 0.8) confidence += 20;
        if (volumeConfirmed) confidence += 20;
        if (s.strength >= 2) confidence += 15;
        if (prevBar.close > s.price) confidence += 15;
        confidence = Math.min(100, confidence);
        break;
      }
    }
  }

  const interpretation = buildFalseBreakoutInterpretation(
    falseBreakout,
    signal,
    brokenLevel,
    wick.total,
    volumeConfirmed,
    volSpike,
    confidence,
    supports.length,
    resistances.length,
  );

  return {
    supportLevels: supports,
    resistanceLevels: resistances,
    falseBreakout,
    signal,
    brokenLevel,
    wickRatio: parseFloat(wick.total.toFixed(3)),
    volumeConfirmed,
    confidence,
    interpretation,
  };
}

function buildFalseBreakoutInterpretation(
  detected: boolean,
  signal: string,
  level: number | null,
  wickRatio: number,
  volConfirmed: boolean,
  volSpike: number,
  confidence: number,
  supportCount: number,
  resistCount: number,
): string {
  let msg = `S/R levels: ${supportCount} supports, ${resistCount} resistances. `;

  if (!detected) {
    msg += "No false breakout detected on current bar.";
    return msg;
  }

  msg += `FALSE BREAKOUT ${signal === "bullish_reversal" ? "below support" : "above resistance"} at ${level?.toFixed(2)}. `;
  msg += `Signal: ${signal.replace("_", " ").toUpperCase()}. `;
  msg += `Wick ratio: ${(wickRatio * 100).toFixed(0)}%. `;
  msg += volConfirmed
    ? `Volume confirmed (${volSpike.toFixed(1)}× average). `
    : `Volume not confirmed (${volSpike.toFixed(1)}× average). `;
  msg += `Confidence: ${confidence}%. `;

  if (confidence >= 70) {
    msg += "High-confidence reversal signal.";
  } else if (confidence >= 40) {
    msg += "Moderate confidence — wait for additional confirmation.";
  } else {
    msg += "Low confidence — likely noise.";
  }

  return msg;
}

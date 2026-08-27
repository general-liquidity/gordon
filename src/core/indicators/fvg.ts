/**
 * Fair Value Gap (FVG) Detection
 * 3-bar gap pattern where bar[i].low > bar[i-2].high (bullish) or
 * bar[i].high < bar[i-2].low (bearish). Volume confirmation.
 *
 * FVG Volumatic implementation.
 */

import type { Candle } from "./types.ts";

export interface FVGap {
  /** Gap type */
  type: "bullish" | "bearish";
  /** Upper boundary of the gap */
  high: number;
  /** Lower boundary of the gap */
  low: number;
  /** Gap size as percentage of midpoint */
  gapPct: number;
  /** Bar index where gap was detected */
  bar: number;
  /** Whether the gap has been filled (mitigated) */
  filled: boolean;
  /** Volume confirmation (above average) */
  volumeConfirmed: boolean;
  /** Buy volume ratio at the gap bar */
  buyRatio: number;
}

export interface FVGResult {
  /** Active (unfilled) bullish FVGs */
  bullishGaps: FVGap[];
  /** Active (unfilled) bearish FVGs */
  bearishGaps: FVGap[];
  /** Whether a new FVG was just created */
  newGap: boolean;
  /** Type of newest gap */
  newGapType: "bullish" | "bearish" | "none";
  /** Nearest unfilled bullish FVG below price */
  nearestBullishFVG: FVGap | null;
  /** Nearest unfilled bearish FVG above price */
  nearestBearishFVG: FVGap | null;
  /** Total unfilled gaps count */
  unfilledCount: number;
  /** Signal */
  signal: "buy" | "sell" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate Fair Value Gaps.
 *
 * @param candles - OHLCV candle array
 * @param minGapPct - Minimum gap size as percentage (default 0.5%)
 * @param volumeMultiplier - Volume must be N× average for confirmation (default 1.2)
 * @param buyRatioThreshold - Min buy ratio for bullish / max for bearish (default 0.6)
 * @returns FVGResult
 */
export function calculateFVG(
  candles: Candle[],
  minGapPct: number = 0.005,
  volumeMultiplier: number = 1.2,
  buyRatioThreshold: number = 0.6,
): FVGResult {
  if (candles.length < 25) {
    return {
      bullishGaps: [],
      bearishGaps: [],
      newGap: false,
      newGapType: "none",
      nearestBullishFVG: null,
      nearestBearishFVG: null,
      unfilledCount: 0,
      signal: "neutral",
      interpretation: "Insufficient data for FVG detection",
    };
  }

  // Volume moving average (20-period)
  const volSma: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < 19) {
      volSma.push(candles[i]!.volume);
    } else {
      let sum = 0;
      for (let j = i - 19; j <= i; j++) sum += candles[j]!.volume;
      volSma.push(sum / 20);
    }
  }

  const allGaps: FVGap[] = [];
  const lastBar = candles.length - 1;
  const currentPrice = candles[lastBar]!.close;

  // Scan for 3-bar FVG patterns
  for (let i = 2; i < candles.length; i++) {
    const bar0 = candles[i - 2]!; // Two bars ago
    const bar2 = candles[i]!; // Current bar in pattern

    // Buy ratio for bar2
    const candleRange = bar2.high - bar2.low;
    const buyRatio = candleRange > 1e-10 ? (bar2.close - bar2.low) / candleRange : 0.5;

    // Volume confirmation
    const volConfirmed = bar2.volume >= volSma[i]! * volumeMultiplier;

    // Bullish FVG: bar[i].low > bar[i-2].high (gap up)
    if (bar2.low > bar0.high) {
      const gapMid = (bar2.low + bar0.high) / 2;
      const gapPct = (bar2.low - bar0.high) / gapMid;

      if (gapPct >= minGapPct) {
        allGaps.push({
          type: "bullish",
          high: bar2.low,
          low: bar0.high,
          gapPct: parseFloat((gapPct * 100).toFixed(3)),
          bar: i,
          filled: false,
          volumeConfirmed: volConfirmed && buyRatio >= buyRatioThreshold,
          buyRatio: parseFloat(buyRatio.toFixed(3)),
        });
      }
    }

    // Bearish FVG: bar[i].high < bar[i-2].low (gap down)
    if (bar2.high < bar0.low) {
      const gapMid = (bar0.low + bar2.high) / 2;
      const gapPct = (bar0.low - bar2.high) / gapMid;

      if (gapPct >= minGapPct) {
        allGaps.push({
          type: "bearish",
          high: bar0.low,
          low: bar2.high,
          gapPct: parseFloat((gapPct * 100).toFixed(3)),
          bar: i,
          filled: false,
          volumeConfirmed: volConfirmed && buyRatio <= 1 - buyRatioThreshold,
          buyRatio: parseFloat(buyRatio.toFixed(3)),
        });
      }
    }
  }

  // Check if gaps have been filled (price crossed midpoint)
  for (const gap of allGaps) {
    const mid = (gap.high + gap.low) / 2;
    for (let j = gap.bar + 1; j < candles.length; j++) {
      if (gap.type === "bullish" && candles[j]!.low <= mid) {
        gap.filled = true;
        break;
      }
      if (gap.type === "bearish" && candles[j]!.high >= mid) {
        gap.filled = true;
        break;
      }
    }
  }

  // Filter active gaps
  const activeGaps = allGaps.filter((g) => !g.filled);
  const bullishGaps = activeGaps.filter((g) => g.type === "bullish").slice(-10);
  const bearishGaps = activeGaps.filter((g) => g.type === "bearish").slice(-10);

  // Nearest gaps
  let nearestBullishFVG: FVGap | null = null;
  let minBullDist = Infinity;
  for (const g of bullishGaps) {
    const dist = currentPrice - g.high;
    if (dist > 0 && dist < minBullDist) {
      minBullDist = dist;
      nearestBullishFVG = g;
    }
  }

  let nearestBearishFVG: FVGap | null = null;
  let minBearDist = Infinity;
  for (const g of bearishGaps) {
    const dist = g.low - currentPrice;
    if (dist > 0 && dist < minBearDist) {
      minBearDist = dist;
      nearestBearishFVG = g;
    }
  }

  // New gap detection
  const recentGaps = allGaps.filter((g) => g.bar >= lastBar - 1 && !g.filled);
  const newGap = recentGaps.length > 0;
  const newGapType = newGap ? recentGaps[recentGaps.length - 1]!.type : "none";

  // Signal
  let signal: "buy" | "sell" | "neutral" = "neutral";
  if (newGap && newGapType === "bullish" && recentGaps[recentGaps.length - 1]!.volumeConfirmed)
    signal = "buy";
  else if (newGap && newGapType === "bearish" && recentGaps[recentGaps.length - 1]!.volumeConfirmed)
    signal = "sell";

  const interpretation = buildFVGInterpretation(
    bullishGaps.length,
    bearishGaps.length,
    nearestBullishFVG,
    nearestBearishFVG,
    currentPrice,
    newGap,
    newGapType,
    signal,
  );

  return {
    bullishGaps,
    bearishGaps,
    newGap,
    newGapType: newGapType as "bullish" | "bearish" | "none",
    nearestBullishFVG,
    nearestBearishFVG,
    unfilledCount: activeGaps.length,
    signal,
    interpretation,
  };
}

function buildFVGInterpretation(
  bullCount: number,
  bearCount: number,
  nearBull: FVGap | null,
  nearBear: FVGap | null,
  _price: number,
  newGap: boolean,
  newType: string,
  signal: string,
): string {
  let msg = `FVG: ${bullCount} bullish, ${bearCount} bearish unfilled gaps. `;

  if (nearBull) {
    msg += `Nearest bullish FVG: ${nearBull.low.toFixed(2)}-${nearBull.high.toFixed(2)} (${nearBull.gapPct}% gap). `;
  }
  if (nearBear) {
    msg += `Nearest bearish FVG: ${nearBear.low.toFixed(2)}-${nearBear.high.toFixed(2)} (${nearBear.gapPct}% gap). `;
  }

  if (newGap) {
    msg += `NEW ${newType.toUpperCase()} FVG detected. `;
    if (signal !== "neutral") {
      msg += `Volume confirmed — ${signal.toUpperCase()} signal.`;
    } else {
      msg += "No volume confirmation.";
    }
  } else {
    msg += "No new FVGs on current bar.";
  }

  return msg;
}

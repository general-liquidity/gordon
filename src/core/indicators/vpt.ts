/**
 * Volume Price Trend (VPT)
 * Cumulative indicator combining volume with price change percentage.
 * Rising VPT confirms uptrend, falling VPT confirms downtrend.
 * Divergence between VPT and price = potential reversal.
 *
 * VPT implementation.
 */

import type { Candle } from "./types.ts";

export interface VPTResult {
  /** Current VPT value */
  current: number | null;
  /** VPT moving average */
  currentMA: number | null;
  /** VPT series */
  values: number[];
  /** VPT slope (recent direction) */
  slope: number | null;
  /** Trend confirmation */
  trend: "bullish" | "bearish" | "neutral";
  /** VPT vs price divergence */
  divergence: "bullish_divergence" | "bearish_divergence" | "none";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate Volume Price Trend.
 *
 * @param candles - OHLCV candle array
 * @param maPeriod - VPT moving average period (default 14)
 * @param slopeLookback - Bars for slope calculation (default 5)
 * @returns VPTResult
 */
export function calculateVPT(
  candles: Candle[],
  maPeriod: number = 14,
  slopeLookback: number = 5,
): VPTResult {
  if (candles.length < maPeriod + 5) {
    return {
      current: null,
      currentMA: null,
      values: [],
      slope: null,
      trend: "neutral",
      divergence: "none",
      interpretation: "Insufficient data for VPT calculation",
    };
  }

  // Calculate VPT: cumulative sum of Volume × (Close - PrevClose) / PrevClose
  const vptValues: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1]!.close;
    const priceChangePct = prevClose > 0 ? (candles[i]!.close - prevClose) / prevClose : 0;
    vptValues.push(vptValues[vptValues.length - 1]! + candles[i]!.volume * priceChangePct);
  }

  // VPT moving average
  const vptMA: (number | null)[] = [];
  for (let i = 0; i < vptValues.length; i++) {
    if (i < maPeriod - 1) {
      vptMA.push(null);
    } else {
      let sum = 0;
      for (let j = i - maPeriod + 1; j <= i; j++) sum += vptValues[j]!;
      vptMA.push(sum / maPeriod);
    }
  }

  const current = vptValues[vptValues.length - 1]!;
  const currentMA = vptMA[vptMA.length - 1] ?? null;

  // Slope: linear regression over lookback
  let slope: number | null = null;
  if (vptValues.length >= slopeLookback) {
    const recent = vptValues.slice(-slopeLookback);
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;
    const n = recent.length;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += recent[i]!;
      sumXY += i * recent[i]!;
      sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;

    // Normalize by average absolute VPT
    const avgAbs = Math.abs(sumY / n);
    if (avgAbs > 1e-10) slope = slope / avgAbs;
  }

  // Trend
  let trend: "bullish" | "bearish" | "neutral" = "neutral";
  if (slope !== null) {
    if (slope > 0.001) trend = "bullish";
    else if (slope < -0.001) trend = "bearish";
  }

  // Divergence: compare price direction vs VPT direction over lookback
  let divergence: "bullish_divergence" | "bearish_divergence" | "none" = "none";
  if (candles.length >= slopeLookback * 2 && vptValues.length >= slopeLookback * 2) {
    const recentPriceHigh = Math.max(...candles.slice(-slopeLookback).map((c) => c.high));
    const prevPriceHigh = Math.max(
      ...candles.slice(-slopeLookback * 2, -slopeLookback).map((c) => c.high),
    );
    const recentPriceLow = Math.min(...candles.slice(-slopeLookback).map((c) => c.low));
    const prevPriceLow = Math.min(
      ...candles.slice(-slopeLookback * 2, -slopeLookback).map((c) => c.low),
    );

    const recentVPTMax = Math.max(...vptValues.slice(-slopeLookback));
    const prevVPTMax = Math.max(...vptValues.slice(-slopeLookback * 2, -slopeLookback));
    const recentVPTMin = Math.min(...vptValues.slice(-slopeLookback));
    const prevVPTMin = Math.min(...vptValues.slice(-slopeLookback * 2, -slopeLookback));

    // Bearish divergence: price higher high but VPT lower high
    if (recentPriceHigh > prevPriceHigh && recentVPTMax < prevVPTMax) {
      divergence = "bearish_divergence";
    }
    // Bullish divergence: price lower low but VPT higher low
    if (recentPriceLow < prevPriceLow && recentVPTMin > prevVPTMin) {
      divergence = "bullish_divergence";
    }
  }

  const interpretation = buildVPTInterpretation(current, slope, trend, divergence);

  return {
    current: parseFloat(current.toFixed(2)),
    currentMA: currentMA !== null ? parseFloat(currentMA.toFixed(2)) : null,
    values: vptValues.map((v) => parseFloat(v.toFixed(2))),
    slope: slope !== null ? parseFloat(slope.toFixed(4)) : null,
    trend,
    divergence,
    interpretation,
  };
}

function buildVPTInterpretation(
  current: number,
  slope: number | null,
  trend: string,
  divergence: string,
): string {
  let msg = `VPT: ${current.toFixed(0)} (slope: ${slope?.toFixed(4) ?? "N/A"}). `;
  msg += `Trend: ${trend.toUpperCase()}. `;

  if (divergence !== "none") {
    msg +=
      divergence === "bullish_divergence"
        ? "BULLISH DIVERGENCE — price lower low but VPT higher low. Potential reversal up."
        : "BEARISH DIVERGENCE — price higher high but VPT lower high. Potential reversal down.";
  } else {
    msg +=
      trend === "bullish"
        ? "Volume confirming upward price movement."
        : trend === "bearish"
          ? "Volume confirming downward price movement."
          : "No clear volume-price confirmation.";
  }

  return msg;
}

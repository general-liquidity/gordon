/**
 * Volume Profile Indicator
 * Displays volume distribution across price levels to identify key
 * support/resistance zones, Point of Control (POC), and Value Area.
 */

import type { Candle } from "./types.ts";

export interface ProfileBin {
  priceLevel: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  percentage: number;
}

export interface VolumeProfileResult {
  poc: number | null;
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
  profileBins: ProfileBin[];
  pricePosition: "above_va" | "in_va" | "below_va";
  interpretation: string;
}

/**
 * Calculate Volume Profile
 *
 * Divides the price range into equal-sized bins and distributes each
 * candle's volume into the bin containing its typical price
 * ((High + Low + Close) / 3). Identifies:
 *
 * - **POC (Point of Control)**: The price level with the highest traded volume.
 *   Acts as a magnet -- price tends to gravitate toward it.
 * - **Value Area (70% of volume)**: The price range where 70% of trading
 *   occurred, representing "fair value". Prices outside the VA tend to
 *   revert back inside.
 *
 * @param candles - Array of OHLCV candles
 * @param numBins - Number of price bins to divide the range into (default 24)
 * @param currentPrice - Current market price for position calculation
 * @returns VolumeProfileResult with POC, value area, bins, and interpretation
 */
export function calculateVolumeProfile(
  candles: Candle[],
  numBins: number = 24,
  currentPrice?: number
): VolumeProfileResult {
  if (candles.length < 1) {
    return {
      poc: null,
      valueAreaHigh: null,
      valueAreaLow: null,
      profileBins: [],
      pricePosition: "in_va",
      interpretation: "Insufficient data for Volume Profile calculation",
    };
  }

  // Find the overall price range across all candles
  let overallHigh = -Infinity;
  let overallLow = Infinity;

  for (const candle of candles) {
    if (candle.high > overallHigh) overallHigh = candle.high;
    if (candle.low < overallLow) overallLow = candle.low;
  }

  // If no range exists (all prices identical), return minimal result
  if (overallHigh === overallLow) {
    const totalVolume = candles.reduce((sum, c) => sum + c.volume, 0);
    const buyVol = candles
      .filter((c) => c.close > c.open)
      .reduce((sum, c) => sum + c.volume, 0);
    const sellVol = totalVolume - buyVol;

    const singleBin: ProfileBin = {
      priceLevel: overallHigh,
      volume: totalVolume,
      buyVolume: buyVol,
      sellVolume: sellVol,
      percentage: 100,
    };

    return {
      poc: overallHigh,
      valueAreaHigh: overallHigh,
      valueAreaLow: overallLow,
      profileBins: [singleBin],
      pricePosition: "in_va",
      interpretation:
        "All trading occurred at a single price level -- no meaningful volume distribution to analyze",
    };
  }

  // Clamp numBins to a sensible minimum
  const effectiveBins = Math.max(numBins, 1);

  const range = overallHigh - overallLow;
  const binSize = range / effectiveBins;

  // Initialize bins
  const bins: ProfileBin[] = [];
  for (let i = 0; i < effectiveBins; i++) {
    bins.push({
      priceLevel: overallLow + binSize * (i + 0.5), // center of bin
      volume: 0,
      buyVolume: 0,
      sellVolume: 0,
      percentage: 0,
    });
  }
  // Distribute candle volumes into bins
  let totalVolume = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;

    // Find the bin index for this typical price
    let binIndex = Math.floor((typicalPrice - overallLow) / binSize);

    // Clamp to valid range (handles edge case where typicalPrice === overallHigh)
    if (binIndex >= effectiveBins) binIndex = effectiveBins - 1;
    if (binIndex < 0) binIndex = 0;

    bins[binIndex]!.volume += candle.volume;
    totalVolume += candle.volume;

    // Classify as buy or sell volume based on candle direction
    if (candle.close > candle.open) {
      bins[binIndex]!.buyVolume += candle.volume;
    } else {
      bins[binIndex]!.sellVolume += candle.volume;
    }
  }

  // Calculate percentage of total volume for each bin
  if (totalVolume > 0) {
    for (const bin of bins) {
      bin.percentage = (bin.volume / totalVolume) * 100;
    }
  }

  // Find Point of Control (POC) -- bin with highest volume
  let pocIndex = 0;
  let maxVolume = 0;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i]!.volume > maxVolume) {
      maxVolume = bins[i]!.volume;
      pocIndex = i;
    }
  }

  const poc = bins[pocIndex]!.priceLevel;

  // Calculate Value Area (70% of total volume, expanding outward from POC)
  const { valueAreaHigh, valueAreaLow } = calculateValueArea(
    bins,
    pocIndex,
    totalVolume,
    binSize
  );

  // Determine current price position relative to value area
  const lastCandle = candles[candles.length - 1];
  const price = currentPrice ?? (lastCandle?.close ?? 0);
  const pricePosition = determinePricePosition(price, valueAreaHigh, valueAreaLow);

  // Generate interpretation
  const interpretation = buildInterpretation(
    price,
    poc,
    valueAreaHigh,
    valueAreaLow,
    pricePosition,
    bins[pocIndex]!
  );

  return {
    poc,
    valueAreaHigh,
    valueAreaLow,
    profileBins: bins,
    pricePosition,
    interpretation,
  };
}
/**
 * Calculate the Value Area -- the price range containing 70% of traded volume,
 * expanding outward from the POC bin.
 */
function calculateValueArea(
  bins: ProfileBin[],
  pocIndex: number,
  totalVolume: number,
  binSize: number
): { valueAreaHigh: number; valueAreaLow: number } {
  const targetVolume = totalVolume * 0.7;
  let accumulatedVolume = bins[pocIndex]!.volume;

  let upperIndex = pocIndex;
  let lowerIndex = pocIndex;

  // Expand outward from POC, adding whichever side has more volume
  while (accumulatedVolume < targetVolume) {
    const canGoUp = upperIndex + 1 < bins.length;
    const canGoDown = lowerIndex - 1 >= 0;

    if (!canGoUp && !canGoDown) break;

    const upperVolume = canGoUp ? bins[upperIndex + 1]!.volume : -1;
    const lowerVolume = canGoDown ? bins[lowerIndex - 1]!.volume : -1;

    if (upperVolume >= lowerVolume) {
      upperIndex++;
      accumulatedVolume += bins[upperIndex]!.volume;
    } else {
      lowerIndex--;
      accumulatedVolume += bins[lowerIndex]!.volume;
    }
  }

  // Value area boundaries are the edges of the outermost included bins
  const valueAreaHigh = bins[upperIndex]!.priceLevel + binSize / 2;
  const valueAreaLow = bins[lowerIndex]!.priceLevel - binSize / 2;

  return { valueAreaHigh, valueAreaLow };
}

/**
 * Determine whether the current price is above, inside, or below the Value Area.
 */
function determinePricePosition(
  price: number,
  vaHigh: number,
  vaLow: number
): "above_va" | "in_va" | "below_va" {
  if (price > vaHigh) return "above_va";
  if (price < vaLow) return "below_va";
  return "in_va";
}
/**
 * Build a human-readable interpretation of the Volume Profile.
 */
function buildInterpretation(
  price: number,
  poc: number,
  vaHigh: number,
  vaLow: number,
  position: "above_va" | "in_va" | "below_va",
  pocBin: ProfileBin
): string {
  const pocDistance = ((Math.abs(price - poc) / poc) * 100).toFixed(2);
  const buyRatio =
    pocBin.volume > 0
      ? ((pocBin.buyVolume / pocBin.volume) * 100).toFixed(1)
      : "0";

  if (position === "above_va") {
    return (
      `Price is above the Value Area (${vaLow.toFixed(2)}-${vaHigh.toFixed(2)}). ` +
      `POC at ${poc.toFixed(2)} (${pocDistance}% away, ${buyRatio}% buy volume). ` +
      `Trading above value suggests bullish momentum, but price may rotate back toward the ` +
      `Value Area High at ${vaHigh.toFixed(2)} if momentum fades. ` +
      `Watch for acceptance above VA as a sign of continued strength.`
    );
  }

  if (position === "below_va") {
    return (
      `Price is below the Value Area (${vaLow.toFixed(2)}-${vaHigh.toFixed(2)}). ` +
      `POC at ${poc.toFixed(2)} (${pocDistance}% away, ${buyRatio}% buy volume). ` +
      `Trading below value suggests bearish momentum, but price may rotate back toward the ` +
      `Value Area Low at ${vaLow.toFixed(2)} for a mean-reversion play. ` +
      `A move back inside the VA would be a bullish signal.`
    );
  }

  // in_va
  return (
    `Price is inside the Value Area (${vaLow.toFixed(2)}-${vaHigh.toFixed(2)}). ` +
    `POC at ${poc.toFixed(2)} (${pocDistance}% away, ${buyRatio}% buy volume at POC). ` +
    `Trading within value is balanced -- watch for a break above ${vaHigh.toFixed(2)} ` +
    `for bullish continuation or below ${vaLow.toFixed(2)} for bearish breakdown. ` +
    `POC acts as a magnet and key intraday pivot.`
  );
}

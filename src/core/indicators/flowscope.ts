/**
 * FlowScope — Buy/Sell Volume Profile Analysis
 * Splits volume into buy vs sell pressure at each price level.
 * Detects POC imbalance (one-sided volume dominance) for directional bias.
 *
 * Based on Moon Dev's FlowScope implementation.
 */

import type { Candle } from "./types.ts";

export interface FlowScopeBin {
  priceLevel: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  buyRatio: number;
  percentage: number;
}

export interface FlowScopeResult {
  /** Point of Control — price with highest volume */
  poc: number | null;
  /** Buy volume at POC */
  pocBuyVolume: number;
  /** Sell volume at POC */
  pocSellVolume: number;
  /** Buy ratio at POC (0-1) */
  pocBuyRatio: number;
  /** Whether POC is imbalanced (one-sided) */
  pocImbalanced: boolean;
  /** Direction of imbalance */
  imbalanceDirection: "buy" | "sell" | "neutral";
  /** Total buy volume across all levels */
  totalBuyVolume: number;
  /** Total sell volume across all levels */
  totalSellVolume: number;
  /** Overall buy ratio */
  overallBuyRatio: number;
  /** Volume-weighted buy pressure score: -100 (all sell) to +100 (all buy) */
  pressureScore: number;
  /** Value Area High (70% volume zone upper bound) */
  valueAreaHigh: number | null;
  /** Value Area Low (70% volume zone lower bound) */
  valueAreaLow: number | null;
  /** Profile bins for detailed view */
  bins: FlowScopeBin[];
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate FlowScope buy/sell volume profile.
 *
 * @param candles - OHLCV candle array
 * @param numBins - Number of price bins (default 20)
 * @param imbalanceThreshold - Buy ratio threshold for imbalance detection (default 0.65)
 * @returns FlowScopeResult
 */
export function calculateFlowScope(
  candles: Candle[],
  numBins: number = 20,
  imbalanceThreshold: number = 0.65
): FlowScopeResult {
  if (candles.length < 5) {
    return {
      poc: null,
      pocBuyVolume: 0,
      pocSellVolume: 0,
      pocBuyRatio: 0.5,
      pocImbalanced: false,
      imbalanceDirection: "neutral",
      totalBuyVolume: 0,
      totalSellVolume: 0,
      overallBuyRatio: 0.5,
      pressureScore: 0,
      valueAreaHigh: null,
      valueAreaLow: null,
      bins: [],
      interpretation: "Insufficient data for FlowScope analysis",
    };
  }

  // Find price range
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const c of candles) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }

  const range = maxPrice - minPrice;
  if (range < 1e-10) {
    return {
      poc: candles[candles.length - 1]!.close,
      pocBuyVolume: 0,
      pocSellVolume: 0,
      pocBuyRatio: 0.5,
      pocImbalanced: false,
      imbalanceDirection: "neutral",
      totalBuyVolume: 0,
      totalSellVolume: 0,
      overallBuyRatio: 0.5,
      pressureScore: 0,
      valueAreaHigh: null,
      valueAreaLow: null,
      bins: [],
      interpretation: "No price range for FlowScope analysis",
    };
  }

  const binSize = range / numBins;

  // Initialize bins
  const bins: { total: number; buy: number; sell: number }[] = [];
  for (let i = 0; i < numBins; i++) {
    bins.push({ total: 0, buy: 0, sell: 0 });
  }

  // Distribute volume into bins
  let totalBuyVolume = 0;
  let totalSellVolume = 0;

  for (const c of candles) {
    // Buy ratio: how close the close is to the high within the candle range
    const candleRange = c.high - c.low;
    const buyRatio = candleRange > 1e-10 ? (c.close - c.low) / candleRange : 0.5;
    const buyVol = c.volume * buyRatio;
    const sellVol = c.volume * (1 - buyRatio);

    totalBuyVolume += buyVol;
    totalSellVolume += sellVol;

    // Distribute across price bins the candle touches
    const lowBin = Math.max(0, Math.floor((c.low - minPrice) / binSize));
    const highBin = Math.min(numBins - 1, Math.floor((c.high - minPrice) / binSize));

    const numCandleBins = highBin - lowBin + 1;
    const volPerBin = c.volume / numCandleBins;
    const buyPerBin = buyVol / numCandleBins;
    const sellPerBin = sellVol / numCandleBins;

    for (let b = lowBin; b <= highBin; b++) {
      bins[b]!.total += volPerBin;
      bins[b]!.buy += buyPerBin;
      bins[b]!.sell += sellPerBin;
    }
  }

  // Find POC (bin with max volume)
  let pocIdx = 0;
  let maxVol = 0;
  const totalVolume = totalBuyVolume + totalSellVolume;

  for (let i = 0; i < numBins; i++) {
    if (bins[i]!.total > maxVol) {
      maxVol = bins[i]!.total;
      pocIdx = i;
    }
  }

  const poc = minPrice + (pocIdx + 0.5) * binSize;
  const pocBuyVolume = bins[pocIdx]!.buy;
  const pocSellVolume = bins[pocIdx]!.sell;
  const pocTotal = pocBuyVolume + pocSellVolume;
  const pocBuyRatio = pocTotal > 0 ? pocBuyVolume / pocTotal : 0.5;

  const pocImbalanced = pocBuyRatio >= imbalanceThreshold || pocBuyRatio <= (1 - imbalanceThreshold);
  const imbalanceDirection: "buy" | "sell" | "neutral" = pocBuyRatio >= imbalanceThreshold
    ? "buy"
    : pocBuyRatio <= (1 - imbalanceThreshold)
    ? "sell"
    : "neutral";

  const overallBuyRatio = totalVolume > 0 ? totalBuyVolume / totalVolume : 0.5;
  const pressureScore = parseFloat(((overallBuyRatio - 0.5) * 200).toFixed(1));

  // Calculate Value Area (70% of total volume centered on POC)
  const valueAreaTarget = totalVolume * 0.7;
  let vaVolume = bins[pocIdx]!.total;
  let vaLow = pocIdx;
  let vaHigh = pocIdx;

  while (vaVolume < valueAreaTarget && (vaLow > 0 || vaHigh < numBins - 1)) {
    const lowVol = vaLow > 0 ? bins[vaLow - 1]!.total : 0;
    const highVol = vaHigh < numBins - 1 ? bins[vaHigh + 1]!.total : 0;

    if (lowVol >= highVol && vaLow > 0) {
      vaLow--;
      vaVolume += bins[vaLow]!.total;
    } else if (vaHigh < numBins - 1) {
      vaHigh++;
      vaVolume += bins[vaHigh]!.total;
    } else if (vaLow > 0) {
      vaLow--;
      vaVolume += bins[vaLow]!.total;
    } else {
      break;
    }
  }

  const valueAreaLow = minPrice + vaLow * binSize;
  const valueAreaHigh = minPrice + (vaHigh + 1) * binSize;

  // Build output bins
  const outputBins: FlowScopeBin[] = [];
  for (let i = 0; i < numBins; i++) {
    const binTotal = bins[i]!.total;
    outputBins.push({
      priceLevel: parseFloat((minPrice + (i + 0.5) * binSize).toFixed(4)),
      totalVolume: parseFloat(binTotal.toFixed(2)),
      buyVolume: parseFloat(bins[i]!.buy.toFixed(2)),
      sellVolume: parseFloat(bins[i]!.sell.toFixed(2)),
      buyRatio: parseFloat((binTotal > 0 ? bins[i]!.buy / binTotal : 0.5).toFixed(3)),
      percentage: parseFloat((totalVolume > 0 ? (binTotal / totalVolume) * 100 : 0).toFixed(1)),
    });
  }

  const interpretation = buildFlowScopeInterpretation(
    poc,
    pocBuyRatio,
    pocImbalanced,
    imbalanceDirection,
    pressureScore,
    overallBuyRatio
  );

  return {
    poc: parseFloat(poc.toFixed(4)),
    pocBuyVolume: parseFloat(pocBuyVolume.toFixed(2)),
    pocSellVolume: parseFloat(pocSellVolume.toFixed(2)),
    pocBuyRatio: parseFloat(pocBuyRatio.toFixed(3)),
    pocImbalanced,
    imbalanceDirection,
    totalBuyVolume: parseFloat(totalBuyVolume.toFixed(2)),
    totalSellVolume: parseFloat(totalSellVolume.toFixed(2)),
    overallBuyRatio: parseFloat(overallBuyRatio.toFixed(3)),
    pressureScore,
    valueAreaHigh: parseFloat(valueAreaHigh.toFixed(4)),
    valueAreaLow: parseFloat(valueAreaLow.toFixed(4)),
    bins: outputBins,
    interpretation,
  };
}

function buildFlowScopeInterpretation(
  poc: number,
  pocBuyRatio: number,
  pocImbalanced: boolean,
  imbalanceDir: string,
  pressureScore: number,
  overallBuyRatio: number
): string {
  let msg = `POC at ${poc.toFixed(2)} (buy ratio: ${(pocBuyRatio * 100).toFixed(0)}%). `;

  if (pocImbalanced) {
    msg += `POC IMBALANCED toward ${imbalanceDir.toUpperCase()} — `;
    msg += imbalanceDir === "buy"
      ? "strong buying at key level, bullish. "
      : "strong selling at key level, bearish. ";
  } else {
    msg += "POC balanced — no dominant side. ";
  }

  msg += `Overall flow: ${pressureScore > 0 ? "+" : ""}${pressureScore.toFixed(0)} (`;
  if (Math.abs(pressureScore) > 30) {
    msg += pressureScore > 0 ? "strong buy pressure)" : "strong sell pressure)";
  } else if (Math.abs(pressureScore) > 10) {
    msg += pressureScore > 0 ? "moderate buy pressure)" : "moderate sell pressure)";
  } else {
    msg += "balanced)";
  }
  msg += `. Buy/Sell ratio: ${(overallBuyRatio * 100).toFixed(0)}%/${((1 - overallBuyRatio) * 100).toFixed(0)}%.`;

  return msg;
}

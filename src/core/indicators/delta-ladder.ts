/**
 * Delta Ladder
 * Buy/sell delta at each price level — order flow approximation from OHLCV.
 * Cumulative delta tracks net buying/selling pressure.
 * Delta divergence from price = potential reversal.
 *
 * Delta Ladder implementation.
 */

import type { Candle } from "./types.ts";

export interface DeltaLevel {
  priceLevel: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  percentage: number;
}

export interface DeltaLadderResult {
  /** Current bar delta (buy - sell) */
  currentDelta: number;
  /** Cumulative delta (running total) */
  cumulativeDelta: number;
  /** Delta ratio |delta| / volume (0-1, higher = more one-sided) */
  deltaRatio: number;
  /** Point of Control (highest volume price level) */
  poc: number | null;
  /** Cumulative delta series */
  cumulativeDeltaValues: number[];
  /** Delta per price level (for current lookback) */
  levels: DeltaLevel[];
  /** Delta trend */
  trend: "buying_pressure" | "selling_pressure" | "neutral";
  /** Delta reversal (cumulative delta flipped sign) */
  reversal: boolean;
  /** Signal */
  signal: "buy" | "sell" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate Delta Ladder.
 *
 * @param candles - OHLCV candle array
 * @param numLevels - Price levels to divide range into (default 10)
 * @param lookback - Candles for level analysis (default 50)
 * @returns DeltaLadderResult
 */
export function calculateDeltaLadder(
  candles: Candle[],
  numLevels: number = 10,
  lookback: number = 50,
): DeltaLadderResult {
  if (candles.length < 10) {
    return {
      currentDelta: 0,
      cumulativeDelta: 0,
      deltaRatio: 0,
      poc: null,
      cumulativeDeltaValues: [],
      levels: [],
      trend: "neutral",
      reversal: false,
      signal: "neutral",
      interpretation: "Insufficient data for Delta Ladder",
    };
  }

  // Calculate bar-by-bar delta
  const barDeltas: number[] = [];
  const cumDeltas: number[] = [];
  let cumDelta = 0;

  for (const c of candles) {
    // Estimate buy/sell split from candle structure
    let buyRatio: number;
    if (c.close > c.open) {
      buyRatio = 0.6; // Bullish candle: 60% buy
    } else if (c.close < c.open) {
      buyRatio = 0.4; // Bearish candle: 40% buy
    } else {
      buyRatio = 0.5;
    }

    const buyVol = c.volume * buyRatio;
    const sellVol = c.volume * (1 - buyRatio);
    const delta = buyVol - sellVol;

    barDeltas.push(delta);
    cumDelta += delta;
    cumDeltas.push(cumDelta);
  }

  // Price level analysis over lookback
  const recentCandles = candles.slice(-Math.min(lookback, candles.length));
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const c of recentCandles) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }

  const range = maxPrice - minPrice;
  const levelSize = range > 0 ? range / numLevels : 1;
  const levels: { buy: number; sell: number; total: number }[] = [];
  for (let i = 0; i < numLevels; i++) {
    levels.push({ buy: 0, sell: 0, total: 0 });
  }

  for (const c of recentCandles) {
    const buyRatio = c.close > c.open ? 0.6 : c.close < c.open ? 0.4 : 0.5;
    const buyVol = c.volume * buyRatio;
    const sellVol = c.volume * (1 - buyRatio);

    // Distribute to POC level (simplified — place at close)
    const levelIdx =
      range > 0
        ? Math.min(numLevels - 1, Math.max(0, Math.floor((c.close - minPrice) / levelSize)))
        : 0;
    levels[levelIdx]!.buy += buyVol;
    levels[levelIdx]!.sell += sellVol;
    levels[levelIdx]!.total += c.volume;
  }

  // Find POC
  let pocIdx = 0;
  let maxVol = 0;
  let totalVol = 0;
  for (let i = 0; i < numLevels; i++) {
    totalVol += levels[i]!.total;
    if (levels[i]!.total > maxVol) {
      maxVol = levels[i]!.total;
      pocIdx = i;
    }
  }

  const poc = range > 0 ? minPrice + (pocIdx + 0.5) * levelSize : null;

  // Build output levels
  const outputLevels: DeltaLevel[] = [];
  for (let i = 0; i < numLevels; i++) {
    const l = levels[i]!;
    outputLevels.push({
      priceLevel: parseFloat((minPrice + (i + 0.5) * levelSize).toFixed(4)),
      buyVolume: parseFloat(l.buy.toFixed(2)),
      sellVolume: parseFloat(l.sell.toFixed(2)),
      delta: parseFloat((l.buy - l.sell).toFixed(2)),
      percentage: parseFloat((totalVol > 0 ? (l.total / totalVol) * 100 : 0).toFixed(1)),
    });
  }

  // Current values
  const currentDelta = barDeltas[barDeltas.length - 1]!;
  const currentVolume = candles[candles.length - 1]!.volume;
  const deltaRatio = currentVolume > 0 ? Math.abs(currentDelta) / currentVolume : 0;

  // Reversal detection
  let reversal = false;
  if (cumDeltas.length >= 2) {
    const prev = cumDeltas[cumDeltas.length - 2]!;
    const curr = cumDeltas[cumDeltas.length - 1]!;
    reversal = (prev > 0 && curr <= 0) || (prev < 0 && curr >= 0);
  }

  // Trend
  let trend: "buying_pressure" | "selling_pressure" | "neutral" = "neutral";
  if (cumDelta > 0 && deltaRatio > 0.1) trend = "buying_pressure";
  else if (cumDelta < 0 && deltaRatio > 0.1) trend = "selling_pressure";

  // Signal
  let signal: "buy" | "sell" | "neutral" = "neutral";
  if (reversal && cumDelta > 0) signal = "buy";
  else if (reversal && cumDelta < 0) signal = "sell";
  else if (trend === "buying_pressure" && deltaRatio > 0.2) signal = "buy";
  else if (trend === "selling_pressure" && deltaRatio > 0.2) signal = "sell";

  const interpretation = buildDeltaInterpretation(
    currentDelta,
    cumDelta,
    deltaRatio,
    trend,
    reversal,
    poc,
  );

  return {
    currentDelta: parseFloat(currentDelta.toFixed(2)),
    cumulativeDelta: parseFloat(cumDelta.toFixed(2)),
    deltaRatio: parseFloat(deltaRatio.toFixed(3)),
    poc: poc !== null ? parseFloat(poc.toFixed(4)) : null,
    cumulativeDeltaValues: cumDeltas.map((v) => parseFloat(v.toFixed(2))),
    levels: outputLevels,
    trend,
    reversal,
    signal,
    interpretation,
  };
}

function buildDeltaInterpretation(
  barDelta: number,
  cumDelta: number,
  ratio: number,
  trend: string,
  reversal: boolean,
  poc: number | null,
): string {
  let msg = `Delta: bar ${barDelta > 0 ? "+" : ""}${barDelta.toFixed(0)}, `;
  msg += `cumulative ${cumDelta > 0 ? "+" : ""}${cumDelta.toFixed(0)} (ratio: ${(ratio * 100).toFixed(0)}%). `;

  if (poc !== null) msg += `POC: ${poc.toFixed(2)}. `;

  if (reversal) {
    msg +=
      cumDelta > 0
        ? "DELTA REVERSAL — cumulative delta flipped positive. Buying taking over."
        : "DELTA REVERSAL — cumulative delta flipped negative. Selling taking over.";
  } else {
    msg +=
      trend === "buying_pressure"
        ? "Net buying pressure — bulls in control."
        : trend === "selling_pressure"
          ? "Net selling pressure — bears in control."
          : "Balanced order flow.";
  }

  return msg;
}

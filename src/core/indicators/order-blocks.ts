/**
 * Order Blocks Detection
 * High-probability order block detection using z-score of price distance.
 * Tracks block mitigation and uses simplified Kaplan-Meier survival probability.
 *
 * Order Blocks implementation.
 */

import type { Candle } from "./types.ts";
import { mean, populationStd, zScore } from "../stats/index.ts";

export interface OrderBlock {
  /** Order block type */
  type: "bullish" | "bearish";
  /** Price level where block was created */
  price: number;
  /** Bar index of creation */
  bar: number;
  /** Whether block has been mitigated (retested) */
  mitigated: boolean;
  /** Bar where block was mitigated (-1 if not) */
  mitigationBar: number;
  /** Z-score at time of creation */
  zScore: number;
  /** Bars until expiration */
  barsRemaining: number;
}

export interface OrderBlockResult {
  /** Active (unmitigated, unexpired) bullish order blocks */
  bullishBlocks: OrderBlock[];
  /** Active bearish order blocks */
  bearishBlocks: OrderBlock[];
  /** Whether a new order block was just created */
  newBlock: boolean;
  /** Type of newest block */
  newBlockType: "bullish" | "bearish" | "none";
  /** Nearest bullish OB below price */
  nearestBullishOB: number | null;
  /** Nearest bearish OB above price */
  nearestBearishOB: number | null;
  /** Kaplan-Meier survival probability for bullish blocks */
  bullishProbability: number;
  /** Kaplan-Meier survival probability for bearish blocks */
  bearishProbability: number;
  /** Signal */
  signal: "buy" | "sell" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Rolling z-score calculation
 */
function rollingZScore(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window) {
      result.push(0);
      continue;
    }
    // Exclude current value from mean/std
    const win = values.slice(i - window, i);
    const mu = mean(win);
    const std = populationStd(win);

    result.push(std > 1e-10 ? zScore(values[i]!, mu, std) : 0);
  }
  return result;
}

/**
 * Simplified Kaplan-Meier survival probability
 */
function kaplanMeierProbability(blocks: OrderBlock[]): number {
  const mitigated = blocks.filter(b => b.mitigated);
  if (mitigated.length < 5) return 0.5;

  const survivalTimes = mitigated.map(b => b.mitigationBar - b.bar);
  survivalTimes.sort((a, b) => a - b);

  const medianTime = survivalTimes[Math.floor(survivalTimes.length / 2)]!;
  const survivors = mitigated.filter(b => (b.mitigationBar - b.bar) >= medianTime).length;
  const prob = survivors / mitigated.length;

  return Math.max(0.1, Math.min(0.9, prob));
}

/**
 * Calculate Order Blocks.
 *
 * @param candles - OHLCV candle array
 * @param lookback - Lookback for z-score and distance calculation (default 50)
 * @param zThresholdBull - Z-score threshold for bullish OB detection (default 4.0)
 * @param zThresholdBear - Z-score threshold for bearish OB detection (default 4.0)
 * @param boxExpiration - Bars until order block expires (default 100)
 * @returns OrderBlockResult
 */
export function calculateOrderBlocks(
  candles: Candle[],
  lookback: number = 50,
  zThresholdBull: number = 4.0,
  zThresholdBear: number = 4.0,
  boxExpiration: number = 100
): OrderBlockResult {
  if (candles.length < lookback + 5) {
    return {
      bullishBlocks: [],
      bearishBlocks: [],
      newBlock: false,
      newBlockType: "none",
      nearestBullishOB: null,
      nearestBearishOB: null,
      bullishProbability: 0.5,
      bearishProbability: 0.5,
      signal: "neutral",
      interpretation: "Insufficient data for order block detection",
    };
  }

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const lastBar = candles.length - 1;
  const currentPrice = candles[lastBar]!.close;

  // Calculate up/down distances
  const upDistances: number[] = [];
  const downDistances: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < lookback) {
      upDistances.push(0);
      downDistances.push(0);
      continue;
    }
    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (let j = i - lookback; j < i; j++) {
      if (highs[j]! > maxHigh) maxHigh = highs[j]!;
      if (lows[j]! < minLow) minLow = lows[j]!;
    }
    upDistances.push(highs[i]! - maxHigh);
    downDistances.push(minLow - lows[i]!);
  }

  // Z-scores
  const zUp = rollingZScore(upDistances, lookback);
  const zDown = rollingZScore(downDistances, lookback);

  // Detect order blocks
  const allBlocks: OrderBlock[] = [];

  for (let i = 1; i < candles.length; i++) {
    // Bullish OB: z-score of up-distance crosses above threshold
    if (zUp[i - 1]! <= zThresholdBull && zUp[i]! > zThresholdBull) {
      allBlocks.push({
        type: "bullish",
        price: parseFloat(lows[i]!.toFixed(4)),
        bar: i,
        mitigated: false,
        mitigationBar: -1,
        zScore: parseFloat(zUp[i]!.toFixed(2)),
        barsRemaining: boxExpiration - (lastBar - i),
      });
    }

    // Bearish OB: z-score of down-distance crosses below negative threshold
    if (zDown[i - 1]! >= -zThresholdBear && zDown[i]! < -zThresholdBear) {
      allBlocks.push({
        type: "bearish",
        price: parseFloat(highs[i]!.toFixed(4)),
        bar: i,
        mitigated: false,
        mitigationBar: -1,
        zScore: parseFloat(zDown[i]!.toFixed(2)),
        barsRemaining: boxExpiration - (lastBar - i),
      });
    }
  }

  // Check mitigation
  for (const block of allBlocks) {
    for (let j = block.bar + 1; j < candles.length; j++) {
      if (block.type === "bullish" && lows[j]! <= block.price) {
        block.mitigated = true;
        block.mitigationBar = j;
        break;
      }
      if (block.type === "bearish" && highs[j]! >= block.price) {
        block.mitigated = true;
        block.mitigationBar = j;
        break;
      }
    }
  }

  // Filter active blocks (unmitigated and not expired)
  const activeBlocks = allBlocks.filter(
    b => !b.mitigated && (lastBar - b.bar) < boxExpiration
  );

  const bullishBlocks = activeBlocks.filter(b => b.type === "bullish");
  const bearishBlocks = activeBlocks.filter(b => b.type === "bearish");

  // Nearest blocks
  let nearestBullishOB: number | null = null;
  let minBullDist = Infinity;
  for (const b of bullishBlocks) {
    const dist = currentPrice - b.price;
    if (dist > 0 && dist < minBullDist) {
      minBullDist = dist;
      nearestBullishOB = b.price;
    }
  }

  let nearestBearishOB: number | null = null;
  let minBearDist = Infinity;
  for (const b of bearishBlocks) {
    const dist = b.price - currentPrice;
    if (dist > 0 && dist < minBearDist) {
      minBearDist = dist;
      nearestBearishOB = b.price;
    }
  }

  // KM probabilities
  const allBullish = allBlocks.filter(b => b.type === "bullish");
  const allBearish = allBlocks.filter(b => b.type === "bearish");
  const bullishProbability = parseFloat(kaplanMeierProbability(allBullish).toFixed(2));
  const bearishProbability = parseFloat(kaplanMeierProbability(allBearish).toFixed(2));

  // New block detection
  const recentBlocks = allBlocks.filter(b => b.bar >= lastBar - 1);
  const newBlock = recentBlocks.length > 0;
  const newBlockType = newBlock ? recentBlocks[recentBlocks.length - 1]!.type : "none";

  // Signal
  let signal: "buy" | "sell" | "neutral" = "neutral";
  if (newBlock && newBlockType === "bullish" && bullishProbability >= 0.6) signal = "buy";
  else if (newBlock && newBlockType === "bearish" && bearishProbability >= 0.6) signal = "sell";

  const interpretation = buildOBInterpretation(
    bullishBlocks.length, bearishBlocks.length,
    nearestBullishOB, nearestBearishOB, currentPrice,
    newBlock, newBlockType, bullishProbability, bearishProbability, signal
  );

  return {
    bullishBlocks: bullishBlocks.slice(-5),
    bearishBlocks: bearishBlocks.slice(-5),
    newBlock,
    newBlockType: newBlockType as "bullish" | "bearish" | "none",
    nearestBullishOB,
    nearestBearishOB,
    bullishProbability,
    bearishProbability,
    signal,
    interpretation,
  };
}

function buildOBInterpretation(
  bullCount: number, bearCount: number,
  nearBull: number | null, nearBear: number | null, price: number,
  newBlock: boolean, newType: string,
  bullProb: number, bearProb: number, signal: string
): string {
  let msg = `Order Blocks: ${bullCount} bullish, ${bearCount} bearish active. `;

  if (nearBull !== null) {
    msg += `Nearest bullish OB: ${nearBull.toFixed(2)} (${((price - nearBull) / price * 100).toFixed(1)}% below). `;
  }
  if (nearBear !== null) {
    msg += `Nearest bearish OB: ${nearBear.toFixed(2)} (${((nearBear - price) / price * 100).toFixed(1)}% above). `;
  }

  if (newBlock) {
    msg += `NEW ${newType.toUpperCase()} ORDER BLOCK detected. `;
  }

  msg += `KM survival: bull ${(bullProb * 100).toFixed(0)}%, bear ${(bearProb * 100).toFixed(0)}%. `;

  if (signal !== "neutral") {
    msg += `Signal: ${signal.toUpperCase()} (high-probability OB with KM confirmation).`;
  }

  return msg;
}

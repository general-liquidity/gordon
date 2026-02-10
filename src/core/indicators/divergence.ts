/**
 * RSI Divergence Detection
 * Detects bullish and bearish divergences between price and RSI.
 * Bullish divergence: price lower low + RSI higher low (reversal up).
 * Bearish divergence: price higher high + RSI lower high (reversal down).
 *
 * RSI Divergence implementation.
 */

import type { Candle } from "./types.ts";

export interface DivergenceSignal {
  /** Type of divergence */
  type: "bullish" | "bearish";
  /** Price at current extreme */
  currentPrice: number;
  /** Price at previous extreme */
  previousPrice: number;
  /** RSI at current extreme */
  currentRSI: number;
  /** RSI at previous extreme */
  previousRSI: number;
  /** Bar index of current extreme */
  currentBar: number;
  /** Bar index of previous extreme */
  previousBar: number;
  /** Strength: how pronounced the divergence is (0-100) */
  strength: number;
}

export interface DivergenceResult {
  /** Current RSI value */
  rsi: number | null;
  /** RSI series */
  rsiValues: number[];
  /** Whether any divergence is active on the last bar */
  divergenceDetected: boolean;
  /** Most recent divergence signal */
  signal: "bullish_divergence" | "bearish_divergence" | "none";
  /** All detected divergences in the lookback */
  divergences: DivergenceSignal[];
  /** Strength of the most recent divergence (0-100) */
  strength: number;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate RSI using Wilder's smoothing
 */
function calcRSI(closes: number[], period: number): number[] {
  const rsi: number[] = [];
  if (closes.length < period + 1) return rsi;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Fill nulls for initial period
  for (let i = 0; i <= period; i++) {
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  // Subsequent values
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

/**
 * Find rolling maximum indices within a window
 */
function rollingMaxIdx(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      result.push(i);
      continue;
    }
    let maxIdx = i - window + 1;
    for (let j = i - window + 1; j <= i; j++) {
      if (values[j]! > values[maxIdx]!) maxIdx = j;
    }
    result.push(maxIdx);
  }
  return result;
}

/**
 * Find rolling minimum indices within a window
 */
function rollingMinIdx(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      result.push(i);
      continue;
    }
    let minIdx = i - window + 1;
    for (let j = i - window + 1; j <= i; j++) {
      if (values[j]! < values[minIdx]!) minIdx = j;
    }
    result.push(minIdx);
  }
  return result;
}

/**
 * Detect RSI divergences.
 *
 * @param candles - OHLCV candle array
 * @param rsiPeriod - RSI period (default 14)
 * @param lookback - Window for finding price/RSI extremes (default 10)
 * @param priceTolerance - Min % price must move for valid extreme (default 0.005)
 * @param rsiTolerance - Min RSI point difference for divergence (default 1)
 * @returns DivergenceResult
 */
export function calculateDivergence(
  candles: Candle[],
  rsiPeriod: number = 14,
  lookback: number = 10,
  priceTolerance: number = 0.005,
  rsiTolerance: number = 1
): DivergenceResult {
  if (candles.length < rsiPeriod + lookback * 2 + 1) {
    return {
      rsi: null,
      rsiValues: [],
      divergenceDetected: false,
      signal: "none",
      divergences: [],
      strength: 0,
      interpretation: "Insufficient data for divergence detection",
    };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const rsiValues = calcRSI(closes, rsiPeriod);

  // Rolling extremes for price and RSI
  const priceHighMax = rollingMax(highs, lookback);
  const priceLowMin = rollingMin(lows, lookback);
  const rsiHighMax = rollingMax(rsiValues, lookback);
  const rsiLowMin = rollingMin(rsiValues, lookback);

  const divergences: DivergenceSignal[] = [];
  const scanStart = Math.max(lookback * 2, rsiPeriod + lookback);

  // Scan for divergences
  for (let i = scanStart; i < candles.length; i++) {
    const prevIdx = i - lookback;
    if (prevIdx < lookback) continue;

    const currentPrice = closes[i]!;
    const currentRSI = rsiValues[i]!;

    // Current and previous extremes
    const currPriceHigh = priceHighMax[i]!;
    const currPriceLow = priceLowMin[i]!;
    const currRSIHigh = rsiHighMax[i]!;
    const currRSILow = rsiLowMin[i]!;

    const prevPriceHigh = priceHighMax[prevIdx]!;
    const prevPriceLow = priceLowMin[prevIdx]!;
    const prevRSIHigh = rsiHighMax[prevIdx]!;
    const prevRSILow = rsiLowMin[prevIdx]!;

    // === BULLISH DIVERGENCE ===
    // Price makes lower low, RSI makes higher low
    const priceNearLow = Math.abs(currentPrice - currPriceLow) / currentPrice < priceTolerance;
    const priceLowerLow = currPriceLow < prevPriceLow * (1 - priceTolerance);
    const rsiHigherLow = currRSILow > prevRSILow + rsiTolerance;
    const rsiOversoldish = currentRSI < 40; // Near oversold zone

    if (priceNearLow && priceLowerLow && rsiHigherLow && rsiOversoldish) {
      const priceDivPct = Math.abs((currPriceLow - prevPriceLow) / prevPriceLow) * 100;
      const rsiDivPts = currRSILow - prevRSILow;
      const strength = Math.min(100, priceDivPct * 10 + rsiDivPts * 5);

      divergences.push({
        type: "bullish",
        currentPrice: currPriceLow,
        previousPrice: prevPriceLow,
        currentRSI: currRSILow,
        previousRSI: prevRSILow,
        currentBar: i,
        previousBar: prevIdx,
        strength: parseFloat(strength.toFixed(1)),
      });
    }

    // === BEARISH DIVERGENCE ===
    // Price makes higher high, RSI makes lower high
    const priceNearHigh = Math.abs(currentPrice - currPriceHigh) / currentPrice < priceTolerance;
    const priceHigherHigh = currPriceHigh > prevPriceHigh * (1 + priceTolerance);
    const rsiLowerHigh = currRSIHigh < prevRSIHigh - rsiTolerance;
    const rsiOverboughtish = currentRSI > 60; // Near overbought zone

    if (priceNearHigh && priceHigherHigh && rsiLowerHigh && rsiOverboughtish) {
      const priceDivPct = Math.abs((currPriceHigh - prevPriceHigh) / prevPriceHigh) * 100;
      const rsiDivPts = prevRSIHigh - currRSIHigh;
      const strength = Math.min(100, priceDivPct * 10 + rsiDivPts * 5);

      divergences.push({
        type: "bearish",
        currentPrice: currPriceHigh,
        previousPrice: prevPriceHigh,
        currentRSI: currRSIHigh,
        previousRSI: prevRSIHigh,
        currentBar: i,
        previousBar: prevIdx,
        strength: parseFloat(strength.toFixed(1)),
      });
    }
  }

  // Find most recent divergence
  const lastBar = candles.length - 1;
  const recentDivergences = divergences.filter(d => lastBar - d.currentBar <= lookback);
  const mostRecent = recentDivergences.length > 0 ? recentDivergences[recentDivergences.length - 1]! : null;

  const currentRSI = rsiValues[rsiValues.length - 1] ?? null;
  const divergenceDetected = mostRecent !== null;
  const signal: "bullish_divergence" | "bearish_divergence" | "none" = mostRecent
    ? mostRecent.type === "bullish"
      ? "bullish_divergence"
      : "bearish_divergence"
    : "none";
  const strength = mostRecent?.strength ?? 0;

  const interpretation = buildDivergenceInterpretation(
    currentRSI,
    divergenceDetected,
    signal,
    strength,
    mostRecent,
    divergences.length
  );

  return {
    rsi: currentRSI !== null ? parseFloat(currentRSI.toFixed(1)) : null,
    rsiValues: rsiValues.map(v => parseFloat(v.toFixed(2))),
    divergenceDetected,
    signal,
    divergences: recentDivergences,
    strength,
    interpretation,
  };
}

/**
 * Rolling maximum values
 */
function rollingMax(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      let max = -Infinity;
      for (let j = 0; j <= i; j++) {
        if (values[j]! > max) max = values[j]!;
      }
      result.push(max);
    } else {
      let max = -Infinity;
      for (let j = i - window + 1; j <= i; j++) {
        if (values[j]! > max) max = values[j]!;
      }
      result.push(max);
    }
  }
  return result;
}

/**
 * Rolling minimum values
 */
function rollingMin(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      let min = Infinity;
      for (let j = 0; j <= i; j++) {
        if (values[j]! < min) min = values[j]!;
      }
      result.push(min);
    } else {
      let min = Infinity;
      for (let j = i - window + 1; j <= i; j++) {
        if (values[j]! < min) min = values[j]!;
      }
      result.push(min);
    }
  }
  return result;
}

function buildDivergenceInterpretation(
  rsi: number | null,
  detected: boolean,
  signal: string,
  strength: number,
  recent: DivergenceSignal | null,
  totalCount: number
): string {
  if (rsi === null) return "Insufficient data for divergence detection.";

  let msg = `RSI: ${rsi.toFixed(1)}. `;

  if (!detected) {
    msg += `No active divergence detected. ${totalCount} historical divergences found in dataset.`;
    return msg;
  }

  if (recent) {
    msg += `${signal === "bullish_divergence" ? "BULLISH" : "BEARISH"} DIVERGENCE detected. `;
    msg += `Price: ${recent.previousPrice.toFixed(2)} → ${recent.currentPrice.toFixed(2)} `;
    msg += `(${recent.type === "bullish" ? "lower low" : "higher high"}), `;
    msg += `RSI: ${recent.previousRSI.toFixed(1)} → ${recent.currentRSI.toFixed(1)} `;
    msg += `(${recent.type === "bullish" ? "higher low" : "lower high"}). `;
    msg += `Strength: ${strength.toFixed(0)}/100. `;

    if (strength >= 60) {
      msg += "Strong divergence — high-probability reversal signal.";
    } else if (strength >= 30) {
      msg += "Moderate divergence — watch for confirmation.";
    } else {
      msg += "Weak divergence — may resolve without reversal.";
    }
  }

  return msg;
}

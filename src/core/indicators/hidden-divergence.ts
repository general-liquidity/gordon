/**
 * Hidden RSI Divergence Detection
 * Detects hidden (continuation) divergences between price and RSI — the
 * co-equal counterpart to regular divergence (divergence.ts), which flags
 * reversals. Where regular divergence compares opposite extremes (price LL /
 * RSI HL), hidden divergence flips the price side:
 * Hidden bullish (uptrend continuation): price higher low + RSI lower low.
 * Hidden bearish (downtrend continuation): price lower high + RSI higher high.
 * This complements — it does not replace — the regular-divergence detector.
 */

import type { Candle } from "./types.ts";

export interface HiddenDivergenceSignal {
  /** Type of hidden divergence */
  type: "hidden_bullish" | "hidden_bearish";
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

export interface HiddenDivergenceResult {
  /** Current RSI value */
  rsi: number | null;
  /** RSI series */
  rsiValues: number[];
  /** Whether any hidden divergence is active on the last bar */
  divergenceDetected: boolean;
  /** Most recent hidden divergence signal */
  signal: "hidden_bullish" | "hidden_bearish" | "none";
  /** All detected hidden divergences in the lookback */
  divergences: HiddenDivergenceSignal[];
  /** Strength of the most recent hidden divergence (0-100) */
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
 * Detect hidden RSI divergences.
 *
 * @param candles - OHLCV candle array
 * @param opts.rsiPeriod - RSI period (default 14)
 * @param opts.lookback - Window for finding price/RSI extremes (default 10)
 * @param opts.priceTolerance - Min % price must move for valid extreme (default 0.005)
 * @param opts.rsiTolerance - Min RSI point difference for divergence (default 1)
 * @returns HiddenDivergenceResult
 */
export function calculateHiddenDivergence(
  candles: Candle[],
  opts?: { rsiPeriod?: number; lookback?: number; priceTolerance?: number; rsiTolerance?: number },
): HiddenDivergenceResult {
  const rsiPeriod = opts?.rsiPeriod ?? 14;
  const lookback = opts?.lookback ?? 10;
  const priceTolerance = opts?.priceTolerance ?? 0.005;
  const rsiTolerance = opts?.rsiTolerance ?? 1;

  if (candles.length < rsiPeriod + lookback * 2 + 1) {
    return {
      rsi: null,
      rsiValues: [],
      divergenceDetected: false,
      signal: "none",
      divergences: [],
      strength: 0,
      interpretation: "Insufficient data for hidden divergence",
    };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const rsiValues = calcRSI(closes, rsiPeriod);

  // Rolling extremes for price and RSI
  const priceHighMax = rollingMax(highs, lookback);
  const priceLowMin = rollingMin(lows, lookback);
  const rsiHighMax = rollingMax(rsiValues, lookback);
  const rsiLowMin = rollingMin(rsiValues, lookback);

  const divergences: HiddenDivergenceSignal[] = [];
  const scanStart = Math.max(lookback * 2, rsiPeriod + lookback);

  // Scan for hidden divergences
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

    // === HIDDEN BULLISH DIVERGENCE ===
    // Price makes higher low, RSI makes lower low (uptrend continuation)
    const priceNearLow = Math.abs(currentPrice - currPriceLow) / currentPrice < priceTolerance;
    const priceHigherLow = currPriceLow > prevPriceLow * (1 + priceTolerance);
    const rsiLowerLow = currRSILow < prevRSILow - rsiTolerance;
    const rsiPullbackZone = currentRSI < 60; // Pullback region within an uptrend

    if (priceNearLow && priceHigherLow && rsiLowerLow && rsiPullbackZone) {
      const priceDivPct = Math.abs((currPriceLow - prevPriceLow) / prevPriceLow) * 100;
      const rsiDivPts = prevRSILow - currRSILow;
      const strength = Math.min(100, priceDivPct * 10 + rsiDivPts * 5);

      divergences.push({
        type: "hidden_bullish",
        currentPrice: currPriceLow,
        previousPrice: prevPriceLow,
        currentRSI: currRSILow,
        previousRSI: prevRSILow,
        currentBar: i,
        previousBar: prevIdx,
        strength: parseFloat(strength.toFixed(1)),
      });
    }

    // === HIDDEN BEARISH DIVERGENCE ===
    // Price makes lower high, RSI makes higher high (downtrend continuation)
    const priceNearHigh = Math.abs(currentPrice - currPriceHigh) / currentPrice < priceTolerance;
    const priceLowerHigh = currPriceHigh < prevPriceHigh * (1 - priceTolerance);
    const rsiHigherHigh = currRSIHigh > prevRSIHigh + rsiTolerance;
    const rsiBounceZone = currentRSI > 40; // Bounce region within a downtrend

    if (priceNearHigh && priceLowerHigh && rsiHigherHigh && rsiBounceZone) {
      const priceDivPct = Math.abs((currPriceHigh - prevPriceHigh) / prevPriceHigh) * 100;
      const rsiDivPts = currRSIHigh - prevRSIHigh;
      const strength = Math.min(100, priceDivPct * 10 + rsiDivPts * 5);

      divergences.push({
        type: "hidden_bearish",
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

  // Find most recent hidden divergence
  const lastBar = candles.length - 1;
  const recentDivergences = divergences.filter((d) => lastBar - d.currentBar <= lookback);
  const mostRecent =
    recentDivergences.length > 0 ? recentDivergences[recentDivergences.length - 1]! : null;

  const currentRSI = rsiValues[rsiValues.length - 1] ?? null;
  const divergenceDetected = mostRecent !== null;
  const signal: "hidden_bullish" | "hidden_bearish" | "none" = mostRecent
    ? mostRecent.type === "hidden_bullish"
      ? "hidden_bullish"
      : "hidden_bearish"
    : "none";
  const strength = mostRecent?.strength ?? 0;

  const interpretation = buildHiddenDivergenceInterpretation(
    currentRSI,
    divergenceDetected,
    signal,
    strength,
    mostRecent,
    divergences.length,
  );

  return {
    rsi: currentRSI !== null ? parseFloat(currentRSI.toFixed(1)) : null,
    rsiValues: rsiValues.map((v) => parseFloat(v.toFixed(2))),
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

function buildHiddenDivergenceInterpretation(
  rsi: number | null,
  detected: boolean,
  signal: string,
  strength: number,
  recent: HiddenDivergenceSignal | null,
  totalCount: number,
): string {
  if (rsi === null) return "Insufficient data for hidden divergence.";

  let msg = `RSI: ${rsi.toFixed(1)}. `;

  if (!detected) {
    msg += `No active hidden divergence detected. ${totalCount} historical hidden divergences found in dataset.`;
    return msg;
  }

  if (recent) {
    msg += `${signal === "hidden_bullish" ? "HIDDEN BULLISH" : "HIDDEN BEARISH"} DIVERGENCE detected. `;
    msg += `Price: ${recent.previousPrice.toFixed(2)} → ${recent.currentPrice.toFixed(2)} `;
    msg += `(${recent.type === "hidden_bullish" ? "higher low" : "lower high"}), `;
    msg += `RSI: ${recent.previousRSI.toFixed(1)} → ${recent.currentRSI.toFixed(1)} `;
    msg += `(${recent.type === "hidden_bullish" ? "lower low" : "higher high"}). `;
    msg += `Strength: ${strength.toFixed(0)}/100. `;

    if (strength >= 60) {
      msg += "Strong hidden divergence — high-probability trend continuation signal.";
    } else if (strength >= 30) {
      msg += "Moderate hidden divergence — watch for confirmation.";
    } else {
      msg += "Weak hidden divergence — may resolve without continuation.";
    }
  }

  return msg;
}

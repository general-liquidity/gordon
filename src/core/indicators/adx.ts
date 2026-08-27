/**
 * Average Directional Index (ADX) with +DI / -DI
 * Measures trend strength (0-100) and directional movement.
 * ADX > 25 = strong trend, ADX < 20 = weak/ranging.
 * +DI > -DI = bullish, -DI > +DI = bearish.
 *
 * Based on Welles Wilder's original ADX formulation.
 */

import type { Candle } from "./types.ts";

export interface ADXResult {
  /** ADX value (0-100): trend strength */
  adx: number | null;
  /** +DI (Positive Directional Indicator) */
  plusDI: number | null;
  /** -DI (Negative Directional Indicator) */
  minusDI: number | null;
  /** ADX series */
  adxValues: number[];
  /** +DI series */
  plusDIValues: number[];
  /** -DI series */
  minusDIValues: number[];
  /** Trend strength classification */
  trendStrength: "strong" | "moderate" | "weak" | "absent";
  /** Direction based on DI crossover */
  direction: "bullish" | "bearish" | "neutral";
  /** DI crossover detection */
  diCrossover: "bullish_cross" | "bearish_cross" | "none";
  /** Signal combining strength + direction */
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Wilder's smoothing (exponential with alpha = 1/period)
 */
function wilderSmooth(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length < period) return result;

  // First value is simple sum
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  result.push(sum);

  // Subsequent values use Wilder's smoothing
  for (let i = period; i < values.length; i++) {
    const prev = result[result.length - 1]!;
    result.push(prev - prev / period + values[i]!);
  }

  return result;
}

/**
 * Calculate ADX with +DI and -DI.
 *
 * @param candles - OHLCV candle array
 * @param period - ADX period (default 14)
 * @returns ADXResult
 */
export function calculateADX(candles: Candle[], period: number = 14): ADXResult {
  if (candles.length < period * 2 + 1) {
    return {
      adx: null,
      plusDI: null,
      minusDI: null,
      adxValues: [],
      plusDIValues: [],
      minusDIValues: [],
      trendStrength: "absent",
      direction: "neutral",
      diCrossover: "none",
      signal: "neutral",
      interpretation: "Insufficient data for ADX calculation",
    };
  }

  // Step 1: Calculate True Range, +DM, -DM for each bar
  const trValues: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i]!.high;
    const low = candles[i]!.low;
    const prevClose = candles[i - 1]!.close;
    const prevHigh = candles[i - 1]!.high;
    const prevLow = candles[i - 1]!.low;

    // True Range
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trValues.push(tr);

    // Directional Movement
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  // Step 2: Wilder's smoothing on TR, +DM, -DM
  const smoothTR = wilderSmooth(trValues, period);
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);

  if (smoothTR.length === 0) {
    return {
      adx: null,
      plusDI: null,
      minusDI: null,
      adxValues: [],
      plusDIValues: [],
      minusDIValues: [],
      trendStrength: "absent",
      direction: "neutral",
      diCrossover: "none",
      signal: "neutral",
      interpretation: "Insufficient data for ADX smoothing",
    };
  }

  // Step 3: Calculate +DI and -DI
  const plusDIValues: number[] = [];
  const minusDIValues: number[] = [];
  const dxValues: number[] = [];

  for (let i = 0; i < smoothTR.length; i++) {
    const tr = smoothTR[i]!;
    if (tr < 1e-10) {
      plusDIValues.push(0);
      minusDIValues.push(0);
      dxValues.push(0);
    } else {
      const pdi = (smoothPlusDM[i]! / tr) * 100;
      const mdi = (smoothMinusDM[i]! / tr) * 100;
      plusDIValues.push(pdi);
      minusDIValues.push(mdi);

      const diSum = pdi + mdi;
      const dx = diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0;
      dxValues.push(dx);
    }
  }

  // Step 4: ADX = Wilder's smoothing of DX
  const adxSmoothed = wilderSmooth(dxValues, period);

  // Map ADX values back — ADX starts after 2*period-1 bars
  const adxValues: number[] = [];
  for (let i = 0; i < adxSmoothed.length; i++) {
    adxValues.push(parseFloat((adxSmoothed[i]! / period).toFixed(2)));
  }

  // Wait — Wilder's smooth first value is a sum, then subsequent are smoothed.
  // For DI values, the first smoothed value is already sum/period effectively.
  // But for ADX, we need to re-average. Let me recalculate properly.
  // Actually the wilderSmooth returns raw smoothed values. For DI, we divide by TR.
  // For ADX, wilderSmooth on DX gives smoothed DX, and the first value is sum of DX.
  // We need to divide by period for the first, then subsequent are already smoothed.

  // Recalculate ADX properly
  const adxFinal: number[] = [];
  if (adxSmoothed.length > 0) {
    adxFinal.push(adxSmoothed[0]! / period); // First ADX = average of DX
    for (let i = 1; i < adxSmoothed.length; i++) {
      // Wilder's smoothing already handles the running average
      const prev = adxFinal[adxFinal.length - 1]!;
      adxFinal.push((prev * (period - 1) + dxValues[period + i - 1]!) / period);
    }
  }

  // Get current values
  const currentADX = adxFinal.length > 0 ? adxFinal[adxFinal.length - 1]! : null;
  const currentPlusDI = plusDIValues.length > 0 ? plusDIValues[plusDIValues.length - 1]! : null;
  const currentMinusDI = minusDIValues.length > 0 ? minusDIValues[minusDIValues.length - 1]! : null;

  // Trend strength
  let trendStrength: "strong" | "moderate" | "weak" | "absent" = "absent";
  if (currentADX !== null) {
    if (currentADX >= 25) trendStrength = "strong";
    else if (currentADX >= 20) trendStrength = "moderate";
    else if (currentADX >= 10) trendStrength = "weak";
    else trendStrength = "absent";
  }

  // Direction
  let direction: "bullish" | "bearish" | "neutral" = "neutral";
  if (currentPlusDI !== null && currentMinusDI !== null) {
    const diDiff = currentPlusDI - currentMinusDI;
    if (diDiff > 5) direction = "bullish";
    else if (diDiff < -5) direction = "bearish";
  }

  // DI crossover
  let diCrossover: "bullish_cross" | "bearish_cross" | "none" = "none";
  if (plusDIValues.length >= 2 && minusDIValues.length >= 2) {
    const prevPDI = plusDIValues[plusDIValues.length - 2]!;
    const prevMDI = minusDIValues[minusDIValues.length - 2]!;
    if (prevPDI <= prevMDI && currentPlusDI! > currentMinusDI!) {
      diCrossover = "bullish_cross";
    } else if (prevPDI >= prevMDI && currentPlusDI! < currentMinusDI!) {
      diCrossover = "bearish_cross";
    }
  }

  // Signal
  let signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" = "neutral";
  if (trendStrength === "strong" || trendStrength === "moderate") {
    if (direction === "bullish" && diCrossover === "bullish_cross") signal = "strong_buy";
    else if (direction === "bullish") signal = "buy";
    else if (direction === "bearish" && diCrossover === "bearish_cross") signal = "strong_sell";
    else if (direction === "bearish") signal = "sell";
  }

  const interpretation = buildADXInterpretation(
    currentADX,
    currentPlusDI,
    currentMinusDI,
    trendStrength,
    direction,
    diCrossover,
  );

  return {
    adx: currentADX !== null ? parseFloat(currentADX.toFixed(1)) : null,
    plusDI: currentPlusDI !== null ? parseFloat(currentPlusDI.toFixed(1)) : null,
    minusDI: currentMinusDI !== null ? parseFloat(currentMinusDI.toFixed(1)) : null,
    adxValues: adxFinal.map((v) => parseFloat(v.toFixed(2))),
    plusDIValues: plusDIValues.map((v) => parseFloat(v.toFixed(2))),
    minusDIValues: minusDIValues.map((v) => parseFloat(v.toFixed(2))),
    trendStrength,
    direction,
    diCrossover,
    signal,
    interpretation,
  };
}

function buildADXInterpretation(
  adx: number | null,
  plusDI: number | null,
  minusDI: number | null,
  strength: string,
  direction: string,
  crossover: string,
): string {
  if (adx === null) return "Insufficient data for ADX.";

  let msg = `ADX: ${adx.toFixed(1)} (${strength} trend). `;
  msg += `+DI: ${plusDI?.toFixed(1)}, -DI: ${minusDI?.toFixed(1)} → ${direction}. `;

  if (crossover !== "none") {
    msg += `DI ${crossover === "bullish_cross" ? "BULLISH" : "BEARISH"} CROSSOVER detected. `;
  }

  if (strength === "strong") {
    msg +=
      direction === "bullish"
        ? "Strong uptrend — trend-following longs favored."
        : direction === "bearish"
          ? "Strong downtrend — trend-following shorts favored."
          : "Strong trend but unclear direction — wait for DI separation.";
  } else if (strength === "moderate") {
    msg += "Developing trend — watch for ADX expansion above 25.";
  } else {
    msg += "No significant trend — range-bound strategies preferred.";
  }

  return msg;
}

/**
 * Squeeze Momentum Indicator
 * Detects volatility compression (BB inside KC) and breakout momentum.
 * Squeeze ON = ranging/compressing, Squeeze OFF = breakout imminent.
 * Momentum via linear regression slope of detrended price.
 *
 * Based on LazyBear's Squeeze Momentum / Moon Dev implementation.
 */

import type { Candle } from "./types.ts";

export interface SqueezeMomentumResult {
  /** Whether squeeze is currently ON (BB inside KC = compression) */
  squeezeOn: boolean;
  /** Whether squeeze just fired (transitioned from ON to OFF) */
  squeezeFired: boolean;
  /** Current momentum value */
  momentum: number | null;
  /** Momentum direction and acceleration */
  momentumColor: "lime" | "green" | "red" | "maroon";
  /** Momentum series */
  momentumValues: number[];
  /** Squeeze state series (true = squeeze on) */
  squeezeStates: boolean[];
  /** Signal based on squeeze + momentum */
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  /** Interpretation string */
  interpretation: string;
}

function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j]!;
      result.push(sum / period);
    }
  }
  return result;
}

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  result.push(values[0]!);
  for (let i = 1; i < values.length; i++) {
    result.push(values[i]! * k + result[i - 1]! * (1 - k));
  }
  return result;
}

function stdDev(values: number[], period: number): (number | null)[] {
  const means = sma(values, period);
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const mean = means[i];
    if (mean == null || i < period - 1) {
      result.push(null);
    } else {
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = values[j]! - mean;
        sumSq += diff * diff;
      }
      result.push(Math.sqrt(sumSq / period));
    }
  }
  return result;
}

function linRegSlope(values: number[], period: number): number {
  if (values.length < period) return 0;
  const y = values.slice(-period);
  const n = y.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += y[i]!;
    sumXY += i * y[i]!;
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Calculate Squeeze Momentum.
 *
 * @param candles - OHLCV candle array
 * @param bbLength - Bollinger Band period (default 20)
 * @param bbMult - BB standard deviation multiplier (default 2.0)
 * @param kcLength - Keltner Channel period (default 20)
 * @param kcMult - KC ATR multiplier (default 1.5)
 * @param momLength - Momentum lookback (default 12)
 * @returns SqueezeMomentumResult
 */
export function calculateSqueezeMomentum(
  candles: Candle[],
  bbLength: number = 20,
  bbMult: number = 2.0,
  kcLength: number = 20,
  kcMult: number = 1.5,
  momLength: number = 12
): SqueezeMomentumResult {
  if (candles.length < Math.max(bbLength, kcLength, momLength) + 5) {
    return {
      squeezeOn: false,
      squeezeFired: false,
      momentum: null,
      momentumColor: "green",
      momentumValues: [],
      squeezeStates: [],
      signal: "neutral",
      interpretation: "Insufficient data for Squeeze Momentum",
    };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  // Bollinger Bands
  const bbSma = sma(closes, bbLength);
  const bbStd = stdDev(closes, bbLength);

  // Keltner Channels (EMA + ATR)
  const kcEma = ema(closes, kcLength);
  const trValues: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!)
    );
    trValues.push(tr);
  }
  const atrSma = sma(trValues, kcLength);

  // Squeeze detection
  const squeezeStates: boolean[] = [];
  for (let i = 0; i < candles.length; i++) {
    const bbS = bbSma[i];
    const bbD = bbStd[i];
    const kcE = kcEma[i];
    const atr = atrSma[i];

    if (bbS == null || bbD == null || kcE == null || atr == null) {
      squeezeStates.push(false);
      continue;
    }

    const bbUpper = bbS + bbMult * bbD;
    const bbLower = bbS - bbMult * bbD;
    const kcUpper = kcE + kcMult * atr;
    const kcLower = kcE - kcMult * atr;

    // Squeeze ON = BB inside KC
    squeezeStates.push(bbLower > kcLower && bbUpper < kcUpper);
  }

  // Momentum: detrended price through linear regression
  const momentumValues: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < momLength - 1) {
      momentumValues.push(0);
      continue;
    }

    // Source = Close - ((Highest + Lowest) / 2 + SMA) / 2
    let highest = -Infinity;
    let lowest = Infinity;
    let smaSum = 0;
    for (let j = i - momLength + 1; j <= i; j++) {
      if (highs[j]! > highest) highest = highs[j]!;
      if (lows[j]! < lowest) lowest = lows[j]!;
      smaSum += closes[j]!;
    }
    const midRange = (highest + lowest) / 2;
    const smaVal = smaSum / momLength;
    const source = closes[i]! - (midRange + smaVal) / 2;

    momentumValues.push(source);
  }

  // Linear regression slope of momentum
  const momSlopes: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < momLength * 2) {
      momSlopes.push(0);
    } else {
      momSlopes.push(linRegSlope(momentumValues.slice(0, i + 1), momLength));
    }
  }

  const currentMom = momSlopes[momSlopes.length - 1]!;
  const prevMom = momSlopes.length >= 2 ? momSlopes[momSlopes.length - 2]! : 0;

  // Momentum color
  let momentumColor: "lime" | "green" | "red" | "maroon";
  if (currentMom > 0) {
    momentumColor = currentMom > prevMom ? "lime" : "green";
  } else {
    momentumColor = currentMom < prevMom ? "maroon" : "red";
  }

  const squeezeOn = squeezeStates[squeezeStates.length - 1]!;
  const prevSqueeze = squeezeStates.length >= 2 ? squeezeStates[squeezeStates.length - 2]! : false;
  const squeezeFired = prevSqueeze && !squeezeOn;

  // Signal
  let signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" = "neutral";
  if (squeezeFired && momentumColor === "lime") signal = "strong_buy";
  else if (squeezeFired && momentumColor === "green") signal = "buy";
  else if (squeezeFired && momentumColor === "maroon") signal = "strong_sell";
  else if (squeezeFired && momentumColor === "red") signal = "sell";
  else if (!squeezeOn && currentMom > 0 && momentumColor === "lime") signal = "buy";
  else if (!squeezeOn && currentMom < 0 && momentumColor === "maroon") signal = "sell";

  const interpretation = buildSqueezeInterpretation(squeezeOn, squeezeFired, currentMom, momentumColor, signal);

  return {
    squeezeOn,
    squeezeFired,
    momentum: parseFloat(currentMom.toFixed(4)),
    momentumColor,
    momentumValues: momSlopes.map(v => parseFloat(v.toFixed(4))),
    squeezeStates,
    signal,
    interpretation,
  };
}

function buildSqueezeInterpretation(
  squeezeOn: boolean,
  fired: boolean,
  mom: number,
  color: string,
  signal: string
): string {
  let msg = "";
  if (fired) {
    msg += "SQUEEZE FIRED — volatility breakout imminent! ";
  } else if (squeezeOn) {
    msg += "Squeeze ON — volatility compressing, breakout building. ";
  } else {
    msg += "No squeeze — normal volatility. ";
  }

  msg += `Momentum: ${mom > 0 ? "+" : ""}${mom.toFixed(4)} (${color}). `;

  if (color === "lime") msg += "Strong bullish acceleration. ";
  else if (color === "green") msg += "Bullish but decelerating. ";
  else if (color === "red") msg += "Bearish but decelerating. ";
  else msg += "Strong bearish acceleration. ";

  if (signal !== "neutral") {
    msg += `Signal: ${signal.replace("_", " ").toUpperCase()}.`;
  }

  return msg;
}

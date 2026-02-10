/**
 * WaveTrend Oscillator
 * Multi-layer momentum oscillator combining HLC3, ESA, and CI calculation.
 * Better overbought/oversold detection than RSI — includes volume flow analysis.
 *
 * Based on Moon Dev's WaveTrend + MACD + Volume implementation.
 *
 * Calculation:
 *   HLC3 = (High + Low + Close) / 3
 *   ESA  = EMA(HLC3, channelLen)
 *   D    = EMA(|HLC3 - ESA|, channelLen)
 *   CI   = (HLC3 - ESA) / (0.015 * D)
 *   WT1  = EMA(CI, averageLen)    ← main line
 *   WT2  = SMA(WT1, maLen)        ← signal line
 */

import type { Candle } from "./types.ts";

export interface WaveTrendResult {
  /** WT1 (main line) values */
  wt1: number[];
  /** WT2 (signal line) values */
  wt2: number[];
  /** Current WT1 value */
  currentWT1: number | null;
  /** Current WT2 value */
  currentWT2: number | null;
  /** Zone: overbought (>60), oversold (<-60), neutral */
  zone: "overbought" | "oversold" | "neutral";
  /** Crossover state */
  crossover: "bullish_cross" | "bearish_cross" | "none";
  /** Momentum direction */
  momentum: "rising" | "falling" | "flat";
  /** Chaikin Money Flow value (volume confirmation) */
  cmf: number | null;
  /** CMF bias */
  cmfBias: "bullish" | "bearish" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate EMA (Exponential Moving Average) of a number array
 */
function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);

  for (let i = 0; i < data.length; i++) {
    if (i === 0 || result.length === 0) {
      result.push(data[i]!);
    } else {
      result.push(data[i]! * k + result[i - 1]! * (1 - k));
    }
  }
  return result;
}

/**
 * Calculate SMA (Simple Moving Average) of a number array
 */
function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(data[i]!);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j]!;
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Calculate Chaikin Money Flow
 */
function calculateCMF(candles: Candle[], period: number = 21): number | null {
  if (candles.length < period) return null;

  const window = candles.slice(-period);
  let mfvSum = 0;
  let volSum = 0;

  for (const c of window) {
    const range = c.high - c.low;
    const mfm = range > 0 ? ((c.close - c.low) - (c.high - c.close)) / range : 0;
    mfvSum += mfm * c.volume;
    volSum += c.volume;
  }

  return volSum > 0 ? mfvSum / volSum : 0;
}

/**
 * Calculate WaveTrend Oscillator with volume confirmation.
 *
 * @param candles - OHLCV candle array
 * @param channelLen - Channel length for ESA and D (default 10)
 * @param averageLen - Average length for WT1 EMA (default 21)
 * @param maLen - MA length for WT2 signal line (default 4)
 * @param overboughtLevel - Overbought threshold (default 60)
 * @param oversoldLevel - Oversold threshold (default -60)
 * @returns WaveTrendResult
 */
export function calculateWaveTrend(
  candles: Candle[],
  channelLen: number = 10,
  averageLen: number = 21,
  maLen: number = 4,
  overboughtLevel: number = 60,
  oversoldLevel: number = -60
): WaveTrendResult {
  if (candles.length < Math.max(channelLen, averageLen) + 5) {
    return {
      wt1: [],
      wt2: [],
      currentWT1: null,
      currentWT2: null,
      zone: "neutral",
      crossover: "none",
      momentum: "flat",
      cmf: null,
      cmfBias: "neutral",
      interpretation: "Insufficient data for WaveTrend calculation",
    };
  }

  // Step 1: HLC3
  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);

  // Step 2: ESA = EMA(HLC3, channelLen)
  const esaValues = ema(hlc3, channelLen);

  // Step 3: D = EMA(|HLC3 - ESA|, channelLen)
  const absDeviation = hlc3.map((v, i) => Math.abs(v - esaValues[i]!));
  const dValues = ema(absDeviation, channelLen);

  // Step 4: CI = (HLC3 - ESA) / (0.015 * D)
  const ci = hlc3.map((v, i) => {
    const d = dValues[i]!;
    return d !== 0 ? (v - esaValues[i]!) / (0.015 * d) : 0;
  });

  // Step 5: WT1 = EMA(CI, averageLen)
  const wt1 = ema(ci, averageLen);

  // Step 6: WT2 = SMA(WT1, maLen)
  const wt2 = sma(wt1, maLen);

  const n = wt1.length;
  const currentWT1 = wt1[n - 1]!;
  const currentWT2 = wt2[n - 1]!;
  const prevWT1 = n >= 2 ? wt1[n - 2]! : currentWT1;
  const prevWT2 = n >= 2 ? wt2[n - 2]! : currentWT2;

  // Zone
  const zone: "overbought" | "oversold" | "neutral" =
    currentWT1 > overboughtLevel
      ? "overbought"
      : currentWT1 < oversoldLevel
        ? "oversold"
        : "neutral";

  // Crossover detection
  let crossover: "bullish_cross" | "bearish_cross" | "none" = "none";
  if (prevWT1 <= prevWT2 && currentWT1 > currentWT2) crossover = "bullish_cross";
  else if (prevWT1 >= prevWT2 && currentWT1 < currentWT2) crossover = "bearish_cross";

  // Momentum
  const momentum: "rising" | "falling" | "flat" =
    currentWT1 > prevWT1 + 0.5 ? "rising" : currentWT1 < prevWT1 - 0.5 ? "falling" : "flat";

  // CMF for volume confirmation
  const cmf = calculateCMF(candles);
  const cmfBias: "bullish" | "bearish" | "neutral" =
    cmf !== null && cmf > 0.1 ? "bullish" : cmf !== null && cmf < -0.1 ? "bearish" : "neutral";

  const interpretation = buildWaveTrendInterpretation(
    currentWT1,
    currentWT2,
    zone,
    crossover,
    momentum,
    cmfBias,
    cmf
  );

  return {
    wt1,
    wt2,
    currentWT1: parseFloat(currentWT1.toFixed(2)),
    currentWT2: parseFloat(currentWT2.toFixed(2)),
    zone,
    crossover,
    momentum,
    cmf: cmf !== null ? parseFloat(cmf.toFixed(3)) : null,
    cmfBias,
    interpretation,
  };
}

function buildWaveTrendInterpretation(
  wt1: number,
  wt2: number,
  zone: string,
  crossover: string,
  momentum: string,
  cmfBias: string,
  cmf: number | null
): string {
  let msg = `WaveTrend: WT1=${wt1.toFixed(1)}, WT2=${wt2.toFixed(1)}. `;

  if (zone === "overbought") {
    msg += `OVERBOUGHT zone — watch for bearish crossover to sell. `;
  } else if (zone === "oversold") {
    msg += `OVERSOLD zone — watch for bullish crossover to buy. `;
  } else {
    msg += `Neutral zone. `;
  }

  if (crossover === "bullish_cross") {
    msg += `BULLISH CROSSOVER (WT1 crossed above WT2)`;
    if (zone === "oversold") msg += ` in oversold zone — strong buy signal`;
    msg += `. `;
  } else if (crossover === "bearish_cross") {
    msg += `BEARISH CROSSOVER (WT1 crossed below WT2)`;
    if (zone === "overbought") msg += ` in overbought zone — strong sell signal`;
    msg += `. `;
  }

  if (cmf !== null) {
    msg += `CMF: ${cmf.toFixed(2)} (${cmfBias}) — `;
    if (cmfBias === "bullish") msg += `money flowing in, confirms buying pressure.`;
    else if (cmfBias === "bearish") msg += `money flowing out, confirms selling pressure.`;
    else msg += `neutral flow.`;
  }

  return msg;
}

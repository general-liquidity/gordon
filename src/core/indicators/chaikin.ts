/**
 * Chaikin Accumulation/Distribution Line (A/D) and Chaikin Oscillator (ADOSC).
 *
 *   MFM (Money Flow Multiplier) = ((close - low) - (high - close)) / (high - low)
 *   MFV (Money Flow Volume)     = MFM * volume
 *   A/D[t]                      = A/D[t-1] + MFV[t]            (running sum)
 *   ADOSC                       = EMA(A/D, fast) - EMA(A/D, slow)   (3/10 default)
 *
 * A/D rising = accumulation (buying pressure); ADOSC crossing zero = momentum
 * shift in the A/D line.
 */

import type { Candle } from "./types.ts";

export interface ChaikinADResult {
  /** Current A/D line value */
  current: number | null;
  /** A/D line series (cumulative; defined from the first bar) */
  values: (number | null)[];
  /** Direction of the A/D line over the last bar */
  trend: "accumulation" | "distribution" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

export interface ChaikinOscResult {
  /** Current ADOSC value */
  current: number | null;
  /** ADOSC series (null during warmup) */
  values: (number | null)[];
  /** Zero-line crossover */
  crossover: "bullish_cross" | "bearish_cross" | "none";
  /** Signal from sign + crossover */
  signal: "buy" | "sell" | "neutral";
  /** Interpretation string */
  interpretation: string;
  /** Fast / slow periods */
  periods: [number, number];
}

function moneyFlowVolume(c: Candle): number {
  const range = c.high - c.low;
  if (range < 1e-10) return 0;
  const mfm = (c.close - c.low - (c.high - c.close)) / range;
  return mfm * c.volume;
}

/** Aligned EMA with null warmup, SMA-seeded. Tolerates leading nulls in input. */
function emaAligned(data: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = data.map(() => null);
  let start = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== null) {
      start = i;
      break;
    }
  }
  if (start === -1 || data.length - start < period) return out;

  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += data[i]!;
  let ema = sum / period;
  out[start + period - 1] = ema;

  for (let i = start + period; i < data.length; i++) {
    if (data[i] === null) continue;
    ema = (data[i]! - ema) * multiplier + ema;
    out[i] = ema;
  }
  return out;
}

/**
 * Chaikin Accumulation/Distribution Line.
 *
 * @param candles - OHLCV candle array
 * @returns ChaikinADResult
 */
export function calculateChaikinAD(candles: Candle[]): ChaikinADResult {
  if (candles.length === 0) {
    return {
      current: null,
      values: [],
      trend: "neutral",
      interpretation: "Insufficient data for Chaikin A/D calculation",
    };
  }

  const values: (number | null)[] = [];
  let ad = 0;
  for (let i = 0; i < candles.length; i++) {
    ad += moneyFlowVolume(candles[i]!);
    values.push(parseFloat(ad.toFixed(2)));
  }

  const current = values[values.length - 1] ?? null;

  let trend: "accumulation" | "distribution" | "neutral" = "neutral";
  if (values.length >= 2) {
    const prev = values[values.length - 2]!;
    if (current !== null) {
      if (current > prev) trend = "accumulation";
      else if (current < prev) trend = "distribution";
    }
  }

  const interpretation =
    current === null
      ? "Insufficient data for Chaikin A/D."
      : `Chaikin A/D: ${current.toFixed(0)} — ${trend} on the last bar.`;

  return { current, values, trend, interpretation };
}

/**
 * Chaikin Oscillator: EMA(A/D, fast) - EMA(A/D, slow).
 *
 * @param candles - OHLCV candle array
 * @param fast - Fast EMA period (default 3)
 * @param slow - Slow EMA period (default 10)
 * @returns ChaikinOscResult
 */
export function calculateChaikinOscillator(
  candles: Candle[],
  fast: number = 3,
  slow: number = 10,
): ChaikinOscResult {
  const periods: [number, number] = [fast, slow];
  if (candles.length < slow) {
    return {
      current: null,
      values: candles.map(() => null),
      crossover: "none",
      signal: "neutral",
      interpretation: "Insufficient data for Chaikin Oscillator calculation",
      periods,
    };
  }

  const ad = calculateChaikinAD(candles).values;
  const emaFast = emaAligned(ad, fast);
  const emaSlow = emaAligned(ad, slow);

  const values: (number | null)[] = candles.map((_, i) => {
    if (emaFast[i] === null || emaSlow[i] === null) return null;
    return parseFloat((emaFast[i]! - emaSlow[i]!).toFixed(2));
  });

  const current = values[values.length - 1] ?? null;
  let prev: number | null = null;
  for (let i = values.length - 2; i >= 0; i--) {
    if (values[i] !== null) {
      prev = values[i]!;
      break;
    }
  }

  let crossover: "bullish_cross" | "bearish_cross" | "none" = "none";
  if (current !== null && prev !== null) {
    if (prev <= 0 && current > 0) crossover = "bullish_cross";
    else if (prev >= 0 && current < 0) crossover = "bearish_cross";
  }

  let signal: "buy" | "sell" | "neutral" = "neutral";
  if (crossover === "bullish_cross") signal = "buy";
  else if (crossover === "bearish_cross") signal = "sell";

  let interpretation = "";
  if (current === null) {
    interpretation = "Insufficient data for Chaikin Oscillator.";
  } else if (crossover === "bullish_cross") {
    interpretation = `Chaikin Osc: ${current.toFixed(0)} — BULLISH zero-line cross (accumulation accelerating).`;
  } else if (crossover === "bearish_cross") {
    interpretation = `Chaikin Osc: ${current.toFixed(0)} — BEARISH zero-line cross (distribution accelerating).`;
  } else {
    interpretation = `Chaikin Osc: ${current.toFixed(0)} — ${current > 0 ? "positive (accumulation)" : current < 0 ? "negative (distribution)" : "neutral"}.`;
  }

  return { current, values, crossover, signal, interpretation, periods };
}

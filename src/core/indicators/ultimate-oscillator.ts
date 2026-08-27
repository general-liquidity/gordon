/**
 * Ultimate Oscillator (ULTOSC)
 * Larry Williams's multi-timeframe momentum oscillator combining 7/14/28
 * period buying pressure averages with weights 4/2/1 to reduce false
 * divergences. Scale 0-100; >70 overbought, <30 oversold.
 *
 *   BP   = close - min(low, prevClose)               (buying pressure)
 *   TR   = max(high, prevClose) - min(low, prevClose) (true range)
 *   avgN = sum(BP, N) / sum(TR, N)
 *   UO   = 100 * (4*avg7 + 2*avg14 + 1*avg28) / 7
 */

import type { Candle } from "./types.ts";

export interface UltimateOscResult {
  /** Current UO value (0-100) */
  current: number | null;
  /** UO series (null during warmup) */
  values: (number | null)[];
  /** Signal zone */
  signal: "overbought" | "oversold" | "neutral";
  /** Interpretation string */
  interpretation: string;
  /** Periods used */
  periods: [number, number, number];
}

/**
 * Calculate Ultimate Oscillator.
 *
 * @param candles - OHLCV candle array
 * @param short - Short period (default 7)
 * @param medium - Medium period (default 14)
 * @param long - Long period (default 28)
 * @returns UltimateOscResult
 */
export function calculateUltimateOscillator(
  candles: Candle[],
  short: number = 7,
  medium: number = 14,
  long: number = 28,
): UltimateOscResult {
  const periods: [number, number, number] = [short, medium, long];

  if (candles.length < long + 1) {
    return {
      current: null,
      values: candles.map(() => null),
      signal: "neutral",
      interpretation: "Insufficient data for Ultimate Oscillator calculation",
      periods,
    };
  }

  // Buying pressure & true range per bar (first bar has no prevClose).
  const bp: number[] = [0];
  const tr: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    const trueLow = Math.min(c.low, prevClose);
    bp.push(c.close - trueLow);
    tr.push(Math.max(c.high, prevClose) - trueLow);
  }

  const avg = (i: number, n: number): number | null => {
    if (i < n) return null;
    let bpSum = 0;
    let trSum = 0;
    for (let j = i - n + 1; j <= i; j++) {
      bpSum += bp[j]!;
      trSum += tr[j]!;
    }
    if (trSum < 1e-10) return 0;
    return bpSum / trSum;
  };

  const values: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    const a7 = avg(i, short);
    const a14 = avg(i, medium);
    const a28 = avg(i, long);
    if (a7 === null || a14 === null || a28 === null) {
      values.push(null);
    } else {
      const uo = (100 * (4 * a7 + 2 * a14 + a28)) / 7;
      values.push(parseFloat(uo.toFixed(2)));
    }
  }

  const current = values[values.length - 1] ?? null;

  let signal: "overbought" | "oversold" | "neutral" = "neutral";
  if (current !== null) {
    if (current > 70) signal = "overbought";
    else if (current < 30) signal = "oversold";
  }

  let interpretation = "";
  if (current === null) {
    interpretation = "Insufficient data for Ultimate Oscillator.";
  } else if (signal === "overbought") {
    interpretation = `ULTOSC: ${current.toFixed(1)} — overbought across timeframes.`;
  } else if (signal === "oversold") {
    interpretation = `ULTOSC: ${current.toFixed(1)} — oversold across timeframes.`;
  } else {
    interpretation = `ULTOSC: ${current.toFixed(1)} — neutral momentum.`;
  }

  return { current, values, signal, interpretation, periods };
}

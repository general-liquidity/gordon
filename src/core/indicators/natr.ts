/**
 * Normalized Average True Range (NATR)
 * ATR expressed as a percentage of the closing price, making volatility
 * comparable across instruments and price levels.
 *
 *   NATR = ATR / close * 100
 *
 * Reuses calculateATR from atr.ts read-only.
 */

import type { Candle } from "./types.ts";
import { calculateATR } from "./atr.ts";

export interface NATRResult {
  /** Current NATR value (percent) */
  current: number | null;
  /** NATR series (null during warmup) */
  values: (number | null)[];
  /** Current raw ATR value */
  atr: number | null;
  /** Volatility classification */
  volatility: "low" | "normal" | "elevated" | "high";
  /** Interpretation string */
  interpretation: string;
  /** Period */
  period: number;
}

/**
 * Calculate Normalized ATR.
 *
 * @param candles - OHLCV candle array
 * @param period - ATR period (default 14)
 * @returns NATRResult
 */
export function calculateNATR(candles: Candle[], period: number = 14): NATRResult {
  const atrResult = calculateATR(candles, period);

  const values: (number | null)[] = atrResult.values.map((atr, i) => {
    if (atr === null) return null;
    const close = candles[i]!.close;
    if (close === 0) return null;
    return parseFloat(((atr / close) * 100).toFixed(2));
  });

  const current = values[values.length - 1] ?? null;

  let volatility: "low" | "normal" | "elevated" | "high" = "normal";
  if (current !== null) {
    if (current < 1) volatility = "low";
    else if (current < 3) volatility = "normal";
    else if (current < 5) volatility = "elevated";
    else volatility = "high";
  }

  const interpretation =
    current === null
      ? "Insufficient data for NATR calculation"
      : `NATR: ${current.toFixed(2)}% (${volatility} volatility) — ATR as % of price.`;

  return {
    current,
    values,
    atr: atrResult.current,
    volatility,
    interpretation,
    period,
  };
}

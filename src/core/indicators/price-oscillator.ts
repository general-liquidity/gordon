/**
 * Absolute & Percentage Price Oscillator (APO / PPO)
 * Difference between a fast and slow EMA of closes.
 *
 *   APO = EMA(fast) - EMA(slow)                 (absolute, price units)
 *   PPO = (EMA(fast) - EMA(slow)) / EMA(slow) * 100   (normalized, percent)
 *
 * PPO is comparable across instruments; APO is in raw price units.
 * Both are positive when the fast EMA leads (bullish momentum).
 */

export interface PriceOscResult {
  /** Current oscillator value */
  current: number | null;
  /** Oscillator series (null during warmup) */
  values: (number | null)[];
  /** Trend from the sign of the oscillator */
  trend: "bullish" | "bearish" | "neutral";
  /** Interpretation string */
  interpretation: string;
  /** Fast / slow periods */
  periods: [number, number];
}

/** Aligned EMA with null warmup, SMA-seeded (matches ema.ts). */
function emaAligned(data: number[], period: number): (number | null)[] {
  const out: (number | null)[] = data.map(() => null);
  if (data.length < period) return out;

  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i]!;
  let ema = sum / period;
  out[period - 1] = ema;

  for (let i = period; i < data.length; i++) {
    ema = (data[i]! - ema) * multiplier + ema;
    out[i] = ema;
  }
  return out;
}

function classify(current: number | null): "bullish" | "bearish" | "neutral" {
  if (current === null) return "neutral";
  if (current > 0) return "bullish";
  if (current < 0) return "bearish";
  return "neutral";
}

/**
 * Absolute Price Oscillator: EMA(fast) - EMA(slow), in price units.
 *
 * @param closes - Array of closing prices
 * @param fast - Fast EMA period (default 12)
 * @param slow - Slow EMA period (default 26)
 * @returns PriceOscResult
 */
export function calculateAPO(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
): PriceOscResult {
  const periods: [number, number] = [fast, slow];
  if (closes.length < slow) {
    return {
      current: null,
      values: closes.map(() => null),
      trend: "neutral",
      interpretation: "Insufficient data for APO calculation",
      periods,
    };
  }

  const emaFast = emaAligned(closes, fast);
  const emaSlow = emaAligned(closes, slow);

  const values: (number | null)[] = closes.map((_, i) => {
    if (emaFast[i] === null || emaSlow[i] === null) return null;
    return parseFloat((emaFast[i]! - emaSlow[i]!).toFixed(4));
  });

  const current = values[values.length - 1] ?? null;
  const trend = classify(current);
  const interpretation =
    current === null
      ? "Insufficient data for APO."
      : `APO: ${current.toFixed(4)} — fast EMA ${trend === "bullish" ? "above" : trend === "bearish" ? "below" : "at"} slow EMA (${trend}).`;

  return { current, values, trend, interpretation, periods };
}

/**
 * Percentage Price Oscillator: (EMA(fast) - EMA(slow)) / EMA(slow) * 100.
 *
 * @param closes - Array of closing prices
 * @param fast - Fast EMA period (default 12)
 * @param slow - Slow EMA period (default 26)
 * @returns PriceOscResult
 */
export function calculatePPO(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
): PriceOscResult {
  const periods: [number, number] = [fast, slow];
  if (closes.length < slow) {
    return {
      current: null,
      values: closes.map(() => null),
      trend: "neutral",
      interpretation: "Insufficient data for PPO calculation",
      periods,
    };
  }

  const emaFast = emaAligned(closes, fast);
  const emaSlow = emaAligned(closes, slow);

  const values: (number | null)[] = closes.map((_, i) => {
    const ef = emaFast[i];
    const es = emaSlow[i];
    if (ef == null || es == null || es === 0) return null;
    return parseFloat((((ef - es) / es) * 100).toFixed(4));
  });

  const current = values[values.length - 1] ?? null;
  const trend = classify(current);
  const interpretation =
    current === null
      ? "Insufficient data for PPO."
      : `PPO: ${current.toFixed(2)}% — ${trend} momentum (fast vs slow EMA, normalized).`;

  return { current, values, trend, interpretation, periods };
}

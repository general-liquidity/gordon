/**
 * Chande Momentum Oscillator (CMO)
 * Tushar Chande's momentum oscillator on a -100..+100 scale. Unlike RSI it
 * uses both up and down sums in the numerator (not just smoothing), making it
 * more responsive.
 *
 *   CMO = 100 * (sumUp - sumDown) / (sumUp + sumDown)
 *
 * where sumUp/sumDown are the sums of gains/losses over the lookback.
 * +50 = overbought, -50 = oversold.
 */

export interface CMOResult {
  /** Current CMO value (-100..+100) */
  current: number | null;
  /** CMO series (null during warmup) */
  values: (number | null)[];
  /** Signal zone */
  signal: "overbought" | "oversold" | "neutral";
  /** Interpretation string */
  interpretation: string;
  /** Lookback period */
  period: number;
}

/**
 * Calculate Chande Momentum Oscillator.
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period (default 14)
 * @returns CMOResult
 */
export function calculateCMO(closes: number[], period: number = 14): CMOResult {
  if (closes.length < period + 1) {
    return {
      current: null,
      values: closes.map(() => null),
      signal: "neutral",
      interpretation: "Insufficient data for CMO calculation",
      period,
    };
  }

  // Per-bar gains and losses (first bar has no delta).
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    gains.push(delta > 0 ? delta : 0);
    losses.push(delta < 0 ? -delta : 0);
  }

  const values: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      values.push(null);
      continue;
    }

    let sumUp = 0;
    let sumDown = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumUp += gains[j]!;
      sumDown += losses[j]!;
    }

    const total = sumUp + sumDown;
    if (total < 1e-10) {
      values.push(0);
    } else {
      const cmo = (100 * (sumUp - sumDown)) / total;
      values.push(parseFloat(cmo.toFixed(2)));
    }
  }

  const current = values[values.length - 1] ?? null;

  let signal: "overbought" | "oversold" | "neutral" = "neutral";
  if (current !== null) {
    if (current > 50) signal = "overbought";
    else if (current < -50) signal = "oversold";
  }

  const interpretation =
    current === null
      ? "Insufficient data for CMO."
      : `CMO: ${current.toFixed(1)} — ${
          signal === "overbought"
            ? "overbought (strong net buying)"
            : signal === "oversold"
              ? "oversold (strong net selling)"
              : "neutral momentum"
        }.`;

  return { current, values, signal, interpretation, period };
}

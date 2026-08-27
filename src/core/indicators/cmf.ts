/**
 * Chaikin Money Flow (CMF)
 * Windowed money-flow oscillator: the period-sum of Money Flow Volume divided
 * by the period-sum of volume. Bounded to [-1, 1].
 *
 *   MFM (Money Flow Multiplier) = ((close - low) - (high - close)) / (high - low)
 *   MFV (Money Flow Volume)     = MFM * volume
 *   CMF[t]                      = Σ(MFV, period) / Σ(volume, period)
 *
 * A flat-range bar (high == low) contributes 0 MFM (not NaN). A window whose
 * total volume is ≤ 0 yields null. CMF > 0.05 = accumulation (buying pressure),
 * CMF < -0.05 = distribution (selling pressure), else neutral.
 */

import type { Candle } from "./types.ts";

export interface CMFResult {
  /** CMF series (null during warmup / on zero-volume windows) */
  values: (number | null)[];
  /** Current CMF value */
  current: number | null;
  /** Money-flow bias from current value */
  signal: "accumulation" | "distribution" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

/** Money Flow Volume for a single bar; flat-range bar contributes 0. */
function moneyFlowVolume(c: Candle): number {
  const range = c.high - c.low;
  if (range <= 0) return 0;
  const mfm = (c.close - c.low - (c.high - c.close)) / range;
  return mfm * c.volume;
}

/**
 * Calculate Chaikin Money Flow.
 *
 * @param candles - OHLCV candle array
 * @param period - CMF lookback period (default 20)
 * @returns CMFResult
 */
export function calculateCMF(candles: Candle[], period: number = 20): CMFResult {
  if (candles.length < period) {
    return {
      values: candles.map(() => null),
      current: null,
      signal: "neutral",
      interpretation: "Insufficient data for CMF calculation",
    };
  }

  const mfv: number[] = candles.map((c) => moneyFlowVolume(c));
  const vol: number[] = candles.map((c) => c.volume);

  const values: (number | null)[] = candles.map(() => null);

  for (let i = period - 1; i < candles.length; i++) {
    let mfvSum = 0;
    let volSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      mfvSum += mfv[j]!;
      volSum += vol[j]!;
    }
    if (volSum <= 0) {
      values[i] = null;
      continue;
    }
    values[i] = parseFloat((mfvSum / volSum).toFixed(4));
  }

  const current = values[values.length - 1] ?? null;

  let signal: "accumulation" | "distribution" | "neutral" = "neutral";
  if (current !== null) {
    if (current > 0.05) signal = "accumulation";
    else if (current < -0.05) signal = "distribution";
  }

  const interpretation = buildInterpretation(current, signal);

  return { values, current, signal, interpretation };
}

function buildInterpretation(
  current: number | null,
  signal: "accumulation" | "distribution" | "neutral",
): string {
  if (current === null) return "Insufficient data for CMF.";
  const val = current.toFixed(3);
  if (signal === "accumulation") {
    return `CMF: ${val} — ACCUMULATION (buying pressure; closes are clustering near the highs on volume).`;
  }
  if (signal === "distribution") {
    return `CMF: ${val} — DISTRIBUTION (selling pressure; closes are clustering near the lows on volume).`;
  }
  return `CMF: ${val} — neutral money flow (no decisive buy/sell pressure).`;
}

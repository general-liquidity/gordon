/**
 * Kalman Filter Indicator
 * Zero-lag trend smoother using prediction-correction cycle.
 * Mathematically superior to moving averages — adapts to noise dynamically.
 *
 * Based on Moon Dev's Kalman Filter implementation.
 */

import type { Candle } from "./types.ts";

export interface KalmanFilterResult {
  /** Smoothed (filtered) values for each candle */
  values: number[];
  /** Current filtered value */
  current: number | null;
  /** Slope of the filtered line (change per bar) */
  slope: number | null;
  /** Deviation of current price from filtered value (%) */
  deviation: number | null;
  /** Trend direction based on slope */
  trend: "bullish" | "bearish" | "neutral";
  /** Whether price is overextended from fair value */
  overextended: boolean;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Kalman Filter class — single-state predict-correct cycle.
 *
 * @param processVariance - Q: how fast the "true" state can change (default 1e-5)
 * @param measurementVariance - R: how noisy the measurements are (default 1e-1)
 *
 * Lower Q = smoother line (trusts model more).
 * Lower R = line follows price more closely (trusts measurements more).
 */
class KalmanFilterEngine {
  private estimate: number | null = null;
  private errorEstimate: number | null = null;

  constructor(
    private processVariance: number = 1e-5,
    private measurementVariance: number = 1e-1
  ) {}

  filter(measurement: number): number {
    if (this.estimate === null || this.errorEstimate === null) {
      this.estimate = measurement;
      this.errorEstimate = 1.0;
      return measurement;
    }

    // Prediction step
    const prioriEstimate = this.estimate;
    const prioriError = this.errorEstimate + this.processVariance;

    // Update step
    const kalmanGain = prioriError / (prioriError + this.measurementVariance);
    this.estimate = prioriEstimate + kalmanGain * (measurement - prioriEstimate);
    this.errorEstimate = (1 - kalmanGain) * prioriError;

    return this.estimate;
  }
}

/**
 * Calculate Kalman-filtered trend for a candle series.
 *
 * @param candles - OHLCV candle array
 * @param processVariance - Q parameter (default 1e-5, lower = smoother)
 * @param measurementVariance - R parameter (default 0.1, lower = more responsive)
 * @param deviationThreshold - % deviation to flag overextension (default 5)
 * @returns KalmanFilterResult
 */
export function calculateKalmanFilter(
  candles: Candle[],
  processVariance: number = 1e-5,
  measurementVariance: number = 0.1,
  deviationThreshold: number = 5
): KalmanFilterResult {
  if (candles.length < 2) {
    return {
      values: [],
      current: null,
      slope: null,
      deviation: null,
      trend: "neutral",
      overextended: false,
      interpretation: "Insufficient data for Kalman filter",
    };
  }

  const kf = new KalmanFilterEngine(processVariance, measurementVariance);
  const values: number[] = [];

  for (const candle of candles) {
    values.push(kf.filter(candle.close));
  }

  const current = values[values.length - 1]!;
  const prev = values[values.length - 2]!;
  const slope = current - prev;

  const lastClose = candles[candles.length - 1]!.close;
  const deviation = ((lastClose - current) / current) * 100;
  const overextended = Math.abs(deviation) > deviationThreshold;

  // Trend from slope — use a small threshold relative to current price
  const slopeThreshold = current * 0.0001; // 0.01% of price
  const trend: "bullish" | "bearish" | "neutral" =
    slope > slopeThreshold ? "bullish" : slope < -slopeThreshold ? "bearish" : "neutral";

  const interpretation = buildKalmanInterpretation(
    lastClose,
    current,
    slope,
    deviation,
    trend,
    overextended
  );

  return {
    values,
    current,
    slope,
    deviation: parseFloat(deviation.toFixed(2)),
    trend,
    overextended,
    interpretation,
  };
}

function buildKalmanInterpretation(
  price: number,
  fairValue: number,
  slope: number,
  deviation: number,
  trend: string,
  overextended: boolean
): string {
  const dir = trend === "bullish" ? "upward" : trend === "bearish" ? "downward" : "flat";
  const devStr = deviation > 0 ? "above" : "below";

  let msg =
    `Kalman fair value at ${fairValue.toFixed(2)} (slope ${dir}). ` +
    `Price is ${Math.abs(deviation).toFixed(1)}% ${devStr} fair value.`;

  if (overextended) {
    if (deviation > 0) {
      msg += ` Overextended above — potential mean reversion short opportunity.`;
    } else {
      msg += ` Overextended below — potential mean reversion long opportunity.`;
    }
  } else if (trend === "bullish") {
    msg += ` Trend is bullish — look for dips toward the Kalman line as entries.`;
  } else if (trend === "bearish") {
    msg += ` Trend is bearish — look for rallies toward the Kalman line as short entries.`;
  }

  return msg;
}

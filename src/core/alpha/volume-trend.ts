/**
 * Volume-Trend Verdict
 *
 * Quantifies Spicy's cheat sheet — "increasing volume is good for
 * breakouts, decreasing volume is good for reversals" — as a verdict
 * with intensity. The raw `volume_trend: rising|falling|stable` label
 * already exists in `core/regime/classifier.ts`, but it's binary-ish.
 * Spicy's lesson 4 explicitly argues against binary thinking: it's
 * the *intensity* of the slope that matters.
 *
 * Procedure:
 *   1. Compute per-candle USD volume (close × volume)
 *   2. Fit OLS slope over last N candles
 *   3. Express slope as percent-per-candle change relative to the
 *      window mean (scale-invariant)
 *   4. Map (sign, magnitude) → verdict + intensity band
 *
 * Pure function. Composes with `usdVolumeGate.ts` (a tradeable coin
 * with strongly-increasing USD volume is a high-conviction breakout
 * environment).
 */
import { trendSlope, mean } from "./helpers.ts";

export interface VolumeTrendCandle {
  close: number;
  volume: number;
}

export interface VolumeTrendOptions {
  /** Lookback window in candles. Default 20. */
  window?: number;
  /** Minimum candles required to produce a verdict. Default 10. */
  minCandles?: number;
  /**
   * Intensity bands as percent-per-candle change. Symmetric.
   * Defaults match Spicy's intuition: ≥10%/candle is "intense",
   * 3–10%/candle is "moderate", <3% is "weak".
   */
  intenseThresholdPct?: number;
  moderateThresholdPct?: number;
}

export type VolumeIntensity = "intense" | "moderate" | "weak" | "flat";
export type VolumeDirection = "increasing" | "decreasing" | "flat";

export type VolumeTrendVerdict =
  | "strongly_breakout_friendly"
  | "moderately_breakout_friendly"
  | "weakly_breakout_friendly"
  | "neutral"
  | "weakly_reversal_friendly"
  | "moderately_reversal_friendly"
  | "strongly_reversal_friendly"
  | "insufficient_data";

export interface VolumeTrendResult {
  windowSize: number;
  meanVolUSD: number;
  /** OLS slope in USD-per-candle. */
  slopeUSDPerCandle: number;
  /** Slope expressed as % of window mean per candle (scale-invariant). */
  slopePctPerCandle: number;
  direction: VolumeDirection;
  intensity: VolumeIntensity;
  verdict: VolumeTrendVerdict;
  summary: string;
}

const DEFAULT_WINDOW = 20;
const DEFAULT_MIN_CANDLES = 10;
const DEFAULT_INTENSE_PCT = 10;
const DEFAULT_MODERATE_PCT = 3;

function classifyIntensity(
  absPct: number,
  intensePct: number,
  moderatePct: number,
): VolumeIntensity {
  if (absPct < 0.5) return "flat";
  if (absPct >= intensePct) return "intense";
  if (absPct >= moderatePct) return "moderate";
  return "weak";
}

function verdictFor(direction: VolumeDirection, intensity: VolumeIntensity): VolumeTrendVerdict {
  if (intensity === "flat" || direction === "flat") return "neutral";
  if (direction === "increasing") {
    if (intensity === "intense") return "strongly_breakout_friendly";
    if (intensity === "moderate") return "moderately_breakout_friendly";
    return "weakly_breakout_friendly";
  }
  if (intensity === "intense") return "strongly_reversal_friendly";
  if (intensity === "moderate") return "moderately_reversal_friendly";
  return "weakly_reversal_friendly";
}

export function analyzeVolumeTrend(
  candles: ReadonlyArray<VolumeTrendCandle>,
  options: VolumeTrendOptions = {},
): VolumeTrendResult {
  const window = options.window ?? DEFAULT_WINDOW;
  const minCandles = options.minCandles ?? DEFAULT_MIN_CANDLES;
  const intensePct = options.intenseThresholdPct ?? DEFAULT_INTENSE_PCT;
  const moderatePct = options.moderateThresholdPct ?? DEFAULT_MODERATE_PCT;

  if (candles.length < minCandles) {
    return {
      windowSize: candles.length,
      meanVolUSD: 0,
      slopeUSDPerCandle: 0,
      slopePctPerCandle: 0,
      direction: "flat",
      intensity: "flat",
      verdict: "insufficient_data",
      summary: `Insufficient candles (${candles.length} < ${minCandles}).`,
    };
  }

  const effectiveWindow = Math.min(window, candles.length);
  const tail = candles.slice(candles.length - effectiveWindow);
  const volUSD = tail.map((c) => c.close * c.volume);
  const meanVolUSD = mean(volUSD);

  if (meanVolUSD <= 0) {
    return {
      windowSize: effectiveWindow,
      meanVolUSD: 0,
      slopeUSDPerCandle: 0,
      slopePctPerCandle: 0,
      direction: "flat",
      intensity: "flat",
      verdict: "neutral",
      summary: "Zero volume across the window — neutral by construction.",
    };
  }

  const slope = trendSlope(volUSD);
  const slopePct = (slope / meanVolUSD) * 100;
  const absPct = Math.abs(slopePct);

  const direction: VolumeDirection =
    absPct < 0.5 ? "flat" : slopePct > 0 ? "increasing" : "decreasing";
  const intensity = classifyIntensity(absPct, intensePct, moderatePct);
  const verdict = verdictFor(direction, intensity);

  const summary =
    `${effectiveWindow}-candle slope: ${slopePct.toFixed(2)}%/candle (mean $${meanVolUSD.toFixed(0)}). ` +
    `→ ${direction}, ${intensity} → ${verdict}`;

  return {
    windowSize: effectiveWindow,
    meanVolUSD: parseFloat(meanVolUSD.toFixed(4)),
    slopeUSDPerCandle: parseFloat(slope.toFixed(4)),
    slopePctPerCandle: parseFloat(slopePct.toFixed(4)),
    direction,
    intensity,
    verdict,
    summary,
  };
}

export function formatVolumeTrend(result: VolumeTrendResult): string {
  const lines = [
    `Volume Trend — ${result.verdict.toUpperCase()}`,
    "",
    `  Window: ${result.windowSize} candles`,
    `  Mean USD volume: $${result.meanVolUSD.toFixed(0)}`,
    `  Slope: $${result.slopeUSDPerCandle.toFixed(0)}/candle (${result.slopePctPerCandle.toFixed(2)}%/candle)`,
    `  Direction: ${result.direction}`,
    `  Intensity: ${result.intensity}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}

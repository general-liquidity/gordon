/**
 * Force Index + Elder-Ray (GORDON_ELDER_MOMENTUM).
 *
 * Two volume/price momentum measures from Alexander Elder, components
 * of the Triple Screen system (TSaM Ch 19).
 *
 *   Force Index = Volume · (Close - PreviousClose)
 *                 (then smoothed by a short EMA, typically 2-period)
 *
 *   Bull Power  = High - EMA(Close, n)
 *   Bear Power  = Low  - EMA(Close, n)
 *
 * Force Index combines direction (sign), magnitude (price change), and
 * conviction (volume). Smoothed Force Index dropping below zero in an
 * uptrend marks the pullback the Triple Screen waits for.
 *
 * Elder-Ray separates bulls and bears around an EMA: when Bull Power is
 * positive bulls dominate; when Bear Power is negative the bears do.
 * Both measures together describe the balance of pressure either side
 * of the moving average.
 */

export const ELDER_MOMENTUM_FLAG_ENV = "GORDON_ELDER_MOMENTUM";

export function isElderMomentumEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ELDER_MOMENTUM_FLAG_ENV] === "1" || env[ELDER_MOMENTUM_FLAG_ENV] === "true";
}

export interface OhlcvBar {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ForceIndexInput {
  bars: ReadonlyArray<OhlcvBar>;
  /** EMA period for smoothing the raw force series. Default 2. */
  emaPeriod?: number;
}

export interface ForceIndexResult {
  raw: number[];
  smoothed: number[];
  current: number;
  sign: "positive" | "negative" | "zero";
  sampleSize: number;
}

export interface ElderRayInput {
  bars: ReadonlyArray<OhlcvBar>;
  /** EMA period for the central reference line. Default 13. */
  emaPeriod?: number;
}

export interface ElderRayResult {
  bullPower: number[];
  bearPower: number[];
  currentBull: number;
  currentBear: number;
  bias: "bullish" | "bearish" | "neutral";
  sampleSize: number;
}

const DEFAULT_FORCE_EMA = 2;
const DEFAULT_RAY_EMA = 13;

function emaSeries(values: ReadonlyArray<number>, alpha: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length === 0) return out;
  out[0] = values[0]!;
  for (let i = 1; i < values.length; i++) {
    out[i] = out[i - 1]! + alpha * (values[i]! - out[i - 1]!);
  }
  return out;
}

export function computeForceIndex(input: ForceIndexInput): ForceIndexResult {
  const period = input.emaPeriod ?? DEFAULT_FORCE_EMA;
  const alpha = 2 / (period + 1);
  const bars = input.bars;
  const n = bars.length;
  const raw: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    raw[i] = bars[i]!.volume * (bars[i]!.close - bars[i - 1]!.close);
  }
  const smoothed = emaSeries(raw, alpha);
  const current = smoothed[n - 1] ?? 0;
  const sign = current > 0 ? "positive" : current < 0 ? "negative" : "zero";
  return { raw, smoothed, current, sign, sampleSize: n };
}

export function computeElderRay(input: ElderRayInput): ElderRayResult {
  const period = input.emaPeriod ?? DEFAULT_RAY_EMA;
  const alpha = 2 / (period + 1);
  const bars = input.bars;
  const closes = bars.map((b) => b.close);
  const ema = emaSeries(closes, alpha);
  const bull = bars.map((b, i) => b.high - ema[i]!);
  const bear = bars.map((b, i) => b.low - ema[i]!);
  const n = bars.length;
  const currentBull = bull[n - 1] ?? 0;
  const currentBear = bear[n - 1] ?? 0;
  let bias: ElderRayResult["bias"] = "neutral";
  if (currentBull > 0 && currentBear > 0) bias = "bullish";
  else if (currentBull < 0 && currentBear < 0) bias = "bearish";
  return { bullPower: bull, bearPower: bear, currentBull, currentBear, bias, sampleSize: n };
}

export function forceIndexToPayload(result: ForceIndexResult): Record<string, unknown> {
  return {
    kind: "force_index.computed",
    current: Number(result.current.toFixed(2)),
    sign: result.sign,
    sampleSize: result.sampleSize,
  };
}

export function elderRayToPayload(result: ElderRayResult): Record<string, unknown> {
  return {
    kind: "elder_ray.computed",
    currentBull: Number(result.currentBull.toFixed(5)),
    currentBear: Number(result.currentBear.toFixed(5)),
    bias: result.bias,
    sampleSize: result.sampleSize,
  };
}

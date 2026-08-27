/**
 * Logit-RSI Transform (GORDON_LOGIT_RSI).
 *
 * Standard RSI is bounded [0, 100], which violates the normality assumption
 * required by Bollinger Bands, z-scores, and stationary-regression methods.
 * The logit transform maps RSI to an unbounded scale:
 *
 *   logit(RSI) = ln(RSI / (100 - RSI))
 *
 * The transformed series is approximately normal under typical market
 * conditions, which lets us legitimately apply Bollinger Bands, percentile
 * banding, and tail-event detection on top of RSI itself.
 *
 * Use cases:
 *   - Detect extreme-extreme readings via z-score on logit (|z| > 2.5)
 *   - Apply BB(logit-RSI) as an oscillator-of-oscillator squeeze detector
 *   - Stationarity tests on logit-RSI rather than raw RSI
 *
 * Pure compute. No I/O.
 */

export interface LogitRsiInput {
  prices: ReadonlyArray<number>;
  /** RSI period. Default 14 (Wilder). */
  rsiPeriod?: number;
  /** Bollinger Band period applied to logit-RSI. Default 20. */
  bbPeriod?: number;
  /** Std-dev multiplier for the BB bands. Default 2.0. */
  bbStdMultiplier?: number;
  /** Floor/ceiling clamp before logit to avoid ±Infinity. Default 0.5. */
  epsilon?: number;
}

export type LogitRsiZone =
  | "extreme_oversold"
  | "oversold"
  | "neutral"
  | "overbought"
  | "extreme_overbought";

export interface LogitRsiResult {
  rsi: number[];
  logitRsi: number[];
  logitMean: number[];
  logitUpper: number[];
  logitLower: number[];
  currentRsi: number;
  currentLogit: number;
  currentZScore: number;
  currentZone: LogitRsiZone;
  squeeze: boolean;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_RSI_PERIOD = 14;
const DEFAULT_BB_PERIOD = 20;
const DEFAULT_BB_STD = 2.0;
const DEFAULT_EPSILON = 0.5;

function calcWilderRsi(prices: ReadonlyArray<number>, period: number): number[] {
  const out: number[] = new Array(prices.length).fill(Number.NaN);
  if (prices.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i]! - prices[i - 1]!;
    if (d > 0) avgGain += d;
    else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i]! - prices[i - 1]!;
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function classifyZone(z: number): LogitRsiZone {
  if (z >= 2.5) return "extreme_overbought";
  if (z >= 1.0) return "overbought";
  if (z <= -2.5) return "extreme_oversold";
  if (z <= -1.0) return "oversold";
  return "neutral";
}

export function computeLogitRsi(input: LogitRsiInput): LogitRsiResult {
  const rsiPeriod = input.rsiPeriod ?? DEFAULT_RSI_PERIOD;
  const bbPeriod = input.bbPeriod ?? DEFAULT_BB_PERIOD;
  const bbStd = input.bbStdMultiplier ?? DEFAULT_BB_STD;
  const eps = input.epsilon ?? DEFAULT_EPSILON;
  const n = input.prices.length;

  const rsi = calcWilderRsi(input.prices, rsiPeriod);
  const logit: number[] = new Array(n).fill(Number.NaN);
  const mean: number[] = new Array(n).fill(Number.NaN);
  const upper: number[] = new Array(n).fill(Number.NaN);
  const lower: number[] = new Array(n).fill(Number.NaN);

  for (let i = 0; i < n; i++) {
    const r = rsi[i]!;
    if (!Number.isFinite(r)) continue;
    const clamped = Math.max(eps, Math.min(100 - eps, r));
    logit[i] = Math.log(clamped / (100 - clamped));
  }

  for (let i = rsiPeriod + bbPeriod - 1; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - bbPeriod + 1; j <= i; j++) {
      const v = logit[j]!;
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count < 2) continue;
    const m = sum / count;
    let ss = 0;
    for (let j = i - bbPeriod + 1; j <= i; j++) {
      const v = logit[j]!;
      if (Number.isFinite(v)) ss += (v - m) * (v - m);
    }
    const sigma = Math.sqrt(ss / (count - 1));
    mean[i] = m;
    upper[i] = m + bbStd * sigma;
    lower[i] = m - bbStd * sigma;
  }

  const lastIdx = n - 1;
  const currentRsi = rsi[lastIdx] ?? Number.NaN;
  const currentLogit = logit[lastIdx] ?? Number.NaN;
  const currentMean = mean[lastIdx] ?? Number.NaN;
  const currentUpper = upper[lastIdx] ?? Number.NaN;
  const currentLower = lower[lastIdx] ?? Number.NaN;

  let z = Number.NaN;
  if ([currentLogit, currentMean, currentUpper, currentLower].every(Number.isFinite)) {
    const half = (currentUpper - currentLower) / 2;
    const sigma = half / bbStd;
    z = sigma > 0 ? (currentLogit - currentMean) / sigma : 0;
  }

  const zone = Number.isFinite(z) ? classifyZone(z) : "neutral";

  let squeeze = false;
  if (
    n >= rsiPeriod + bbPeriod * 2 &&
    Number.isFinite(currentUpper) &&
    Number.isFinite(currentLower)
  ) {
    const currentWidth = currentUpper - currentLower;
    let widthSum = 0;
    let widthCount = 0;
    for (let i = lastIdx - bbPeriod; i < lastIdx; i++) {
      if (Number.isFinite(upper[i]!) && Number.isFinite(lower[i]!)) {
        widthSum += upper[i]! - lower[i]!;
        widthCount++;
      }
    }
    const avgWidth = widthCount > 0 ? widthSum / widthCount : 0;
    squeeze = avgWidth > 0 && currentWidth < avgWidth * 0.6;
  }

  const reasoning = Number.isFinite(z)
    ? `logit-RSI z=${z.toFixed(2)} (RSI=${currentRsi.toFixed(1)}) → ${zone}${squeeze ? ", squeeze" : ""}`
    : `need at least ${rsiPeriod + bbPeriod} prices, got ${n}`;

  return {
    rsi,
    logitRsi: logit,
    logitMean: mean,
    logitUpper: upper,
    logitLower: lower,
    currentRsi,
    currentLogit,
    currentZScore: z,
    currentZone: zone,
    squeeze,
    sampleSize: n,
    reasoning,
  };
}

export function logitRsiToPayload(result: LogitRsiResult): Record<string, unknown> {
  return {
    kind: "logit_rsi.computed",
    currentRsi: Number.isFinite(result.currentRsi) ? Number(result.currentRsi.toFixed(2)) : null,
    currentLogit: Number.isFinite(result.currentLogit)
      ? Number(result.currentLogit.toFixed(4))
      : null,
    currentZScore: Number.isFinite(result.currentZScore)
      ? Number(result.currentZScore.toFixed(3))
      : null,
    currentZone: result.currentZone,
    squeeze: result.squeeze,
    sampleSize: result.sampleSize,
  };
}

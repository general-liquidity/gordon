/**
 * VCP / Multi-Day Contraction Detector
 *
 * Minervini-style Volatility Contraction Pattern, codified by
 * Qullamaggie as the "5-day range < 10% of low + volume < 70% of
 * 20-day avg" tightening that precedes momentum breakouts. The
 * pattern combines THREE simultaneous contractions:
 *
 *   1. Candle BODY shrinks  (|close-open| / open declining)
 *   2. Candle RANGE shrinks ((high-low) / low declining)
 *   3. VOLUME declines      (USD volume slope negative)
 *
 * All three contracting at once = "fully loaded spring": sellers
 * are exhausted, institutions are quietly absorbing, next expansion
 * candle is the breakout.
 *
 * Distinct from:
 *   - `volume-trend.ts`     (volume slope ALONE — doesn't check range)
 *   - `squeeze-breakout`    (BB-keltner squeeze — different geometry)
 *   - `streak-detector.ts`  (direction streaks — orthogonal axis)
 *
 * Composes with:
 *   - `detect_streak` extreme + contraction = exhaustion AND coiling
 *   - `analyze_volume_trend` agrees on direction (decreasing) ⇒ stronger
 *   - `compute_margin_of_error` (breakout-long is in-sync when trending)
 *
 * Pure function over OHLCV bars.
 */
import { trendSlope, mean } from "./helpers.ts";

export interface VcpCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VcpOptions {
  /** Lookback in candles. Default 5 (Qullamaggie's 5-day window). */
  window?: number;
  /** Minimum candles required for a verdict. Default 4. */
  minCandles?: number;
  /**
   * Body-shrink % per candle threshold for "contracting" status.
   * Default −1.0 (body shrinking ≥1% of window mean per candle).
   */
  bodyShrinkThresholdPct?: number;
  /** Range-shrink % per candle threshold. Default −1.0. */
  rangeShrinkThresholdPct?: number;
  /** Volume-shrink % per candle threshold. Default −2.0. */
  volumeShrinkThresholdPct?: number;
  /** Optional 20-bar baseline volume for relative-volume check. */
  baselineVolumeWindow?: number;
  /** Max relative volume vs baseline for "spring_ready". Default 0.70. */
  maxRelativeVolume?: number;
  /** Max 5-day range as fraction of lowest low. Default 0.10. */
  maxRangeOverLow?: number;
}

export type VcpVerdict =
  | "spring_ready"
  | "contracting"
  | "mixed"
  | "expanding"
  | "insufficient_data";

export interface VcpResult {
  windowSize: number;
  /** OLS slope of body/open, % per candle of window mean. */
  bodyShrinkSlopePct: number;
  /** OLS slope of range/low, % per candle of window mean. */
  rangeShrinkSlopePct: number;
  /** OLS slope of USD volume, % per candle of window mean. */
  volumeSlopePct: number;
  /** Range over the window: (max high − min low) / min low. */
  windowRangeOverLow: number;
  /** Mean USD volume in the window / baseline mean USD volume. */
  relativeVolume: number;
  /** Number of the 3 axes that show contraction. */
  contractingAxes: number;
  verdict: VcpVerdict;
  /** 0..1 score: composite of axis contraction + tightness. */
  contractionScore: number;
  summary: string;
}

const DEFAULT_WINDOW = 5;
const DEFAULT_MIN = 4;
const DEFAULT_BODY = -1.0;
const DEFAULT_RANGE = -1.0;
const DEFAULT_VOLUME = -2.0;
const DEFAULT_REL_VOL = 0.7;
const DEFAULT_MAX_RANGE_OVER_LOW = 0.1;
const DEFAULT_BASELINE_VOL_WINDOW = 20;

function slopePctOfMean(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  if (m === 0) return 0;
  const s = trendSlope(values);
  return (s / m) * 100;
}

export function analyzeVcpContraction(
  bars: ReadonlyArray<VcpCandle>,
  options: VcpOptions = {},
): VcpResult {
  const window = options.window ?? DEFAULT_WINDOW;
  const minCandles = options.minCandles ?? DEFAULT_MIN;
  const bodyT = options.bodyShrinkThresholdPct ?? DEFAULT_BODY;
  const rangeT = options.rangeShrinkThresholdPct ?? DEFAULT_RANGE;
  const volT = options.volumeShrinkThresholdPct ?? DEFAULT_VOLUME;
  const maxRelVol = options.maxRelativeVolume ?? DEFAULT_REL_VOL;
  const maxRange = options.maxRangeOverLow ?? DEFAULT_MAX_RANGE_OVER_LOW;
  const baselineWin = options.baselineVolumeWindow ?? DEFAULT_BASELINE_VOL_WINDOW;

  if (bars.length < minCandles) {
    return {
      windowSize: bars.length,
      bodyShrinkSlopePct: 0,
      rangeShrinkSlopePct: 0,
      volumeSlopePct: 0,
      windowRangeOverLow: 0,
      relativeVolume: 1,
      contractingAxes: 0,
      verdict: "insufficient_data",
      contractionScore: 0,
      summary: `Insufficient candles (${bars.length} < ${minCandles}).`,
    };
  }

  const effective = Math.min(window, bars.length);
  const tail = bars.slice(bars.length - effective);

  const bodies = tail.map((b) => (b.open > 0 ? Math.abs(b.close - b.open) / b.open : 0));
  const ranges = tail.map((b) => (b.low > 0 ? (b.high - b.low) / b.low : 0));
  const volumes = tail.map((b) => b.close * b.volume);

  const bodySlopePct = slopePctOfMean(bodies);
  const rangeSlopePct = slopePctOfMean(ranges);
  const volSlopePct = slopePctOfMean(volumes);

  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  for (const b of tail) {
    if (b.high > highestHigh) highestHigh = b.high;
    if (b.low < lowestLow) lowestLow = b.low;
  }
  const windowRangeOverLow = lowestLow > 0 ? (highestHigh - lowestLow) / lowestLow : Infinity;

  // Relative volume vs baseline (last `baselineWin` candles, EXCLUDING the
  // window we're measuring — that's the prior 20-day mean Qullamaggie uses).
  let relativeVolume = 1;
  const baselineEnd = bars.length - effective;
  if (baselineEnd >= baselineWin) {
    const baselineSlice = bars.slice(baselineEnd - baselineWin, baselineEnd);
    const baselineMean = mean(baselineSlice.map((b) => b.close * b.volume));
    const windowMean = mean(volumes);
    if (baselineMean > 0) relativeVolume = windowMean / baselineMean;
  }

  const bodyContracts = bodySlopePct <= bodyT;
  const rangeContracts = rangeSlopePct <= rangeT;
  const volContracts = volSlopePct <= volT;
  const contractingAxes =
    (bodyContracts ? 1 : 0) + (rangeContracts ? 1 : 0) + (volContracts ? 1 : 0);

  // Spring ready = all 3 axes contracting AND tight range AND low relative vol
  const tightRange = windowRangeOverLow <= maxRange;
  const lowRelVol = relativeVolume <= maxRelVol;
  let verdict: VcpVerdict;
  if (contractingAxes === 3 && tightRange && lowRelVol) verdict = "spring_ready";
  else if (contractingAxes >= 2) verdict = "contracting";
  else if (contractingAxes === 1) verdict = "mixed";
  else verdict = "expanding";

  // 0..1 composite: 1/3 weight per axis (contracting = 0.33), bonuses for
  // tight-range + low-rel-vol (0.17 + 0.17). Total caps at 1.
  let score = 0;
  if (bodyContracts) score += 1 / 3;
  if (rangeContracts) score += 1 / 3;
  if (volContracts) score += 1 / 3;
  if (tightRange && lowRelVol) score = Math.min(1, score);
  else score = Math.min(0.95, score);

  const summary =
    `${effective}-candle VCP: body slope ${bodySlopePct.toFixed(2)}%/c, ` +
    `range slope ${rangeSlopePct.toFixed(2)}%/c, vol slope ${volSlopePct.toFixed(2)}%/c. ` +
    `Range/low ${(windowRangeOverLow * 100).toFixed(1)}%, relVol ${(relativeVolume * 100).toFixed(0)}%. ` +
    `→ ${verdict}`;

  return {
    windowSize: effective,
    bodyShrinkSlopePct: parseFloat(bodySlopePct.toFixed(4)),
    rangeShrinkSlopePct: parseFloat(rangeSlopePct.toFixed(4)),
    volumeSlopePct: parseFloat(volSlopePct.toFixed(4)),
    windowRangeOverLow: parseFloat(windowRangeOverLow.toFixed(4)),
    relativeVolume: parseFloat(relativeVolume.toFixed(4)),
    contractingAxes,
    verdict,
    contractionScore: parseFloat(score.toFixed(4)),
    summary,
  };
}

export function formatVcpContraction(result: VcpResult): string {
  const lines = [
    `VCP Contraction — ${result.verdict.toUpperCase()}`,
    "",
    `  Window: ${result.windowSize} candles`,
    `  Body slope:   ${result.bodyShrinkSlopePct.toFixed(2)}%/candle`,
    `  Range slope:  ${result.rangeShrinkSlopePct.toFixed(2)}%/candle`,
    `  Volume slope: ${result.volumeSlopePct.toFixed(2)}%/candle`,
    `  Range/low:    ${(result.windowRangeOverLow * 100).toFixed(1)}%`,
    `  Rel volume:   ${(result.relativeVolume * 100).toFixed(0)}% of baseline`,
    `  Contracting axes: ${result.contractingAxes}/3`,
    `  Score: ${result.contractionScore.toFixed(2)}`,
    "",
    `Summary: ${result.summary}`,
  ];
  if (result.verdict === "spring_ready") {
    lines.push("");
    lines.push("⚡ Spring ready: all 3 axes contracting + tight range + low rel-vol.");
    lines.push("  Next expansion candle is the breakout candidate.");
  }
  return lines.join("\n");
}

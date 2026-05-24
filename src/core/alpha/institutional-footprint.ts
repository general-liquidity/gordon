/**
 * Institutional Footprint Detector — multi-bar accumulation signature.
 *
 * Composite diagnostic that fires only when ALL of the following hold
 * in an aligned window (Haseeb / Minervini / O'Neil / Weinstein stage-2
 * accumulation framework):
 *
 *   1. ≥ K consecutive bars of elevated volume      (default K=4, 1.2× baseline)
 *   2. Cumulative directional move in [lo, hi]      (default 20–40% — filters
 *                                                    chop AND parabolic blowoff)
 *   3. ≥ 1 signal bar with body ≥ M%                (default 10%)
 *   4. Subsequent base range / base low ≤ R         (default 10% — VCP-style
 *                                                    shallow tightening)
 *   5. Most recent close ≥ short MA of full series  (default 21-bar SMA — "holds
 *                                                    the EMA" check)
 *
 * Algorithm:
 *   - Locate the peak high inside the lookback window
 *   - "Run" = lookback start → peak high
 *   - "Base" = peak high → latest bar
 *   - Score the five conditions; emit a verdict + per-axis pass/fail report
 *
 * This is a DIAGNOSTIC (is institutional accumulation visible?), not a
 * buy signal. The post-base "holds EMA" gate is the most important
 * single check — without it the pattern looks identical to a parabolic
 * blowoff in distribution.
 *
 * Distinct from:
 *   - `vcp-contraction.ts`        (base-tightness only, no run/move check)
 *   - `streak-detector.ts`        (direction streaks, no magnitude/volume gate)
 *   - `volume-trend.ts`           (volume slope only, no price-structure gate)
 *   - `highest-volume-ever.ts`    (single-bar volume, not multi-bar run)
 *   - `ma-proximity.ts`           (single-bar MA classification, not run+base)
 *
 * Composes with:
 *   - `analyze_vcp_contraction`   (deeper VCP scoring of the base)
 *   - `classify_ma_proximity`     (R:R for entering at the base)
 *   - `too-good-check`            (sanity gate against fabricated patterns)
 *
 * Pure function over OHLCV.
 */

export interface InstitutionalFootprintBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface InstitutionalFootprintOptions {
  /** Minimum consecutive elevated-volume bars required in the run. Default 4. */
  minConsecutiveVolumeBars?: number;
  /** Multiple of baseline volume that counts as "elevated". Default 1.2. */
  elevatedVolumeMultiple?: number;
  /** Baseline volume window (bars before the run). Default 20. */
  baselineVolumeWindow?: number;
  /** Lower bound on cumulative run move (fraction). Default 0.20. */
  minRunMove?: number;
  /** Upper bound on cumulative run move (fraction); above = blowoff. Default 0.40. */
  maxRunMove?: number;
  /** Minimum |close - open| / open of at least one bar in the run. Default 0.10. */
  minSignalBarBody?: number;
  /** Max base (range / base low) for "shallow tight base". Default 0.10. */
  maxBaseRangeOverLow?: number;
  /** SMA length for the holding-EMA check. Default 21. */
  baseHoldingMaLength?: number;
  /** Minimum bars in the input (run + base + baseline). Default 30. */
  minBars?: number;
  /** Minimum base length (bars after peak). Default 3. */
  minBaseLength?: number;
}

export type InstitutionalFootprintVerdict =
  | "accumulation_visible"
  | "partial_signature"
  | "parabolic_blowoff"
  | "chop_no_accumulation"
  | "insufficient_data";

export interface AxisCheck {
  axis:
    | "consecutive_volume"
    | "run_magnitude"
    | "signal_bar"
    | "base_tightness"
    | "holds_ma";
  passed: boolean;
  observed: number;
  threshold: number;
  description: string;
}

export interface InstitutionalFootprintResult {
  totalBars: number;
  runStartIndex: number;
  runEndIndex: number;
  baseStartIndex: number;
  baseEndIndex: number;
  /** Cumulative directional move of the run, fraction. */
  runMoveFraction: number;
  /** Largest single-bar |close-open|/open within the run. */
  maxSignalBarBody: number;
  /** Longest consecutive elevated-volume run inside the run. */
  longestConsecutiveVolumeBars: number;
  /** Mean baseline volume (window before run start). */
  baselineVolume: number;
  /** Mean run volume. */
  runVolume: number;
  /** Base range as fraction of base low. */
  baseRangeOverLow: number;
  /** Short-MA value at last bar. */
  holdingMaValue: number;
  /** Latest close. */
  latestClose: number;
  /** 0..5 — number of axes that passed. */
  axesPassed: number;
  axes: AxisCheck[];
  verdict: InstitutionalFootprintVerdict;
  /** 0..1 composite confidence in the signature. */
  signatureScore: number;
  summary: string;
}

const DEFAULT_MIN_VOL_BARS = 4;
const DEFAULT_ELEVATED_MULT = 1.2;
const DEFAULT_BASELINE_WINDOW = 20;
const DEFAULT_MIN_RUN_MOVE = 0.20;
const DEFAULT_MAX_RUN_MOVE = 0.40;
const DEFAULT_MIN_SIGNAL_BODY = 0.10;
const DEFAULT_MAX_BASE_RANGE = 0.10;
const DEFAULT_MA_LENGTH = 21;
const DEFAULT_MIN_BARS = 30;
const DEFAULT_MIN_BASE_LENGTH = 3;

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function sma(values: ReadonlyArray<number>, length: number, endIndex: number): number {
  const start = Math.max(0, endIndex - length + 1);
  let s = 0;
  let n = 0;
  for (let i = start; i <= endIndex; i++) {
    s += values[i]!;
    n++;
  }
  return n > 0 ? s / n : 0;
}

function insufficient(
  bars: ReadonlyArray<InstitutionalFootprintBar>,
  reason: string,
): InstitutionalFootprintResult {
  return {
    totalBars: bars.length,
    runStartIndex: -1,
    runEndIndex: -1,
    baseStartIndex: -1,
    baseEndIndex: -1,
    runMoveFraction: 0,
    maxSignalBarBody: 0,
    longestConsecutiveVolumeBars: 0,
    baselineVolume: 0,
    runVolume: 0,
    baseRangeOverLow: 0,
    holdingMaValue: 0,
    latestClose: 0,
    axesPassed: 0,
    axes: [],
    verdict: "insufficient_data",
    signatureScore: 0,
    summary: reason,
  };
}

export function analyzeInstitutionalFootprint(
  bars: ReadonlyArray<InstitutionalFootprintBar>,
  options: InstitutionalFootprintOptions = {},
): InstitutionalFootprintResult {
  const minVolBars = options.minConsecutiveVolumeBars ?? DEFAULT_MIN_VOL_BARS;
  const elevatedMult = options.elevatedVolumeMultiple ?? DEFAULT_ELEVATED_MULT;
  const baselineWindow = options.baselineVolumeWindow ?? DEFAULT_BASELINE_WINDOW;
  const minRunMove = options.minRunMove ?? DEFAULT_MIN_RUN_MOVE;
  const maxRunMove = options.maxRunMove ?? DEFAULT_MAX_RUN_MOVE;
  const minSignalBody = options.minSignalBarBody ?? DEFAULT_MIN_SIGNAL_BODY;
  const maxBaseRange = options.maxBaseRangeOverLow ?? DEFAULT_MAX_BASE_RANGE;
  const maLength = options.baseHoldingMaLength ?? DEFAULT_MA_LENGTH;
  const minBars = options.minBars ?? DEFAULT_MIN_BARS;
  const minBaseLength = options.minBaseLength ?? DEFAULT_MIN_BASE_LENGTH;

  if (bars.length < minBars) {
    return insufficient(bars, `Insufficient bars (${bars.length} < ${minBars}).`);
  }

  // Locate peak high; the run ends at peak, the base starts right after.
  let peakIdx = 0;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i]!.high > bars[peakIdx]!.high) peakIdx = i;
  }

  const baseStart = peakIdx + 1;
  const baseEnd = bars.length - 1;
  if (baseEnd - baseStart + 1 < minBaseLength) {
    return insufficient(
      bars,
      `Base too short (peak at index ${peakIdx} leaves ${baseEnd - baseStart + 1} bars; need ${minBaseLength}).`,
    );
  }

  // Find the start of the run: walk backward from peakIdx, stop at the
  // lowest low before any subsequent move that exceeds 5% retracement.
  // Simpler: the run start is the lowest low among the bars before peak
  // within the baseline-adjusted window.
  const earliestRunCandidate = Math.max(0, peakIdx - 30); // run cap = 30 bars
  let runStart = earliestRunCandidate;
  let runStartLow = bars[earliestRunCandidate]!.low;
  for (let i = earliestRunCandidate + 1; i <= peakIdx; i++) {
    if (bars[i]!.low < runStartLow) {
      runStartLow = bars[i]!.low;
      runStart = i;
    }
  }
  if (runStart >= peakIdx) {
    return insufficient(bars, "Run has zero length (peak coincides with lowest low).");
  }

  // Baseline volume = mean volume in the baselineWindow bars before runStart
  const baselineEnd = runStart - 1;
  const baselineStart = Math.max(0, baselineEnd - baselineWindow + 1);
  let baselineVol = 0;
  if (baselineEnd >= baselineStart) {
    const slice: number[] = [];
    for (let i = baselineStart; i <= baselineEnd; i++) slice.push(bars[i]!.volume);
    baselineVol = meanOf(slice);
  }
  if (baselineVol <= 0) {
    // Fallback: use whole-series mean ex-run as baseline
    const fallback: number[] = [];
    for (let i = 0; i < runStart; i++) fallback.push(bars[i]!.volume);
    if (fallback.length === 0) {
      for (let i = baseStart; i <= baseEnd; i++) fallback.push(bars[i]!.volume);
    }
    baselineVol = meanOf(fallback);
  }

  // Run metrics
  const runStartPrice = bars[runStart]!.low;
  const runEndPrice = bars[peakIdx]!.high;
  const runMove = runStartPrice > 0 ? (runEndPrice - runStartPrice) / runStartPrice : 0;

  let maxSignalBody = 0;
  let longestConsecVol = 0;
  let currentConsec = 0;
  const runVolumes: number[] = [];
  const elevatedThreshold = baselineVol * elevatedMult;
  for (let i = runStart; i <= peakIdx; i++) {
    const b = bars[i]!;
    const body = b.open > 0 ? Math.abs(b.close - b.open) / b.open : 0;
    if (body > maxSignalBody) maxSignalBody = body;
    runVolumes.push(b.volume);
    if (b.volume >= elevatedThreshold) {
      currentConsec++;
      if (currentConsec > longestConsecVol) longestConsecVol = currentConsec;
    } else {
      currentConsec = 0;
    }
  }
  const runVol = meanOf(runVolumes);

  // Base metrics
  let baseLow = bars[baseStart]!.low;
  let baseHigh = bars[baseStart]!.high;
  for (let i = baseStart; i <= baseEnd; i++) {
    if (bars[i]!.low < baseLow) baseLow = bars[i]!.low;
    if (bars[i]!.high > baseHigh) baseHigh = bars[i]!.high;
  }
  const baseRangeOverLow = baseLow > 0 ? (baseHigh - baseLow) / baseLow : Infinity;

  // Holding-MA check: SMA of close over the last `maLength` bars
  const closes = bars.map((b) => b.close);
  const holdingMa = sma(closes, maLength, baseEnd);
  const latestClose = bars[baseEnd]!.close;

  // Axes
  const axes: AxisCheck[] = [
    {
      axis: "consecutive_volume",
      passed: longestConsecVol >= minVolBars,
      observed: longestConsecVol,
      threshold: minVolBars,
      description: `${longestConsecVol} consecutive bars ≥ ${elevatedMult}× baseline volume (need ${minVolBars}).`,
    },
    {
      axis: "run_magnitude",
      passed: runMove >= minRunMove && runMove <= maxRunMove,
      observed: parseFloat(runMove.toFixed(4)),
      threshold: minRunMove,
      description: `Run move ${(runMove * 100).toFixed(1)}% (window ${(minRunMove * 100).toFixed(0)}-${(maxRunMove * 100).toFixed(0)}%).`,
    },
    {
      axis: "signal_bar",
      passed: maxSignalBody >= minSignalBody,
      observed: parseFloat(maxSignalBody.toFixed(4)),
      threshold: minSignalBody,
      description: `Largest single-bar body ${(maxSignalBody * 100).toFixed(1)}% (need ≥ ${(minSignalBody * 100).toFixed(0)}%).`,
    },
    {
      axis: "base_tightness",
      passed: baseRangeOverLow <= maxBaseRange,
      observed: parseFloat(baseRangeOverLow.toFixed(4)),
      threshold: maxBaseRange,
      description: `Base range/low ${(baseRangeOverLow * 100).toFixed(1)}% (need ≤ ${(maxBaseRange * 100).toFixed(0)}%).`,
    },
    {
      axis: "holds_ma",
      passed: latestClose >= holdingMa && holdingMa > 0,
      observed: parseFloat(latestClose.toFixed(4)),
      threshold: parseFloat(holdingMa.toFixed(4)),
      description: `Latest close ${latestClose.toFixed(2)} vs ${maLength}-SMA ${holdingMa.toFixed(2)}.`,
    },
  ];
  const axesPassed = axes.filter((a) => a.passed).length;

  // Verdict
  let verdict: InstitutionalFootprintVerdict;
  if (runMove > maxRunMove && longestConsecVol >= minVolBars) {
    verdict = "parabolic_blowoff";
  } else if (axesPassed === 5) {
    verdict = "accumulation_visible";
  } else if (axesPassed >= 3) {
    verdict = "partial_signature";
  } else {
    verdict = "chop_no_accumulation";
  }

  const signatureScore = parseFloat((axesPassed / 5).toFixed(4));

  const summary =
    `${verdict.toUpperCase()} — ${axesPassed}/5 axes (` +
    `run ${(runMove * 100).toFixed(1)}%, ` +
    `${longestConsecVol}-bar vol streak, ` +
    `max body ${(maxSignalBody * 100).toFixed(1)}%, ` +
    `base ${(baseRangeOverLow * 100).toFixed(1)}%, ` +
    `${latestClose >= holdingMa ? "above" : "below"} ${maLength}-SMA).`;

  return {
    totalBars: bars.length,
    runStartIndex: runStart,
    runEndIndex: peakIdx,
    baseStartIndex: baseStart,
    baseEndIndex: baseEnd,
    runMoveFraction: parseFloat(runMove.toFixed(6)),
    maxSignalBarBody: parseFloat(maxSignalBody.toFixed(6)),
    longestConsecutiveVolumeBars: longestConsecVol,
    baselineVolume: parseFloat(baselineVol.toFixed(2)),
    runVolume: parseFloat(runVol.toFixed(2)),
    baseRangeOverLow:
      Number.isFinite(baseRangeOverLow) ? parseFloat(baseRangeOverLow.toFixed(6)) : -1,
    holdingMaValue: parseFloat(holdingMa.toFixed(6)),
    latestClose: parseFloat(latestClose.toFixed(6)),
    axesPassed,
    axes,
    verdict,
    signatureScore,
    summary,
  };
}

export function formatInstitutionalFootprint(
  result: InstitutionalFootprintResult,
): string {
  const lines = [
    `Institutional Footprint — ${result.verdict.toUpperCase()} (score ${result.signatureScore.toFixed(2)})`,
    "",
    `  Bars supplied:    ${result.totalBars}`,
    `  Run:              [${result.runStartIndex} → ${result.runEndIndex}]`,
    `  Base:             [${result.baseStartIndex} → ${result.baseEndIndex}]`,
    `  Run move:         ${(result.runMoveFraction * 100).toFixed(2)}%`,
    `  Run volume:       ${result.runVolume} (baseline ${result.baselineVolume})`,
    `  Max signal body:  ${(result.maxSignalBarBody * 100).toFixed(2)}%`,
    `  Consec elev vols: ${result.longestConsecutiveVolumeBars}`,
    `  Base range/low:   ${(result.baseRangeOverLow * 100).toFixed(2)}%`,
    `  Latest / SMA:     ${result.latestClose.toFixed(2)} / ${result.holdingMaValue.toFixed(2)}`,
    "",
    `  Axes passed:      ${result.axesPassed}/5`,
  ];
  for (const a of result.axes) {
    const tag = a.passed ? "[PASS]" : "[FAIL]";
    lines.push(`    ${tag} ${a.axis}: ${a.description}`);
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}

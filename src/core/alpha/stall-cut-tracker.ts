/**
 * Stall-Cut Tracker — post-entry "is this acting right?" diagnostic.
 *
 * Premise (Zanger via Kyna Kosling, May 2026): never own a stock that isn't
 * going up. If a position has been open for N bars and hasn't progressed
 * enough on enough volume, the supply/demand imbalance that justified the
 * entry isn't materializing — cut and rotate, even before the stop hits
 * and even before breakeven.
 *
 * Operates on per-bar OHLCV after entry, scoring two axes:
 *   1. PROGRESS — current price vs entry, normalized by expected move
 *   2. VOLUME   — mean post-entry volume vs baseline expectation
 *
 * Verdict:
 *   - still_too_early           : fewer than gracePeriodBars elapsed
 *   - moving_as_expected        : progress on track, volume confirming
 *   - stalling_cut_recommended  : grace elapsed, progress below threshold,
 *                                 volume confirms or absent
 *   - dead_money                : grace + extension elapsed, near-zero
 *                                 progress, no volume confirmation
 *
 * Sign convention:
 *   - LONG positions: "progress" = (currentPrice − entryPrice) / entryPrice
 *   - SHORT positions: "progress" = (entryPrice − currentPrice) / entryPrice
 *
 * Distinct from:
 *   - `infra/trading/quant/timeBasedExit.ts` (TM2 — pure duration multiple
 *     against avgWinningDuration; complementary axis. Compose both gates.)
 *   - `streak-detector.ts`     (pre-entry multi-bar exhaustion)
 *   - `volume-exhaustion.ts`   (pre-entry single-bar exhaustion)
 *   - `too-good-check.ts`      (post-result skepticism, not post-entry stall)
 *   - `regime-detection-lag`   (regime transition, not single-position health)
 *
 * Composes with:
 *   - `computeTimeBasedExit`   (stack a stall-cut + duration-cap gate)
 *   - `aggression-ratio`       (rising aggression confirms "moving" verdict)
 *
 * Pure function. Caller supplies entry + post-entry bar path.
 */

export type PositionSide = "LONG" | "SHORT";

export interface StallBar {
  /** Open of the bar (post-entry). */
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StallCutInput {
  side: PositionSide;
  entryPrice: number;
  /** OHLCV bars from the bar AFTER entry, oldest → newest. */
  postEntryBars: ReadonlyArray<StallBar>;
  /**
   * Expected directional move (fraction) the trade is "supposed" to make
   * within `expectedMoveByBars` bars. Operator-provided based on setup
   * (e.g. 0.05 = expect 5% move within window).
   */
  expectedMove: number;
  /** Number of bars by which `expectedMove` should be reached. */
  expectedMoveByBars: number;
  /**
   * Volume baseline: pre-entry mean bar volume (or another reference)
   * the post-entry bars are expected to exceed if institutional demand
   * is showing up. Optional; if absent, the volume axis is skipped.
   */
  baselineVolume?: number;
}

export interface StallCutOptions {
  /**
   * Minimum bars that must elapse before any cut verdict is possible.
   * Default 2 — gives the trade a chance to develop.
   */
  gracePeriodBars?: number;
  /**
   * Fraction of expectedMove that must be achieved by the elapsed bar
   * (prorated linearly to expectedMoveByBars) to count as "on track".
   * Default 0.5 (need 50% of pro-rated expected progress).
   */
  onTrackProgressFraction?: number;
  /**
   * Mean post-entry volume / baselineVolume that counts as "volume
   * confirming". Default 1.0 (volume at or above baseline).
   */
  volumeConfirmMultiple?: number;
  /**
   * Multiple of expectedMoveByBars beyond which a non-progressing
   * position is classified `dead_money` rather than `stalling_cut_recommended`.
   * Default 1.5.
   */
  deadMoneyExtensionMultiple?: number;
  /**
   * |progress| / expectedMove below which we call it "near zero progress"
   * for dead-money detection. Default 0.10 (less than 10% of expected).
   */
  deadMoneyProgressFraction?: number;
}

export type StallVerdict =
  | "still_too_early"
  | "moving_as_expected"
  | "stalling_cut_recommended"
  | "dead_money";

export interface StallCutResult {
  side: PositionSide;
  barsElapsed: number;
  currentPrice: number;
  /** Signed progress fraction in the position's favor. */
  progressFraction: number;
  /** Progress as a fraction of expectedMove. */
  progressVsExpected: number;
  /** Linear pro-rated expected progress at `barsElapsed`. */
  proRatedExpected: number;
  meanPostEntryVolume: number;
  /** Mean post-entry volume / baselineVolume; null if baseline absent. */
  volumeMultiple: number | null;
  progressOnTrack: boolean;
  volumeConfirming: boolean | null;
  verdict: StallVerdict;
  summary: string;
}

const DEFAULT_GRACE = 2;
const DEFAULT_ON_TRACK = 0.5;
const DEFAULT_VOL_CONFIRM = 1.0;
const DEFAULT_DEAD_EXTENSION = 1.5;
const DEFAULT_DEAD_PROGRESS = 0.10;

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function analyzeStallCut(
  input: StallCutInput,
  options: StallCutOptions = {},
): StallCutResult {
  const grace = options.gracePeriodBars ?? DEFAULT_GRACE;
  const onTrackFrac = options.onTrackProgressFraction ?? DEFAULT_ON_TRACK;
  const volConfirm = options.volumeConfirmMultiple ?? DEFAULT_VOL_CONFIRM;
  const deadExt = options.deadMoneyExtensionMultiple ?? DEFAULT_DEAD_EXTENSION;
  const deadProgFrac = options.deadMoneyProgressFraction ?? DEFAULT_DEAD_PROGRESS;

  const bars = input.postEntryBars;
  const barsElapsed = bars.length;
  const currentPrice = barsElapsed > 0 ? bars[barsElapsed - 1]!.close : input.entryPrice;

  // Signed progress in position's favor
  const rawProgress =
    input.side === "LONG"
      ? (currentPrice - input.entryPrice) / input.entryPrice
      : (input.entryPrice - currentPrice) / input.entryPrice;

  const progressVsExpected =
    input.expectedMove > 0 ? rawProgress / input.expectedMove : 0;

  // Linearly pro-rate expected progress
  const proRatedExpected =
    input.expectedMoveByBars > 0
      ? Math.min(1, barsElapsed / input.expectedMoveByBars) * onTrackFrac
      : onTrackFrac;
  const progressOnTrack = progressVsExpected >= proRatedExpected;

  const meanVol = meanOf(bars.map((b) => b.volume));
  let volumeMultiple: number | null = null;
  let volumeConfirming: boolean | null = null;
  if (input.baselineVolume !== undefined && input.baselineVolume > 0) {
    volumeMultiple = meanVol / input.baselineVolume;
    volumeConfirming = volumeMultiple >= volConfirm;
  }

  let verdict: StallVerdict;
  if (barsElapsed < grace) {
    verdict = "still_too_early";
  } else if (progressOnTrack && (volumeConfirming === null || volumeConfirming)) {
    verdict = "moving_as_expected";
  } else {
    const isDeadExtension = barsElapsed >= input.expectedMoveByBars * deadExt;
    const nearZeroProgress = Math.abs(progressVsExpected) <= deadProgFrac;
    const volumeAbsent = volumeConfirming === false || volumeConfirming === null;
    if (isDeadExtension && nearZeroProgress && volumeAbsent) {
      verdict = "dead_money";
    } else {
      verdict = "stalling_cut_recommended";
    }
  }

  const summary =
    `${verdict.toUpperCase()} — ${barsElapsed} bars elapsed, ` +
    `progress ${(rawProgress * 100).toFixed(2)}% (${(progressVsExpected * 100).toFixed(0)}% of expected), ` +
    `${volumeMultiple !== null ? `vol ${volumeMultiple.toFixed(2)}× baseline` : "no volume baseline"}.`;

  return {
    side: input.side,
    barsElapsed,
    currentPrice: parseFloat(currentPrice.toFixed(6)),
    progressFraction: parseFloat(rawProgress.toFixed(6)),
    progressVsExpected: parseFloat(progressVsExpected.toFixed(6)),
    proRatedExpected: parseFloat(proRatedExpected.toFixed(6)),
    meanPostEntryVolume: parseFloat(meanVol.toFixed(2)),
    volumeMultiple: volumeMultiple !== null ? parseFloat(volumeMultiple.toFixed(4)) : null,
    progressOnTrack,
    volumeConfirming,
    verdict,
    summary,
  };
}

export function formatStallCut(result: StallCutResult): string {
  const lines = [
    `Stall-Cut Tracker — ${result.verdict.toUpperCase()}`,
    "",
    `  Side:                ${result.side}`,
    `  Bars elapsed:        ${result.barsElapsed}`,
    `  Current price:       ${result.currentPrice.toFixed(2)}`,
    `  Progress:            ${(result.progressFraction * 100).toFixed(2)}%`,
    `  Vs expected:         ${(result.progressVsExpected * 100).toFixed(1)}% (need ≥ ${(result.proRatedExpected * 100).toFixed(1)}% pro-rated)`,
    `  Mean post-entry vol: ${result.meanPostEntryVolume}`,
    `  Volume multiple:     ${result.volumeMultiple !== null ? `${result.volumeMultiple.toFixed(2)}×` : "n/a"}`,
    `  Progress on track:   ${result.progressOnTrack ? "yes" : "no"}`,
    `  Volume confirming:   ${result.volumeConfirming === null ? "n/a" : result.volumeConfirming ? "yes" : "no"}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}

/**
 * Consecutive-Streak Detector (Connors-style)
 *
 * Larry Connors's "Multiple Days Up / Multiple Days Down" framing: a
 * sustained run of same-direction bars often reflects short-term
 * positioning + crowd behavior rather than fundamentals, and that
 * creates exhaustion. The longer the streak relative to the asset's
 * own history of streaks, the more likely a mean-reversion fade
 * pays off.
 *
 * Procedure:
 *   1. Walk OHLC bars; classify each bar as up / down / flat based on
 *      close vs prior close (operator-tunable tolerance)
 *   2. Compute the CURRENT live streak length + direction
 *   3. Compute the historical distribution of completed same-direction
 *      streak lengths over the lookback
 *   4. Score the current streak's percentile in that distribution
 *   5. Emit verdict (weak / moderate / strong / extreme exhaustion) +
 *      fade-direction recommendation
 *
 * Verdict bands:
 *   - extreme  : percentile ≥ 0.97  → high-conviction fade
 *   - strong   : percentile ≥ 0.90
 *   - moderate : percentile ≥ 0.75
 *   - weak     : everything else
 *
 * Distinct from:
 *   - streakCircuitBreaker.ts (consecutive TRADE losses)
 *   - hotStreakSizer.ts       (recent realized PnL sign)
 *   - bounceCounter.ts        (RSI zone re-entries)
 *
 * Composes with:
 *   - volume-trend (declining volume during streak = stronger fade signal)
 *   - reversal-timing (cross-asset confirmation that the streak reverses)
 *   - margin-of-error (fade is in-sync when structural bias is ranging)
 *   - too-good-check (prevents fading a streak that's part of a regime shift)
 *
 * Pure function. No I/O.
 */

export interface StreakBar {
  /** Close of the bar. */
  close: number;
}

export type StreakDirection = "up" | "down" | "none";

export interface StreakDetectorOptions {
  /**
   * Minimum |Δclose / priorClose| required to count as up or down.
   * Smaller moves count as "flat" and break the streak without
   * starting a new one. Default 0 (any non-zero move counts).
   */
  flatToleranceFraction?: number;
  /**
   * Minimum streak length to consider it a "streak" for verdict
   * purposes. Streaks shorter than this collapse to "weak" regardless
   * of percentile. Default 2.
   */
  minStreakLength?: number;
  /**
   * Lookback window for the historical streak-length distribution.
   * Default = use all available bars.
   */
  lookback?: number;
  /**
   * Verdict thresholds — operator-tunable percentile cutoffs.
   * Defaults: extreme ≥ 0.97, strong ≥ 0.90, moderate ≥ 0.75.
   */
  extremePercentile?: number;
  strongPercentile?: number;
  moderatePercentile?: number;
}

export type ExhaustionVerdict =
  | "extreme_exhaustion"
  | "strong_exhaustion"
  | "moderate_exhaustion"
  | "weak_exhaustion"
  | "insufficient_data";

export interface StreakDetectorResult {
  /** Current live streak length (0 if last bar was flat or only 1 bar). */
  currentStreakLength: number;
  currentStreakDirection: StreakDirection;
  /** Percentile of the current streak length in the historical distribution. */
  currentStreakPercentile: number;
  /** Number of completed same-direction streaks observed in the lookback. */
  historicalStreakCount: number;
  /** Mean length of completed same-direction streaks. */
  historicalMeanLength: number;
  /** Max length of completed same-direction streaks in the lookback. */
  historicalMaxLength: number;
  verdict: ExhaustionVerdict;
  /**
   * Recommended fade direction. up streak → fade short; down streak →
   * fade long. null when verdict is weak/insufficient (no actionable
   * setup).
   */
  recommendedFadeDirection: "long" | "short" | null;
  summary: string;
}

const DEFAULT_FLAT_TOLERANCE = 0;
const DEFAULT_MIN_STREAK_LENGTH = 2;
const DEFAULT_EXTREME_P = 0.97;
const DEFAULT_STRONG_P = 0.9;
const DEFAULT_MODERATE_P = 0.75;
const MIN_HISTORICAL_FOR_PERCENTILE = 10;

function classifyBar(prevClose: number, close: number, tolerance: number): StreakDirection {
  if (prevClose <= 0) return "none";
  const change = (close - prevClose) / prevClose;
  if (Math.abs(change) <= tolerance) return "none";
  return change > 0 ? "up" : "down";
}

/**
 * Walks the bars and produces:
 *   - completedStreaks[]   — every closed same-direction run
 *   - currentLength / currentDirection — the live (unclosed) run at the end
 */
function walkStreaks(
  bars: ReadonlyArray<StreakBar>,
  tolerance: number,
): {
  upRuns: number[];
  downRuns: number[];
  currentLength: number;
  currentDirection: StreakDirection;
} {
  const upRuns: number[] = [];
  const downRuns: number[] = [];
  let currentDir: StreakDirection = "none";
  let currentLen = 0;

  const closeRun = () => {
    if (currentLen === 0) return;
    if (currentDir === "up") upRuns.push(currentLen);
    else if (currentDir === "down") downRuns.push(currentLen);
    currentDir = "none";
    currentLen = 0;
  };

  for (let i = 1; i < bars.length; i++) {
    const dir = classifyBar(bars[i - 1]!.close, bars[i]!.close, tolerance);
    if (dir === "none") {
      closeRun();
      continue;
    }
    if (dir === currentDir) {
      currentLen += 1;
    } else {
      closeRun();
      currentDir = dir;
      currentLen = 1;
    }
  }

  return { upRuns, downRuns, currentLength: currentLen, currentDirection: currentDir };
}

/** Fraction of values strictly less than `x`. Ties contribute 0.5×. */
function percentileOf(values: number[], x: number): number {
  if (values.length === 0) return 0;
  let lessThan = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) lessThan += 1;
    else if (v === x) equal += 1;
  }
  return (lessThan + equal * 0.5) / values.length;
}

function verdictFromPercentile(
  percentile: number,
  extreme: number,
  strong: number,
  moderate: number,
): ExhaustionVerdict {
  if (percentile >= extreme) return "extreme_exhaustion";
  if (percentile >= strong) return "strong_exhaustion";
  if (percentile >= moderate) return "moderate_exhaustion";
  return "weak_exhaustion";
}

export function detectStreak(
  bars: ReadonlyArray<StreakBar>,
  options: StreakDetectorOptions = {},
): StreakDetectorResult {
  const tolerance = options.flatToleranceFraction ?? DEFAULT_FLAT_TOLERANCE;
  const minStreak = options.minStreakLength ?? DEFAULT_MIN_STREAK_LENGTH;
  const extremeP = options.extremePercentile ?? DEFAULT_EXTREME_P;
  const strongP = options.strongPercentile ?? DEFAULT_STRONG_P;
  const moderateP = options.moderatePercentile ?? DEFAULT_MODERATE_P;
  const lookback = options.lookback;

  const view =
    lookback !== undefined && bars.length > lookback ? bars.slice(bars.length - lookback) : bars;

  if (view.length < 2) {
    return {
      currentStreakLength: 0,
      currentStreakDirection: "none",
      currentStreakPercentile: 0,
      historicalStreakCount: 0,
      historicalMeanLength: 0,
      historicalMaxLength: 0,
      verdict: "insufficient_data",
      recommendedFadeDirection: null,
      summary: "Need at least 2 bars to detect any streak.",
    };
  }

  const { upRuns, downRuns, currentLength, currentDirection } = walkStreaks(view, tolerance);

  const sameDirRuns =
    currentDirection === "up" ? upRuns : currentDirection === "down" ? downRuns : [];
  const meanLength =
    sameDirRuns.length === 0 ? 0 : sameDirRuns.reduce((a, b) => a + b, 0) / sameDirRuns.length;
  const maxLength = sameDirRuns.length === 0 ? 0 : Math.max(...sameDirRuns);
  const percentile = percentileOf(sameDirRuns, currentLength);

  let verdict: ExhaustionVerdict;
  let recommendedFadeDirection: "long" | "short" | null = null;

  if (currentDirection === "none" || currentLength === 0) {
    verdict = "weak_exhaustion";
  } else if (sameDirRuns.length < MIN_HISTORICAL_FOR_PERCENTILE) {
    verdict = "insufficient_data";
  } else if (currentLength < minStreak) {
    verdict = "weak_exhaustion";
  } else {
    verdict = verdictFromPercentile(percentile, extremeP, strongP, moderateP);
    if (verdict !== "weak_exhaustion") {
      recommendedFadeDirection = currentDirection === "up" ? "short" : "long";
    }
  }

  const summary =
    verdict === "insufficient_data"
      ? `Insufficient history (${sameDirRuns.length} prior ${currentDirection} streaks; need ≥ ${MIN_HISTORICAL_FOR_PERCENTILE}).`
      : currentDirection === "none" || currentLength === 0
        ? "No active same-direction streak."
        : `Current ${currentDirection} streak of ${currentLength} bars (${(percentile * 100).toFixed(0)}th percentile vs ${sameDirRuns.length} prior streaks, mean ${meanLength.toFixed(2)}, max ${maxLength}). → ${verdict}` +
          (recommendedFadeDirection ? `; consider fade ${recommendedFadeDirection}.` : ".");

  return {
    currentStreakLength: currentLength,
    currentStreakDirection: currentDirection,
    currentStreakPercentile: parseFloat(percentile.toFixed(4)),
    historicalStreakCount: sameDirRuns.length,
    historicalMeanLength: parseFloat(meanLength.toFixed(4)),
    historicalMaxLength: maxLength,
    verdict,
    recommendedFadeDirection,
    summary,
  };
}

export function formatStreak(result: StreakDetectorResult): string {
  const lines = [
    `Streak Detector — ${result.verdict.toUpperCase()}`,
    "",
    `  Current streak: ${result.currentStreakLength} bars ${result.currentStreakDirection}`,
    `  Percentile (vs history): ${(result.currentStreakPercentile * 100).toFixed(1)}%`,
    `  Historical ${result.currentStreakDirection} streaks: ${result.historicalStreakCount}`,
    `  Mean length: ${result.historicalMeanLength.toFixed(2)} bars`,
    `  Max length: ${result.historicalMaxLength} bars`,
  ];
  if (result.recommendedFadeDirection) {
    lines.push(`  Recommended fade: ${result.recommendedFadeDirection}`);
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}

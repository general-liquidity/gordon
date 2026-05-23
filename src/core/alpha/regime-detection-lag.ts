/**
 * Regime-Detection Lag Metric
 *
 * Spicy's Lesson 4 framing: "The faster you realize a change in
 * conditions = the better you will perform." If the regime classifier
 * takes too many bars to register a transition that's obvious in
 * hindsight, it costs the operator real money — every bar between
 * the actual transition and the classifier's detection is a bar
 * spent trading the wrong style.
 *
 * Pure function over (ground-truth transition timeline, detected
 * transition timeline). Reports per-transition lag + aggregate
 * statistics. Useful in eval-harness to measure regression in
 * classifier responsiveness.
 *
 * INPUT shape:
 *   - groundTruth: array of {barIndex, regime} marking actual
 *                  transitions
 *   - detected:    array of {barIndex, regime} marking classifier
 *                  detections
 *
 * MATCHING:
 *   For each ground-truth transition, find the FIRST detected
 *   transition AT OR AFTER it that names the same destination regime,
 *   within `maxLagBars`. Unmatched ground-truth transitions count as
 *   misses.
 *
 * NOT intended for runtime; eval-only.
 */

export interface RegimeTransition {
  barIndex: number;
  regime: string;
}

export interface RegimeLagOptions {
  /**
   * Maximum bars to search forward for a matching detected transition.
   * Default 50. Transitions not matched within this window are misses.
   */
  maxLagBars?: number;
}

export interface MatchedTransition {
  groundTruth: RegimeTransition;
  detected: RegimeTransition;
  lagBars: number;
}

export interface RegimeLagResult {
  groundTruthCount: number;
  detectedCount: number;
  matchedPairs: MatchedTransition[];
  missedTransitions: RegimeTransition[];
  /** Detected transitions with no corresponding ground truth (false positives). */
  spuriousDetections: RegimeTransition[];
  meanLagBars: number;
  medianLagBars: number;
  p95LagBars: number;
  detectionRate: number;
  falsePositiveRate: number;
  verdict: "responsive" | "acceptable" | "sluggish" | "broken" | "insufficient_data";
  summary: string;
}

const DEFAULT_MAX_LAG = 50;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx]!;
}

export function computeRegimeDetectionLag(
  groundTruth: ReadonlyArray<RegimeTransition>,
  detected: ReadonlyArray<RegimeTransition>,
  options: RegimeLagOptions = {},
): RegimeLagResult {
  const maxLag = options.maxLagBars ?? DEFAULT_MAX_LAG;

  if (groundTruth.length === 0) {
    return {
      groundTruthCount: 0,
      detectedCount: detected.length,
      matchedPairs: [],
      missedTransitions: [],
      spuriousDetections: [...detected],
      meanLagBars: 0,
      medianLagBars: 0,
      p95LagBars: 0,
      detectionRate: 0,
      falsePositiveRate: detected.length > 0 ? 1 : 0,
      verdict: "insufficient_data",
      summary: "No ground-truth transitions to score against.",
    };
  }

  const matched: MatchedTransition[] = [];
  const missed: RegimeTransition[] = [];
  const usedDetected = new Set<number>();

  for (const gt of groundTruth) {
    let bestIdx = -1;
    let bestLag = Infinity;
    for (let i = 0; i < detected.length; i++) {
      if (usedDetected.has(i)) continue;
      const det = detected[i]!;
      if (det.regime !== gt.regime) continue;
      const lag = det.barIndex - gt.barIndex;
      if (lag < 0) continue;
      if (lag > maxLag) continue;
      if (lag < bestLag) {
        bestLag = lag;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      usedDetected.add(bestIdx);
      matched.push({ groundTruth: gt, detected: detected[bestIdx]!, lagBars: bestLag });
    } else {
      missed.push(gt);
    }
  }

  const spurious: RegimeTransition[] = [];
  for (let i = 0; i < detected.length; i++) {
    if (!usedDetected.has(i)) spurious.push(detected[i]!);
  }

  const lags = matched.map((m) => m.lagBars);
  const meanLag = lags.length === 0 ? 0 : lags.reduce((a, b) => a + b, 0) / lags.length;
  const medLag = median(lags);
  const p95Lag = percentile(lags, 95);
  const detectionRate = matched.length / groundTruth.length;
  const falsePositiveRate = detected.length === 0 ? 0 : spurious.length / detected.length;

  let verdict: RegimeLagResult["verdict"];
  if (detectionRate < 0.5) verdict = "broken";
  else if (medLag <= 3 && detectionRate >= 0.9) verdict = "responsive";
  else if (medLag <= 10 && detectionRate >= 0.75) verdict = "acceptable";
  else verdict = "sluggish";

  const summary =
    `${matched.length}/${groundTruth.length} transitions matched (${(detectionRate * 100).toFixed(0)}%). ` +
    `Median lag ${medLag} bars, mean ${meanLag.toFixed(1)} bars, p95 ${p95Lag} bars. ` +
    `${spurious.length} spurious detection(s) (${(falsePositiveRate * 100).toFixed(0)}% FP). → ${verdict}`;

  return {
    groundTruthCount: groundTruth.length,
    detectedCount: detected.length,
    matchedPairs: matched,
    missedTransitions: missed,
    spuriousDetections: spurious,
    meanLagBars: parseFloat(meanLag.toFixed(4)),
    medianLagBars: medLag,
    p95LagBars: p95Lag,
    detectionRate: parseFloat(detectionRate.toFixed(4)),
    falsePositiveRate: parseFloat(falsePositiveRate.toFixed(4)),
    verdict,
    summary,
  };
}

export function formatRegimeLag(result: RegimeLagResult): string {
  const lines = [
    `Regime-Detection Lag — ${result.verdict.toUpperCase()}`,
    "",
    `  Ground-truth transitions: ${result.groundTruthCount}`,
    `  Detected transitions:     ${result.detectedCount}`,
    `  Matched pairs:            ${result.matchedPairs.length}`,
    `  Missed:                   ${result.missedTransitions.length}`,
    `  Spurious:                 ${result.spuriousDetections.length}`,
    "",
    `  Median lag: ${result.medianLagBars} bars`,
    `  Mean lag:   ${result.meanLagBars.toFixed(2)} bars`,
    `  p95 lag:    ${result.p95LagBars} bars`,
    `  Detection rate:      ${(result.detectionRate * 100).toFixed(0)}%`,
    `  False-positive rate: ${(result.falsePositiveRate * 100).toFixed(0)}%`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}

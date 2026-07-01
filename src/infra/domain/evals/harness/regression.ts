/**
 * Regression Detection — compares two `VariantRunResult`s, flags
 * scenarios where the candidate scored materially worse than the
 * baseline.
 *
 * Typical use: in CI, before merging a prompt / wiring-flag / model
 * change, run the suite with the change as the "candidate" variant
 * against the unchanged "baseline" variant. If any scenario regresses
 * beyond the tolerance, block the merge.
 *
 * The tolerance is intentionally explicit — a 0.05 threshold means
 * "scenarios where the candidate scored 0.05 or more lower than the
 * baseline". Smaller thresholds catch more drift; larger thresholds
 * tolerate more noise from the judge.
 */

import { appendToReviewQueue, defaultReviewQueuePath } from "./reviewQueue.ts";
import type { ReviewQueueEntry } from "./reviewQueue.ts";
import type { RegressionReport, VariantRunResult } from "./types.ts";

export interface DetectOptions {
  /** Minimum score drop (baseline - candidate) to count as a regression. Default 0.05. */
  toleranceDelta?: number;
  /**
   * When set, regressions are also appended to the review queue (a
   * local JSONL file at `~/.gordon/eval-failures.jsonl` by default).
   * Borrowed from CREAO Harness: a score with no ticket is dashboard
   * noise. Pass `true` for the default path, or a custom path string.
   */
  writeReviewQueue?: boolean | string;
  /** Optional metadata stamped onto each review-queue entry. */
  reviewQueueMetadata?: Record<string, string | number | boolean>;
  /**
   * Independent anti-metric gate. Minimum RISE in the candidate's
   * `genericAdviceRate` over the baseline's to count as a blocking
   * regression — checked SEPARATELY from the scalar score, so a
   * candidate that lifts the aggregate while doubling its rate of
   * generic non-actionable advice is still blocked. Default 0.10.
   */
  genericAdviceRateTolerance?: number;
}

/**
 * Compare a baseline run against a candidate run. Both must have been
 * scored against the same scenario set; mismatches are silently skipped.
 */
export function detectRegressions(
  baseline: VariantRunResult,
  candidate: VariantRunResult,
  options: DetectOptions = {},
): RegressionReport {
  const tolerance = options.toleranceDelta ?? 0.05;
  const genericAdviceRateTolerance = options.genericAdviceRateTolerance ?? 0.1;

  // Build lookup maps so we can match scenarios across the two runs.
  const baselineByScenario = new Map(
    baseline.perScenario.map((p) => [p.scenarioId, p]),
  );
  const candidateByScenario = new Map(
    candidate.perScenario.map((p) => [p.scenarioId, p]),
  );

  const regressions: RegressionReport["regressions"][number][] = [];
  const improvements: RegressionReport["improvements"][number][] = [];

  for (const [scenarioId, baseRow] of baselineByScenario) {
    const candRow = candidateByScenario.get(scenarioId);
    if (!candRow) continue;
    const delta = Number((candRow.score - baseRow.score).toFixed(4));
    if (delta <= -tolerance) {
      regressions.push({
        scenarioId,
        baselineScore: baseRow.score,
        candidateScore: candRow.score,
        delta,
      });
    } else if (delta >= tolerance) {
      improvements.push({
        scenarioId,
        baselineScore: baseRow.score,
        candidateScore: candRow.score,
        delta,
      });
    }
  }

  // Sort: worst regressions first, biggest improvements first.
  regressions.sort((a, b) => a.delta - b.delta);
  improvements.sort((a, b) => b.delta - a.delta);

  // Independent anti-metric gate — checked separately from per-scenario
  // score so an aggregate improvement can't mask a rise in generic
  // non-actionable advice. Missing rate (older runs) treated as 0.
  const baselineRate = baseline.genericAdviceRate ?? 0;
  const candidateRate = candidate.genericAdviceRate ?? 0;
  const genericAdviceDelta = Number((candidateRate - baselineRate).toFixed(4));
  const genericAdviceRegression =
    genericAdviceDelta >= genericAdviceRateTolerance
      ? {
          baselineRate,
          candidateRate,
          delta: genericAdviceDelta,
          tolerance: genericAdviceRateTolerance,
        }
      : undefined;

  if (options.writeReviewQueue && regressions.length > 0) {
    const path =
      typeof options.writeReviewQueue === "string"
        ? options.writeReviewQueue
        : defaultReviewQueuePath();
    const entries: ReviewQueueEntry[] = regressions.map((r) => {
      const candFailureMode = candidateByScenario.get(r.scenarioId)?.failureMode;
      return {
        scenarioId: r.scenarioId,
        baselineLabel: baseline.variantLabel,
        candidateLabel: candidate.variantLabel,
        baselineScore: r.baselineScore,
        candidateScore: r.candidateScore,
        delta: r.delta,
        ...(candFailureMode && { failureMode: candFailureMode }),
        metadata: options.reviewQueueMetadata,
      };
    });
    appendToReviewQueue(entries, path);
  }

  return {
    baselineLabel: baseline.variantLabel,
    candidateLabel: candidate.variantLabel,
    toleranceDelta: tolerance,
    aggregateDelta: Number(
      (candidate.aggregate - baseline.aggregate).toFixed(4),
    ),
    regressions,
    improvements,
    genericAdviceRegression,
    hasBlockingRegression: regressions.length > 0 || genericAdviceRegression !== undefined,
  };
}

/**
 * Pretty-print a regression report for CI logs. Includes:
 *   - Overall verdict (PASS / FAIL)
 *   - Aggregate delta
 *   - Per-scenario regressions / improvements with score diffs
 */
export function formatRegressionReport(report: RegressionReport): string {
  const lines: string[] = [];
  const verdict = report.hasBlockingRegression ? "FAIL" : "PASS";
  lines.push(`[eval] ${verdict} — ${report.candidateLabel} vs ${report.baselineLabel}`);
  lines.push(
    `  aggregate: ${formatDelta(report.aggregateDelta)} (tolerance ${report.toleranceDelta})`,
  );

  if (report.genericAdviceRegression) {
    const g = report.genericAdviceRegression;
    lines.push(
      `  generic-advice gate: BLOCK — rate ${g.baselineRate.toFixed(3)} → ${g.candidateRate.toFixed(3)} (${formatDelta(g.delta)}, tolerance ${g.tolerance})`,
    );
  }

  if (report.regressions.length > 0) {
    lines.push(`  regressions (${report.regressions.length}):`);
    for (const r of report.regressions) {
      lines.push(
        `    - ${r.scenarioId}: ${r.baselineScore.toFixed(3)} → ${r.candidateScore.toFixed(3)} (${formatDelta(r.delta)})`,
      );
    }
  }

  if (report.improvements.length > 0) {
    lines.push(`  improvements (${report.improvements.length}):`);
    for (const r of report.improvements) {
      lines.push(
        `    + ${r.scenarioId}: ${r.baselineScore.toFixed(3)} → ${r.candidateScore.toFixed(3)} (${formatDelta(r.delta)})`,
      );
    }
  }

  return lines.join("\n");
}

function formatDelta(d: number): string {
  if (d > 0) return `+${d.toFixed(4)}`;
  return d.toFixed(4);
}

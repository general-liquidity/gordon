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

/**
 * Evaluate the independent cost gate. Returns the `costRegression` payload when
 * the candidate scored equal-or-worse yet overspent past tolerance on the best
 * available metric (dollars preferred over tokens), otherwise undefined.
 */
function evaluateCostRegression(
  baseline: VariantRunResult,
  candidate: VariantRunResult,
  tolerance: number,
  blocking: boolean,
  scoreDelta: number,
): RegressionReport["costRegression"] {
  // A candidate that IMPROVED the score justifies extra spend — exempt.
  if (scoreDelta > 0) return undefined;

  const b = baseline.cost;
  const c = candidate.cost;
  if (!b || !c) return undefined;

  // Prefer dollars when both runs metered it; else fall back to tokens.
  const metric: "costUsd" | "tokens" | undefined =
    typeof b.costUsd === "number" && typeof c.costUsd === "number"
      ? "costUsd"
      : typeof b.tokens === "number" && typeof c.tokens === "number"
        ? "tokens"
        : undefined;
  if (!metric) return undefined;

  const baselineValue = metric === "costUsd" ? b.costUsd! : b.tokens!;
  const candidateValue = metric === "costUsd" ? c.costUsd! : c.tokens!;
  // A zero/negative baseline can't yield a meaningful ratio.
  if (baselineValue <= 0) return undefined;

  const ratio = Number((candidateValue / baselineValue - 1).toFixed(4));
  if (ratio <= tolerance) return undefined;

  return {
    metric,
    baselineValue,
    candidateValue,
    ratio,
    tolerance,
    scoreDelta,
    blocking,
  };
}

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
  /**
   * Independent cost gate. Maximum fractional overspend (candidate/baseline -
   * 1) tolerated when the candidate scored EQUAL-OR-WORSE than the baseline.
   * A candidate that matches (or degrades) quality while consuming more than
   * `(1 + costToleranceRatio)x` the baseline's tokens/dollars trips the gate.
   * Dollars are preferred when both runs are metered, else tokens; a metric
   * missing on either run is skipped. Default 0.20 (20%). A candidate that
   * IMPROVED the score is exempt — extra spend is justified by the better
   * outcome.
   */
  costToleranceRatio?: number;
  /**
   * When true, a tripped cost gate becomes a BLOCKING regression
   * (`hasBlockingRegression`). Default false — the cost regression is recorded
   * and formatted as advisory (warn-only) so turning the gate on can't
   * surprise an existing CI leg that only expected score/anti-metric blocks.
   */
  blockOnCostRegression?: boolean;
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
  const costToleranceRatio = options.costToleranceRatio ?? 0.2;
  const blockOnCostRegression = options.blockOnCostRegression ?? false;

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

  const aggregateDelta = Number(
    (candidate.aggregate - baseline.aggregate).toFixed(4),
  );
  const costRegression = evaluateCostRegression(
    baseline,
    candidate,
    costToleranceRatio,
    blockOnCostRegression,
    aggregateDelta,
  );

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
    aggregateDelta,
    regressions,
    improvements,
    genericAdviceRegression,
    costRegression,
    hasBlockingRegression:
      regressions.length > 0 ||
      genericAdviceRegression !== undefined ||
      (costRegression?.blocking ?? false),
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

  if (report.costRegression) {
    const c = report.costRegression;
    const verdictTag = c.blocking ? "BLOCK" : "WARN";
    const unit = c.metric === "costUsd" ? "$" : "tokens";
    lines.push(
      `  cost gate: ${verdictTag} — ${c.metric} ${formatMetricValue(c.baselineValue, unit)} → ${formatMetricValue(c.candidateValue, unit)} (+${(c.ratio * 100).toFixed(1)}% for equal-or-worse score, tolerance ${(c.tolerance * 100).toFixed(0)}%)`,
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

function formatMetricValue(v: number, unit: string): string {
  if (unit === "$") return `$${v.toFixed(4)}`;
  return `${Math.round(v).toLocaleString()} ${unit}`;
}

/**
 * Change-Type x Metric-Delta Attribution Ledger.
 *
 * A read-only observability artifact over an optimization history. Where
 * `lever-attribution.ts` attributes an edge's realized R to its INVARIANTS
 * (entry-margin buckets on live trades), this attributes an optimization
 * run's held-out metric movement to the KIND of change that produced it.
 *
 * Each discrete strategy change is tagged with a `changeType` (param-class /
 * entry-logic / sizing / stop / regime-filter / universe) and carries the
 * held-out metric before and after the change. The per-change signal is the
 * metric-delta (afterMetric - beforeMetric). Aggregating deltas per change-type
 * answers "which class of edit reliably moves the out-of-sample metric, and
 * which just churns it".
 *
 * NOT runtime self-rewrite. This does not act, mutate a genome, or gate the
 * optimizer. It is attribution over an already-recorded history: the caller
 * supplies the (change, beforeMetric, afterMetric) sequence, exactly as the
 * sibling supplies lever-tagged trades. Advisory only.
 *
 * Statistics are the same validated primitives as the sibling: a Wilson CI on
 * the improvement rate (fraction of positive deltas) and a one-sample t-test of
 * the mean delta against zero, Bonferroni-corrected across the change-types
 * present so a class that clears 0.05 alone is not flagged after many are tested.
 */

import { wilsonInterval } from "../../infra/safety/expectancyByTag.ts";
import { studentTTwoSidedPValue } from "../indicators/linearRegression.ts";

export type ChangeType =
  | "param_class"
  | "entry_logic"
  | "sizing"
  | "stop"
  | "regime_filter"
  | "universe";

export const CHANGE_TYPES: readonly ChangeType[] = [
  "param_class",
  "entry_logic",
  "sizing",
  "stop",
  "regime_filter",
  "universe",
];

export interface StrategyChange {
  changeId: string;
  changeType: ChangeType;
  /** Held-out (OOS) metric BEFORE the change — e.g. deflated Sharpe. */
  beforeMetric: number;
  /** Held-out (OOS) metric AFTER the change. */
  afterMetric: number;
  /** Optional free-form note. */
  notes?: string;
}

export type SignificanceTier = "robust" | "preliminary" | "insufficient";
export type ChangeTypeVerdict = "improves" | "regresses" | "neutral" | "insufficient";

export interface ChangeTypeAggregate {
  changeType: ChangeType;
  n: number;
  /** Mean of (afterMetric - beforeMetric) across changes of this type. */
  meanDelta: number;
  /** Fraction of changes with a strictly positive delta. */
  improvementRate: number;
  /** 95% Wilson interval on the improvement rate. */
  improvementRateCi: { lower: number; upper: number };
  /** Two-sided p-value, one-sample t-test of mean delta vs 0; null when undeterminable. */
  pValue: number | null;
  significance: SignificanceTier;
  verdict: ChangeTypeVerdict;
  reason: string;
}

export interface ChangeAttributionReport {
  changesAnalyzed: number;
  changeTypesSeen: number;
  /** Bonferroni-corrected alpha = baseAlpha / changeTypesSeen. */
  correctedAlpha: number;
  /** Sorted by |meanDelta| descending. */
  aggregates: ChangeTypeAggregate[];
  /** Largest significant positive mean-delta — the change-type paying its way. */
  topChangeType: ChangeTypeAggregate | null;
  summary: string;
}

export interface ChangeAttributionOptions {
  /** Base significance level before Bonferroni. Default 0.05. */
  alpha?: number;
  /** Min sample for the "robust" tier. Default 20. */
  robustThreshold?: number;
  /** Min sample for the "preliminary" tier. Default 8. */
  preliminaryThreshold?: number;
  /** A |meanDelta| smaller than this (and not significant) reads as churn -> neutral. Default 0. */
  neutralThresholdMetric?: number;
}

const DEFAULTS = { alpha: 0.05, robust: 20, preliminary: 8, neutral: 0 } as const;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

/** One-sample t-test of the sample mean against 0 -> { t, df }, or null when undeterminable. */
function oneSampleT(xs: number[]): { t: number; df: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const m = mean(xs);
  const variance = xs.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
  if (variance <= 0) return null; // constant deltas — no testable spread
  const se = Math.sqrt(variance / n);
  return { t: m / se, df: n - 1 };
}

function significanceTier(n: number, robust: number, preliminary: number): SignificanceTier {
  return n >= robust ? "robust" : n >= preliminary ? "preliminary" : "insufficient";
}

function scoreChangeType(
  changeType: ChangeType,
  changes: StrategyChange[],
  correctedAlpha: number,
  opts: ChangeAttributionOptions,
): ChangeTypeAggregate {
  const robust = opts.robustThreshold ?? DEFAULTS.robust;
  const preliminary = opts.preliminaryThreshold ?? DEFAULTS.preliminary;
  const neutral = opts.neutralThresholdMetric ?? DEFAULTS.neutral;

  const deltas = changes.map((c) => c.afterMetric - c.beforeMetric);
  const n = deltas.length;
  const wins = deltas.filter((d) => d > 0).length;
  const meanDelta = mean(deltas);

  const t = oneSampleT(deltas);
  const pValue = t ? studentTTwoSidedPValue(t.t, t.df) : null;
  const significant = pValue !== null && pValue < correctedAlpha;
  const significance = significanceTier(n, robust, preliminary);

  let verdict: ChangeTypeVerdict;
  let reason: string;
  if (significance === "insufficient") {
    verdict = "insufficient";
    reason = `Insufficient sample to judge (n=${n})`;
  } else if (significant && meanDelta > 0) {
    verdict = "improves";
    reason = `Mean held-out delta +${meanDelta.toFixed(3)} over ${n} changes (p=${pValue!.toFixed(3)} < ${correctedAlpha.toFixed(3)}) — this class of edit pays its way`;
  } else if (significant && meanDelta < 0) {
    verdict = "regresses";
    reason = `Mean held-out delta ${meanDelta.toFixed(3)} over ${n} changes (p=${pValue!.toFixed(3)}) — this class of edit degrades the metric`;
  } else if (Math.abs(meanDelta) <= neutral || !significant) {
    verdict = "neutral";
    reason = `No reliable movement (Δ=${meanDelta.toFixed(3)}, not significant at α=${correctedAlpha.toFixed(3)}) — churn`;
  } else {
    verdict = "neutral";
    reason = `Suggestive (Δ=${meanDelta.toFixed(3)}) but not robust at α=${correctedAlpha.toFixed(3)}`;
  }

  return {
    changeType,
    n,
    meanDelta,
    improvementRate: n ? wins / n : 0,
    improvementRateCi: wilsonInterval(wins, n),
    pValue,
    significance,
    verdict,
    reason,
  };
}

/**
 * Attribute an optimization history's held-out metric movement to the KIND of
 * change. Groups the changes by `changeType`, and for each type tests whether
 * the mean metric-delta differs from zero, Bonferroni-corrected across the
 * change-types present.
 */
export function analyzeChangeAttribution(
  changes: StrategyChange[],
  opts: ChangeAttributionOptions = {},
): ChangeAttributionReport {
  const baseAlpha = opts.alpha ?? DEFAULTS.alpha;

  const byType = new Map<ChangeType, StrategyChange[]>();
  for (const c of changes) {
    const bucket = byType.get(c.changeType);
    if (bucket) bucket.push(c);
    else byType.set(c.changeType, [c]);
  }

  const changeTypesSeen = byType.size;
  const correctedAlpha = baseAlpha / Math.max(1, changeTypesSeen);

  const aggregates = [...byType.entries()]
    .map(([type, cs]) => scoreChangeType(type, cs, correctedAlpha, opts))
    .sort((a, b) => Math.abs(b.meanDelta) - Math.abs(a.meanDelta));

  const improving = aggregates.filter((a) => a.verdict === "improves");
  const topChangeType = improving.length
    ? improving.reduce((best, a) => (a.meanDelta > best.meanDelta ? a : best))
    : null;

  const counts = aggregates.reduce<Record<string, number>>((acc, a) => {
    acc[a.verdict] = (acc[a.verdict] ?? 0) + 1;
    return acc;
  }, {});
  const summary =
    `Change attribution over ${changes.length} changes, ${changeTypesSeen} type(s): ` +
    (["improves", "regresses", "neutral", "insufficient"] as const)
      .filter((v) => counts[v])
      .map((v) => `${counts[v]} ${v}`)
      .join(", ") +
    (topChangeType
      ? `. Best: ${topChangeType.changeType} (+${topChangeType.meanDelta.toFixed(3)}).`
      : ".");

  return {
    changesAnalyzed: changes.length,
    changeTypesSeen,
    correctedAlpha,
    aggregates,
    topChangeType,
    summary,
  };
}

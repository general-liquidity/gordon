/**
 * Composite attribution — explains which dimensions drove a
 * `riskClassifier` verdict.
 *
 * Today the classifier returns `compositeScore`, `tier`, and `topFactors`.
 * That tells the operator "what came up red" but not "what share of
 * the verdict each dimension owned."
 *
 * This module takes the same `RiskAssessment` and produces a full
 * attribution: each dimension's weighted contribution as a percentage
 * of the total weighted score, sorted descending, plus the top and
 * bottom drivers.
 *
 * Operator UX: when a trade gets gated to `prompt_user` or `block`,
 * the operator can immediately see whether the verdict was driven by
 * position size (sized too big), correlation risk (concentration),
 * regime transition (boundary risk), or other dimensions — without
 * mentally reweighting 12 raw scores.
 *
 * Purely diagnostic — does not change the classifier's behavior.
 */

import type { RiskAssessment, RiskDimension } from "../../infra/trading/risk/riskClassifier.ts";

export interface DimensionAttribution {
  name: string;
  rawScore: number;
  weight: number;
  /** Weighted score: rawScore × weight. */
  weightedScore: number;
  /** Share of total weighted score (0..1). */
  contribution: number;
  /** Share as percentage (0..100). */
  contributionPct: number;
  reason: string;
}

export interface CompositeAttribution {
  compositeScore: number;
  tier: RiskAssessment["tier"];
  recommendation: RiskAssessment["recommendation"];
  /** Dimensions sorted by weighted contribution, descending. */
  dimensionsByContribution: DimensionAttribution[];
  /** Top driver — the dimension contributing the most to the verdict. */
  topDriver: DimensionAttribution | null;
  /** Bottom driver — the dimension contributing the least (excluding zero contributions). */
  bottomDriver: DimensionAttribution | null;
  /** Total weight across all dimensions. */
  totalWeight: number;
  /** Total weighted score (denominator for contribution percentages). */
  totalWeightedScore: number;
  /** Operator-facing one-line explanation. */
  summary: string;
}

/**
 * Compute attribution from a RiskAssessment. Returns a structured
 * breakdown the operator surface can render verbatim.
 *
 * Edge cases:
 *   - Empty dimensions[] → attribution with empty arrays + null drivers
 *   - All scores 0 → all contributions are 0; topDriver is the highest-
 *     weighted dimension (most likely to flip first if scores rise)
 */
export function explainCompositeAttribution(assessment: RiskAssessment): CompositeAttribution {
  const dims = assessment.dimensions;

  let totalWeight = 0;
  let totalWeightedScore = 0;
  for (const d of dims) {
    totalWeight += d.weight;
    totalWeightedScore += d.score * d.weight;
  }

  const attributions: DimensionAttribution[] = dims.map((d) => {
    const weightedScore = d.score * d.weight;
    const contribution = totalWeightedScore > 0 ? weightedScore / totalWeightedScore : 0;
    return {
      name: d.name,
      rawScore: d.score,
      weight: d.weight,
      weightedScore,
      contribution,
      contributionPct: contribution * 100,
      reason: d.reason,
    };
  });

  const sorted = [...attributions].sort((a, b) => b.weightedScore - a.weightedScore);

  const topDriver = sorted.length > 0 ? sorted[0]! : null;
  // Bottom driver: lowest non-zero contribution, OR lowest weighted score
  // when everything is zero.
  const nonZero = sorted.filter((a) => a.weightedScore > 0);
  let bottomDriver: DimensionAttribution | null = null;
  if (nonZero.length > 0) {
    bottomDriver = nonZero[nonZero.length - 1]!;
  } else if (sorted.length > 0) {
    bottomDriver = sorted[sorted.length - 1]!;
  }

  let summary: string;
  if (topDriver === null) {
    summary = `Composite ${assessment.compositeScore.toFixed(1)} (${assessment.tier}) — no dimensions recorded`;
  } else if (topDriver.weightedScore === 0) {
    summary = `Composite ${assessment.compositeScore.toFixed(1)} (${assessment.tier}) — all dimensions clean`;
  } else {
    summary =
      `Composite ${assessment.compositeScore.toFixed(1)} (${assessment.tier}, ${assessment.recommendation}) — ` +
      `${topDriver.contributionPct.toFixed(0)}% from ${topDriver.name} (score ${topDriver.rawScore.toFixed(0)})`;
  }

  return {
    compositeScore: assessment.compositeScore,
    tier: assessment.tier,
    recommendation: assessment.recommendation,
    dimensionsByContribution: sorted,
    topDriver,
    bottomDriver,
    totalWeight,
    totalWeightedScore,
    summary,
  };
}

/**
 * Render a compact human-readable attribution table. Each row:
 *   "  Dimension Name     XX% (rawScore × weight)"
 *
 * Used by CLI commands / structured-observation logging. Operator-
 * readable, machine-parsable on column alignment.
 */
export function formatAttributionTable(attr: CompositeAttribution): string {
  if (attr.dimensionsByContribution.length === 0) {
    return "(no dimensions)";
  }
  const maxName = Math.max(...attr.dimensionsByContribution.map((d) => d.name.length));
  const lines: string[] = [
    `Composite ${attr.compositeScore.toFixed(1)} → ${attr.tier} (${attr.recommendation})`,
    "",
    `  ${"Dimension".padEnd(maxName)}  Share   Score × Weight  Reason`,
    `  ${"─".repeat(maxName)}  ──────  ──────────────  ──────`,
  ];
  for (const d of attr.dimensionsByContribution) {
    const sharePct = `${d.contributionPct.toFixed(1)}%`.padStart(6);
    const sw = `${d.rawScore.toFixed(0)} × ${d.weight.toFixed(1)}`.padEnd(14);
    lines.push(`  ${d.name.padEnd(maxName)}  ${sharePct}  ${sw}  ${d.reason}`);
  }
  return lines.join("\n");
}

// Re-export for downstream convenience
export type { RiskAssessment, RiskDimension };

/**
 * Confluence Scorer (GORDON_CONFLUENCE_SCORER).
 *
 * Port of the A-star / B / C trade-quality tiering pattern from TraderMorin's
 * "The First AI Workflow Every Trader Should Build" (2026). The central
 * mechanic the trader names: count the secondary confluences present on
 * a setup, map to a tier (A-star / A / B / C), then *scale risk by tier*.
 *
 *   "A* setup in my playbook has a much higher expectancy therefore I am
 *    willing to risk more of my account on that setup compared to a B or C
 *    tier setup."
 *
 * Distinct from `riskClassifier.ts`: the risk classifier is a *safety
 * gate* (auto_approve / prompt_user / require_confirmation / block). It
 * answers "is this trade safe to fire?" — binary-ish, mandate-aware.
 *
 * This module answers a different question: "how *good* is the setup
 * relative to other setups, and how much should that change my size?"
 * Quality grading, not safety gating. The two compose — a tier A*
 * setup that the risk classifier blocks still doesn't fire.
 *
 * Composability with `adversarialEvaluator`: when an adversarial review
 * produces high-severity failure findings, `applyAdversarialDowngrade`
 * shifts the tier down. The trader names this explicitly: "putting
 * yourself on the other side ... might help you poke holes in your plan
 * which can lead to you reducing your risk on a setup you thought was an
 * A* but is just a B tier setup."
 */

/**
 * Canonical confluence types Gordon recognises. Extend by registering
 * additional names; unknown names still contribute to the count.
 */
export type ConfluenceKind =
  | "divergence"
  | "ema_alignment"
  | "regime_fit"
  | "key_level_proximity"
  | "volume_confirmation"
  | "composite_signal"
  | "single_print"
  | "thesis_coherence"
  | "session_timing"
  | "liquidity_pool"
  | "order_flow"
  | "macro_alignment";

export interface ConfluenceObservation {
  kind: ConfluenceKind | string;
  /** True when the confluence is *present* and supporting the trade. */
  present: boolean;
  /** Optional one-line evidence: "RSI bullish divergence on 1h", "regime=bullish_trend matches direction=long". */
  evidence?: string;
  /** Optional weight 0..1. Default 1. Lets callers weight stronger confluences higher. */
  weight?: number;
}

export type ConfluenceTier = "A*" | "A" | "B" | "C";

export interface ConfluenceScore {
  /** Weighted count of present confluences. */
  score: number;
  /** Total possible weighted score (sum of all observed weights). */
  total: number;
  /** Normalized score in [0, 1]. */
  ratio: number;
  tier: ConfluenceTier;
  presentKinds: string[];
  missingKinds: string[];
  /** Per-tier risk multiplier vs the operator's base risk. */
  riskMultiplier: number;
}

export interface ScoreInput {
  observations: readonly ConfluenceObservation[];
  /**
   * Override tier thresholds. Default mapping (on normalized 0..1):
   *   - ratio >= 0.85 → A*
   *   - ratio >= 0.65 → A
   *   - ratio >= 0.40 → B
   *   - else          → C
   */
  thresholds?: { aStar: number; a: number; b: number };
}

export const DEFAULT_THRESHOLDS = { aStar: 0.85, a: 0.65, b: 0.4 } as const;

/**
 * Per-tier risk multipliers. TraderMorin doesn't publish exact ratios —
 * these are sensible defaults a caller can override. The *spread* between
 * tiers is what matters: A* gets meaningfully more risk than C, with
 * a hard floor so C-tier setups still place SOMETHING when taken.
 */
export const DEFAULT_RISK_MULTIPLIERS: Record<ConfluenceTier, number> = {
  "A*": 1.5,
  A: 1.0,
  B: 0.5,
  C: 0.25,
};

export function scoreConfluences(input: ScoreInput): ConfluenceScore {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  let score = 0;
  let total = 0;
  const presentKinds: string[] = [];
  const missingKinds: string[] = [];

  for (const obs of input.observations) {
    const w = obs.weight ?? 1;
    total += w;
    if (obs.present) {
      score += w;
      presentKinds.push(obs.kind);
    } else {
      missingKinds.push(obs.kind);
    }
  }

  const ratio = total === 0 ? 0 : score / total;
  let tier: ConfluenceTier;
  if (ratio >= thresholds.aStar) tier = "A*";
  else if (ratio >= thresholds.a) tier = "A";
  else if (ratio >= thresholds.b) tier = "B";
  else tier = "C";

  return {
    score,
    total,
    ratio,
    tier,
    presentKinds,
    missingKinds,
    riskMultiplier: DEFAULT_RISK_MULTIPLIERS[tier],
  };
}

/**
 * Scale a base risk allocation by tier. Use this *after* the risk
 * classifier has already cleared the trade — it's a sizing adjustment,
 * not a safety check.
 *
 *   baseRiskPct = 1% of account
 *   A* setup → 1.5% of account
 *   C setup  → 0.25% of account
 */
export function sizeForTier(
  baseRiskPct: number,
  tier: ConfluenceTier,
  multipliers: Record<ConfluenceTier, number> = DEFAULT_RISK_MULTIPLIERS,
): number {
  return baseRiskPct * multipliers[tier];
}

/**
 * Apply downgrade based on adversarial review findings. From the
 * article: hostile review can reveal "A*" was actually B. Maps high/critical
 * findings to tier shifts.
 */
export interface AdversarialDowngradeInput {
  /** Number of high-severity failure findings. */
  highSeverityFindings: number;
  /** Number of critical-severity failure findings. */
  criticalFindings: number;
}

const TIER_ORDER: ConfluenceTier[] = ["A*", "A", "B", "C"];

export function applyAdversarialDowngrade(
  tier: ConfluenceTier,
  input: AdversarialDowngradeInput,
): { tier: ConfluenceTier; downgradedBy: number; reason: string | null } {
  let shift = 0;
  const reasons: string[] = [];
  if (input.criticalFindings > 0) {
    shift += input.criticalFindings * 2;
    reasons.push(`${input.criticalFindings} critical finding(s)`);
  }
  if (input.highSeverityFindings > 0) {
    shift += input.highSeverityFindings;
    reasons.push(`${input.highSeverityFindings} high-severity finding(s)`);
  }
  if (shift === 0) {
    return { tier, downgradedBy: 0, reason: null };
  }
  const currentIdx = TIER_ORDER.indexOf(tier);
  const nextIdx = Math.min(currentIdx + shift, TIER_ORDER.length - 1);
  return {
    tier: TIER_ORDER[nextIdx]!,
    downgradedBy: nextIdx - currentIdx,
    reason: reasons.join(" + "),
  };
}

export function formatScore(score: ConfluenceScore): string {
  const lines: string[] = [];
  lines.push(
    `Confluence: ${score.tier} (${score.score.toFixed(1)}/${score.total.toFixed(1)} present, risk × ${score.riskMultiplier})`,
  );
  if (score.presentKinds.length > 0) {
    lines.push(`  ✓ ${score.presentKinds.join(", ")}`);
  }
  if (score.missingKinds.length > 0) {
    lines.push(`  ✗ ${score.missingKinds.join(", ")}`);
  }
  return lines.join("\n");
}

export function scoreToPayload(score: ConfluenceScore): Record<string, unknown> {
  return {
    kind: "confluence.score_recorded",
    tier: score.tier,
    ratio: Number(score.ratio.toFixed(3)),
    score: score.score,
    total: score.total,
    riskMultiplier: score.riskMultiplier,
    presentCount: score.presentKinds.length,
    missingCount: score.missingKinds.length,
  };
}

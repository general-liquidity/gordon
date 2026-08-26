/**
 * Risk-acknowledgement gate (GORDON_RISK_ACK).
 *
 * When enabled, execute_plan requires the agent to explicitly enumerate
 * the top N risk dimensions (by weighted score) from the riskClassifier
 * before execution proceeds. Replaces single-keystroke approval with
 * explicit acknowledgement of what could go wrong — anti-rubber-stamp
 * defense from Faye's coding-agent trap critique applied to trading.
 *
 * Only gates medium+ tier assessments; low-tier trades pass through.
 */

import type { RiskAssessment, RiskDimension } from "../../trading/risk/riskClassifier.ts";
import { flagEnv } from "../../config/flagResolver.ts";

export function isRiskAckEnabled(
  env: NodeJS.ProcessEnv = flagEnv(),
): boolean {
  return env.GORDON_RISK_ACK === "1" || env.GORDON_RISK_ACK === "true";
}

export function topWeightedDimensions(
  assessment: RiskAssessment,
  n: number = 3,
): RiskDimension[] {
  return [...assessment.dimensions]
    .map((d) => ({ d, weighted: d.score * d.weight }))
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, n)
    .map((x) => x.d);
}

export interface AcknowledgementResult {
  ok: boolean;
  required: string[];
  missing: string[];
  reason?: string;
}

/**
 * Verify the agent's `acknowledgedRisks` covers the top dimensions.
 * Comparison is case-insensitive substring match — each acknowledgement
 * must mention the dimension by name, not just paste boilerplate.
 */
export function verifyRiskAcknowledgement(
  provided: ReadonlyArray<string>,
  assessment: RiskAssessment,
  env: NodeJS.ProcessEnv = flagEnv(),
  topN: number = 3,
): AcknowledgementResult {
  if (!isRiskAckEnabled(env)) {
    return { ok: true, required: [], missing: [] };
  }

  if (assessment.tier === "low") {
    return { ok: true, required: [], missing: [] };
  }

  const required = topWeightedDimensions(assessment, topN).map((d) => d.name);
  const providedLower = provided.map((s) => s.toLowerCase());

  const missing: string[] = [];
  for (const name of required) {
    const hit = providedLower.some((p) => p.includes(name.toLowerCase()));
    if (!hit) missing.push(name);
  }

  if (missing.length === 0) {
    return { ok: true, required, missing: [] };
  }

  return {
    ok: false,
    required,
    missing,
    reason:
      `GORDON_RISK_ACK is enabled and risk tier is '${assessment.tier}'. ` +
      `Before executing, the agent must enumerate the top ${topN} risk dimensions in the acknowledgedRisks field. ` +
      `Missing acknowledgement for: ${missing.join(", ")}. ` +
      `Each acknowledgement should be a short sentence stating why the risk is acceptable in this specific setup — ` +
      `not boilerplate. This forces explicit supervision instead of single-keystroke approval.`,
  };
}

/**
 * Warning-based variant for code paths that have a risk-gate warnings
 * array but not a full RiskAssessment. Requires acknowledgedRisks to
 * have at least one substantive entry (>=20 chars) per warning.
 * Used by execute_plan where the existing risk-gate returns warnings.
 */
export function verifyAcksFromWarnings(
  provided: ReadonlyArray<string>,
  warnings: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = flagEnv(),
): AcknowledgementResult {
  if (!isRiskAckEnabled(env)) {
    return { ok: true, required: [], missing: [] };
  }
  if (warnings.length === 0) {
    return { ok: true, required: [], missing: [] };
  }
  const substantive = provided.filter((s) => s.trim().length >= 20);
  if (substantive.length >= warnings.length) {
    return { ok: true, required: warnings.slice(), missing: [] };
  }
  return {
    ok: false,
    required: warnings.slice(),
    missing: warnings.slice(substantive.length),
    reason:
      `GORDON_RISK_ACK is enabled. The risk gate raised ${warnings.length} warnings: ${warnings.join(" | ")}. ` +
      `Provide at least ${warnings.length} substantive (>=20 chars) entries in acknowledgedRisks — one per warning — ` +
      `each stating why that specific risk is acceptable in this setup. ` +
      `Boilerplate ("acknowledged", "OK", "yes") will not satisfy this gate. ` +
      `This is an anti-rubber-stamp guard: forcing explicit supervision instead of single-keystroke approval.`,
  };
}

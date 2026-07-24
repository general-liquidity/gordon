/**
 * Adversarial Evaluator (GORDON_ADVERSARIAL_EVALUATOR).
 *
 * Trading-domain port of the GAN-inspired generator-evaluator pattern from
 * Anthropic's "Harness Design for Long-Running Application Development"
 * (2026). The failure mode Anthropic names:
 *
 *   "When asked to evaluate work they've produced, agents tend to respond
 *    by confidently praising the work — even when quality is obviously
 *    mediocre."
 *
 * This primitive wraps an existing evaluator (`critiquePhase.ts`,
 * `planRubric.ts`, terminationLayers, etc.) with a discipline that
 * enforces minimum hostility. The evaluator must produce a minimum
 * number of identified failure modes, with explicit categories and
 * severity, before its verdict is treated as a legitimate adversarial
 * review.
 *
 * Two concrete contributions:
 *   1. `buildAdversarialPrompt` — wraps a base evaluator prompt with the
 *      hostile framing Anthropic recommends. Plug into existing
 *      evaluator calls.
 *   2. `acceptIfAdversarial` — gate that requires the report to meet
 *      hostility thresholds (min failure modes, min severity coverage)
 *      before its `passed` verdict is honoured. A "passed" review that
 *      identified zero issues is treated as a failed *review*, not a
 *      passed *target*.
 *
 * The primitive does NOT call an LLM directly. Callers wire the prompt
 * into their existing evaluator and pass the response back as a
 * structured `AdversarialReport`.
 */

import { flagEnv } from "../../config/flagResolver.ts";

export const ADVERSARIAL_EVALUATOR_FLAG_ENV = "GORDON_ADVERSARIAL_EVALUATOR";

export type FailureCategory =
  | "logic"
  | "safety"
  | "data"
  | "scope"
  | "verification"
  | "performance"
  | "other";

export type FailureSeverity = "low" | "medium" | "high" | "critical";

export interface FailureMode {
  id: string;
  category: FailureCategory;
  severity: FailureSeverity;
  description: string;
  /** Optional evidence — line/file/quote that supports the finding. */
  evidence?: string;
}

export interface AdversarialReport {
  /** The base evaluator's pass/fail verdict. */
  passed: boolean;
  /** The base evaluator's numeric score (higher = better). */
  baseScore: number;
  /** Identified failure modes, in any order. */
  failureModes: FailureMode[];
  /** Free-form rationale for the verdict. */
  rationale: string;
}

export interface AdversarialGateOptions {
  /** Minimum number of failure modes the report must identify. Default 3. */
  minFailureModes?: number;
  /**
   * Minimum number of *distinct* categories the failure modes must span.
   * Forces the reviewer to look across multiple axes. Default 2.
   */
  minDistinctCategories?: number;
  /**
   * Require at least one finding at this severity (or higher) when the
   * verdict is `passed: false`. Prevents "fails on minor issues only"
   * reviews. Default "medium".
   */
  minSeverityOnFail?: FailureSeverity;
}

export interface AdversarialGateResult {
  /** Final accepted verdict — pass requires both base.passed AND hostility. */
  accepted: boolean;
  /** Was the review sufficiently adversarial? */
  isAdversarial: boolean;
  /** 0..1 — how hostile the review was (uses thresholds). */
  hostilityScore: number;
  /** Reasons the gate rejected (empty when accepted). */
  rejectionReasons: string[];
}

const SEVERITY_RANK: Record<FailureSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function isAdversarialEvaluatorEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  // Default-on: the hostile-review discipline ships on out-of-box, throttled by
  // the cost budget. Operators force-off via GORDON_ADVERSARIAL_EVALUATOR=0.
  // Read via flagEnv() so settings.json + /flags can toggle it (env still wins).
  const raw = env[ADVERSARIAL_EVALUATOR_FLAG_ENV];
  return raw !== "0" && raw !== "false";
}

/**
 * Build an adversarial-framed evaluator prompt. The caller invokes the
 * model with this prompt and parses the JSON response into an
 * `AdversarialReport`.
 *
 * The framing assumes the work is broken until proven otherwise — the
 * exact pattern Anthropic uses.
 */
export function buildAdversarialPrompt(
  basePrompt: string,
  opts: { minFailureModes?: number; minDistinctCategories?: number } = {},
): string {
  const minMode = opts.minFailureModes ?? 3;
  const minCat = opts.minDistinctCategories ?? 2;
  return [
    "ASSUME THIS WORK IS BROKEN UNTIL YOU PROVE OTHERWISE.",
    "",
    "Your job is to find what's wrong, not to confirm what looks right. Confidently",
    "praising the work is a failure of YOUR review. A short review that finds nothing",
    "will be treated as evidence that the review was inadequate, not that the work was good.",
    "",
    `You MUST identify at least ${minMode} concrete failure modes across at least`,
    `${minCat} distinct categories. Each failure mode must include category, severity,`,
    "and concrete evidence (a quote, a file path, a specific assumption being made).",
    "",
    "Allowed categories: logic, safety, data, scope, verification, performance, other.",
    "Allowed severities: low, medium, high, critical.",
    "",
    "Output JSON only, matching:",
    `{`,
    `  "passed": <boolean>,`,
    `  "baseScore": <number>,`,
    `  "failureModes": [`,
    `    { "id": "...", "category": "...", "severity": "...", "description": "...", "evidence": "..." }`,
    `  ],`,
    `  "rationale": "<one paragraph>"`,
    `}`,
    "",
    "TASK CONTEXT:",
    basePrompt,
  ].join("\n");
}

/**
 * Apply the adversarial gate. A `passed: true` base verdict is only
 * honoured when the review meets the hostility thresholds. A passing
 * review that found zero issues is rejected as "insufficiently adversarial."
 */
export function acceptIfAdversarial(
  report: AdversarialReport,
  opts: AdversarialGateOptions = {},
): AdversarialGateResult {
  const minModes = opts.minFailureModes ?? 3;
  const minCategories = opts.minDistinctCategories ?? 2;
  const minSeverityOnFail = opts.minSeverityOnFail ?? "medium";

  const rejectionReasons: string[] = [];

  // Hostility: enough findings?
  if (report.failureModes.length < minModes) {
    rejectionReasons.push(
      `only ${report.failureModes.length} failure modes; need at least ${minModes}`,
    );
  }

  // Hostility: enough breadth?
  const distinctCategories = new Set(report.failureModes.map((f) => f.category));
  if (distinctCategories.size < minCategories) {
    rejectionReasons.push(
      `${distinctCategories.size} distinct categories; need at least ${minCategories}`,
    );
  }

  // If the base verdict is "failed", insist that at least one finding
  // justifies the failure at the required severity.
  if (!report.passed) {
    const minRank = SEVERITY_RANK[minSeverityOnFail];
    const hasJustification = report.failureModes.some(
      (f) => SEVERITY_RANK[f.severity] >= minRank,
    );
    if (!hasJustification) {
      rejectionReasons.push(
        `verdict is failed but no finding at severity >= ${minSeverityOnFail}; review may be cherry-picking`,
      );
    }
  }

  const isAdversarial = rejectionReasons.length === 0;

  // hostilityScore: weighted average of (count ratio, category ratio, severity ratio).
  const countRatio = Math.min(1, report.failureModes.length / Math.max(minModes, 1));
  const catRatio = Math.min(1, distinctCategories.size / Math.max(minCategories, 1));
  const sevRatio =
    report.failureModes.length === 0
      ? 0
      : report.failureModes.reduce((sum, f) => sum + SEVERITY_RANK[f.severity], 0) /
        (report.failureModes.length * SEVERITY_RANK.critical);
  const hostilityScore = (countRatio + catRatio + sevRatio) / 3;

  return {
    accepted: report.passed && isAdversarial,
    isAdversarial,
    hostilityScore,
    rejectionReasons,
  };
}

export function formatAdversarialReport(
  report: AdversarialReport,
  gate: AdversarialGateResult,
): string {
  const lines: string[] = [];
  lines.push(
    `Adversarial review — ${gate.accepted ? "ACCEPTED" : "REJECTED"} (hostility=${gate.hostilityScore.toFixed(2)})`,
  );
  lines.push(`  base verdict: passed=${report.passed} score=${report.baseScore.toFixed(2)}`);
  if (gate.rejectionReasons.length > 0) {
    lines.push("  rejected because:");
    for (const r of gate.rejectionReasons) lines.push(`    - ${r}`);
  }
  lines.push(`  failure modes (${report.failureModes.length}):`);
  for (const f of report.failureModes) {
    lines.push(`    [${f.severity.toUpperCase()}] ${f.category}: ${f.description}`);
    if (f.evidence) lines.push(`      evidence: ${f.evidence}`);
  }
  return lines.join("\n");
}

export function reportToPayload(
  report: AdversarialReport,
  gate: AdversarialGateResult,
): Record<string, unknown> {
  return {
    kind: "adversarial_eval.review_recorded",
    accepted: gate.accepted,
    isAdversarial: gate.isAdversarial,
    hostilityScore: gate.hostilityScore,
    basePassed: report.passed,
    baseScore: report.baseScore,
    failureModeCount: report.failureModes.length,
    rejectionReasons: gate.rejectionReasons,
  };
}

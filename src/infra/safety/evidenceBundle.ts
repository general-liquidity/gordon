/**
 * Evidence Bundle — Per-Action Verification Envelope (GORDON_EVIDENCE_BUNDLE).
 *
 * Per the "Code as Agent Harness" survey (UIUC / Meta / Stanford, 2026)
 * open problem #2 ("verification gap"): green tests are not a correct
 * specification. Every accepted action should ship with a structured
 * envelope describing:
 *   - which checks ran
 *   - which assumptions held
 *   - which parts of the decision stayed unverified
 *   - what risks remain after the gates have passed
 *
 * This primitive defines the envelope shape and a deterministic verdict
 * function that aggregates the four fields into a {ready | conditional
 * | blocked} status. It is pure compute — the caller decides where to
 * record the bundle (typically `recordStructuredObservation` on a
 * safety-critical tool path: `execute_plan`, `place_order`, `cancel_*`,
 * `wallet_transfer`).
 *
 * Gordon already records each of these fields somewhere (rationale on
 * cancel/execute, riskClassifier verdict on order paths, consensus
 * protocol vote per trade proposal, hook outcomes via PreToolUse). This
 * primitive unifies them into one typed shape so downstream consumers
 * (audit replay, eval-failures.jsonl reviewer, ACE Reflector) see a
 * single envelope rather than five overlapping observation kinds.
 *
 * Design notes:
 *   - Bundle is immutable once `buildEvidenceBundle` returns.
 *   - The optional fluent builder (`createEvidenceBundleBuilder`)
 *     accumulates entries; calling `.build(meta)` freezes them into
 *     the envelope. Re-use after `.build()` is allowed but only the
 *     snapshot is sealed.
 *   - Status is computed deterministically from the four arrays — never
 *     promoted by the caller. This is the load-bearing rule: "green
 *     bundle is the spec, not a self-assessment."
 *
 * Status rule (deterministic, no LLM in the loop):
 *   BLOCKED      if any check failed OR any HIGH-severity gap
 *   CONDITIONAL  if any check warning OR any assumption violated OR
 *                medium-severity gap
 *   READY        otherwise (including empty bundle — caller decides
 *                whether to require minimum coverage separately)
 *
 * Pure compute. No I/O. Deterministic.
 */

export const EVIDENCE_BUNDLE_FLAG_ENV = "GORDON_EVIDENCE_BUNDLE";

export function isEvidenceBundleEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[EVIDENCE_BUNDLE_FLAG_ENV] === "1" ||
    env[EVIDENCE_BUNDLE_FLAG_ENV] === "true"
  );
}

export type CheckOutcome = "pass" | "fail" | "warning" | "skip" | "abstain";

export interface EvidenceCheck {
  /** Stable identifier of the verifier — e.g. "risk_classifier", "consensus_protocol". */
  name: string;
  outcome: CheckOutcome;
  /** Human-readable detail; truncated by callers if oversized. */
  detail?: string;
  /** Structured artifact: score, threshold, evaluator vote, etc. */
  evidence?: Record<string, unknown>;
  /** Optional cost-attribution hook. */
  durationMs?: number;
}

export interface EvidenceAssumption {
  /** Stable identifier — e.g. "regime_alignment", "mandate_within_scope", "daily_loss_under_cap". */
  name: string;
  /** True if the assumption holds at decision time. */
  held: boolean;
  /** Source — e.g. "regime/detector", "mandates/strategyMandates", "circuit-breaker/dailyLoss". */
  basis?: string;
  observedValue?: unknown;
  expectedRange?: unknown;
}

export type GapSeverity = "low" | "medium" | "high";

export interface EvidenceGap {
  /** What was NOT verified — e.g. "counterparty_credit", "correlation_to_open_book". */
  area: string;
  /** Why it wasn't verified (data missing, out of scope, infra fault). */
  reason: string;
  severity: GapSeverity;
}

export type ResidualRiskCategory =
  | "market"
  | "execution"
  | "liquidity"
  | "operational"
  | "tail";

export interface ResidualRisk {
  description: string;
  category: ResidualRiskCategory;
  /** How the risk is mitigated, if at all. */
  mitigation?: string;
}

export interface EvidenceBundleMeta {
  /** Caller-supplied unique identifier for this action. */
  actionId: string;
  /** Tool / event type — e.g. "execute_plan", "place_order", "cancel_order". */
  actionType: string;
  /** Wall-clock ms (typically `Date.now()` at the caller). */
  timestamp: number;
  /** Optional rationale (the Ramp-style "why" string carried on safety-critical tools). */
  rationale?: string;
}

export type BundleStatus = "ready" | "conditional" | "blocked";

export interface EvidenceBundleSummary {
  checksTotal: number;
  checksPassed: number;
  checksFailed: number;
  checksWarning: number;
  checksSkipped: number;
  assumptionsTotal: number;
  assumptionsHeld: number;
  assumptionsViolated: number;
  gapsHigh: number;
  gapsMedium: number;
  gapsLow: number;
  residualRiskCount: number;
  status: BundleStatus;
  /** Deterministic verdict string suitable for logging or human review. */
  verdict: string;
}

export interface EvidenceBundle extends EvidenceBundleMeta {
  checks: ReadonlyArray<EvidenceCheck>;
  assumptions: ReadonlyArray<EvidenceAssumption>;
  gaps: ReadonlyArray<EvidenceGap>;
  residualRisks: ReadonlyArray<ResidualRisk>;
  summary: EvidenceBundleSummary;
}

export interface EvidenceBundleInput extends EvidenceBundleMeta {
  checks?: ReadonlyArray<EvidenceCheck>;
  assumptions?: ReadonlyArray<EvidenceAssumption>;
  gaps?: ReadonlyArray<EvidenceGap>;
  residualRisks?: ReadonlyArray<ResidualRisk>;
}

function computeSummary(
  checks: ReadonlyArray<EvidenceCheck>,
  assumptions: ReadonlyArray<EvidenceAssumption>,
  gaps: ReadonlyArray<EvidenceGap>,
  residualRisks: ReadonlyArray<ResidualRisk>,
): EvidenceBundleSummary {
  let passed = 0;
  let failed = 0;
  let warning = 0;
  let skipped = 0;
  for (const c of checks) {
    switch (c.outcome) {
      case "pass":
        passed++;
        break;
      case "fail":
        failed++;
        break;
      case "warning":
        warning++;
        break;
      case "skip":
      case "abstain":
        skipped++;
        break;
    }
  }
  let held = 0;
  let violated = 0;
  for (const a of assumptions) (a.held ? held++ : violated++);
  let gapsHigh = 0;
  let gapsMedium = 0;
  let gapsLow = 0;
  for (const g of gaps) {
    if (g.severity === "high") gapsHigh++;
    else if (g.severity === "medium") gapsMedium++;
    else gapsLow++;
  }

  let status: BundleStatus;
  if (failed > 0 || gapsHigh > 0) {
    status = "blocked";
  } else if (warning > 0 || violated > 0 || gapsMedium > 0) {
    status = "conditional";
  } else {
    status = "ready";
  }

  const parts: string[] = [];
  parts.push(
    `${checks.length} checks (${passed}✓ ${failed}✗ ${warning}⚠ ${skipped}∅)`,
  );
  parts.push(`${assumptions.length} assumptions (${held} held, ${violated} violated)`);
  parts.push(`${gaps.length} gaps (${gapsHigh}H/${gapsMedium}M/${gapsLow}L)`);
  parts.push(`${residualRisks.length} residual risks`);
  const verdict = `[${status.toUpperCase()}] ${parts.join(" | ")}`;

  return {
    checksTotal: checks.length,
    checksPassed: passed,
    checksFailed: failed,
    checksWarning: warning,
    checksSkipped: skipped,
    assumptionsTotal: assumptions.length,
    assumptionsHeld: held,
    assumptionsViolated: violated,
    gapsHigh,
    gapsMedium,
    gapsLow,
    residualRiskCount: residualRisks.length,
    status,
    verdict,
  };
}

export function buildEvidenceBundle(input: EvidenceBundleInput): EvidenceBundle {
  if (!input.actionId) throw new Error("actionId is required");
  if (!input.actionType) throw new Error("actionType is required");
  if (!Number.isFinite(input.timestamp)) {
    throw new Error("timestamp must be a finite number");
  }
  if (input.rationale !== undefined && typeof input.rationale !== "string") {
    throw new Error("rationale must be a string when provided");
  }

  const checks = Object.freeze([...(input.checks ?? [])]);
  const assumptions = Object.freeze([...(input.assumptions ?? [])]);
  const gaps = Object.freeze([...(input.gaps ?? [])]);
  const residualRisks = Object.freeze([...(input.residualRisks ?? [])]);
  const summary = computeSummary(checks, assumptions, gaps, residualRisks);

  return Object.freeze({
    actionId: input.actionId,
    actionType: input.actionType,
    timestamp: input.timestamp,
    rationale: input.rationale,
    checks,
    assumptions,
    gaps,
    residualRisks,
    summary,
  });
}

/**
 * Fluent builder for incremental accumulation. Call `.build(meta)` to
 * seal the snapshot; the builder may be re-used afterwards for further
 * accumulation without mutating the returned bundle.
 */
export interface EvidenceBundleBuilder {
  addCheck(check: EvidenceCheck): EvidenceBundleBuilder;
  addAssumption(a: EvidenceAssumption): EvidenceBundleBuilder;
  addGap(g: EvidenceGap): EvidenceBundleBuilder;
  addResidualRisk(r: ResidualRisk): EvidenceBundleBuilder;
  build(meta: EvidenceBundleMeta): EvidenceBundle;
}

export function createEvidenceBundleBuilder(): EvidenceBundleBuilder {
  const checks: EvidenceCheck[] = [];
  const assumptions: EvidenceAssumption[] = [];
  const gaps: EvidenceGap[] = [];
  const residualRisks: ResidualRisk[] = [];
  const builder: EvidenceBundleBuilder = {
    addCheck(check) {
      checks.push(check);
      return builder;
    },
    addAssumption(a) {
      assumptions.push(a);
      return builder;
    },
    addGap(g) {
      gaps.push(g);
      return builder;
    },
    addResidualRisk(r) {
      residualRisks.push(r);
      return builder;
    },
    build(meta) {
      return buildEvidenceBundle({
        ...meta,
        checks: [...checks],
        assumptions: [...assumptions],
        gaps: [...gaps],
        residualRisks: [...residualRisks],
      });
    },
  };
  return builder;
}

/**
 * Flat payload form suitable for `recordStructuredObservation`. Arrays
 * are kept short by truncating `detail` and `evidence` fields when
 * caller-provided; the structural counts in `summary` are always exact.
 */
export function evidenceBundleToPayload(
  bundle: EvidenceBundle,
): Record<string, unknown> {
  return {
    kind: "evidence_bundle.recorded",
    actionId: bundle.actionId,
    actionType: bundle.actionType,
    timestamp: bundle.timestamp,
    rationale: bundle.rationale ?? null,
    status: bundle.summary.status,
    verdict: bundle.summary.verdict,
    summary: {
      checks: {
        total: bundle.summary.checksTotal,
        passed: bundle.summary.checksPassed,
        failed: bundle.summary.checksFailed,
        warning: bundle.summary.checksWarning,
        skipped: bundle.summary.checksSkipped,
      },
      assumptions: {
        total: bundle.summary.assumptionsTotal,
        held: bundle.summary.assumptionsHeld,
        violated: bundle.summary.assumptionsViolated,
      },
      gaps: {
        high: bundle.summary.gapsHigh,
        medium: bundle.summary.gapsMedium,
        low: bundle.summary.gapsLow,
      },
      residualRisks: bundle.summary.residualRiskCount,
    },
    checks: bundle.checks.map((c) => ({
      name: c.name,
      outcome: c.outcome,
      detail: c.detail,
      durationMs: c.durationMs,
    })),
    assumptions: bundle.assumptions.map((a) => ({
      name: a.name,
      held: a.held,
      basis: a.basis,
    })),
    gaps: bundle.gaps.map((g) => ({
      area: g.area,
      severity: g.severity,
      reason: g.reason,
    })),
    residualRisks: bundle.residualRisks.map((r) => ({
      description: r.description,
      category: r.category,
      mitigation: r.mitigation,
    })),
  };
}

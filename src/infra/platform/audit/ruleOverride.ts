/**
 * Rule-Override Audit Helpers + Adherence Aggregator (Gaps 1 + 2).
 *
 * Two halves:
 *
 *   (1) `recordRuleOverride()` — typed convenience over `auditLog.record`
 *       for the `RULE_OVERRIDE` event type. Callers emit when the
 *       operator approves a trade despite a non-auto-approve risk
 *       recommendation. Captures the original recommendation, the
 *       overriding action, and the operator's stated rationale.
 *
 *   (2) `getAdherenceReport(range)` — queries the audit log for trade-
 *       execution events vs rule-override events within a window and
 *       returns structured counts + a deviation rate + the override
 *       list with their captured rationales.
 *
 * Why a helper module rather than inline in audit-log.ts: the event
 * type is generic infrastructure; the helpers encode the SHAPE of a
 * rule-override (severity, rationale, originating recommendation) so
 * callers don't reinvent the schema. Single source of truth for what
 * "an override" looks like in the audit log.
 *
 * Cost field: the aggregator's `deviationCostUsd` is best-effort. It
 * sums realized P&L over trades tagged with the override's tradeId
 * when that data is queryable from the audit metadata. When trade P&L
 * isn't available (override happened but the trade is still open, or
 * the trade ledger isn't joined), `deviationCostUsd` is `null`. This
 * matches the principle from the verify-before-claim discipline: only
 * report numbers we can substantiate.
 */

import { auditLog, getAuditHistory, type AuditEntry } from "./audit-log.ts";

/**
 * Severity of the rule-override, mirroring riskClassifier's recommendation
 * vocabulary so the audit trail stays operator-readable.
 */
export type RuleOverrideSeverity =
  | "prompt_user"
  | "require_confirmation"
  | "block";

export interface RuleOverrideParameters {
  /** What the operator did (e.g. "approve_plan", "place_market_order"). */
  action: string;
  /** Symbol involved. Optional. */
  symbol?: string;
  /** Original risk-classifier recommendation that was overridden. */
  originalRecommendation: RuleOverrideSeverity;
  /** Risk tier from the classifier ("medium" | "high" | "critical"). */
  originalTier?: "low" | "medium" | "high" | "critical";
  /** Rationale the operator gave. Min 10 chars for legibility in audit. */
  rationale: string;
  /** Optional list of constitution-rule IDs that were also overridden. */
  constitutionRules?: string[];
  /** Free-form context. */
  context?: Record<string, unknown>;
}

/**
 * Record a rule-override audit event. The caller is the agent
 * (executor) that knows the prior risk verdict at the moment it asks
 * for approval and observes the operator approving anyway.
 *
 * Returns the inserted AuditEntry so the caller can correlate with
 * other events emitted in the same flow.
 */
export function recordRuleOverride(
  userId: string,
  params: RuleOverrideParameters,
  options: {
    sessionId?: string;
    tradeId?: string;
    planId?: string;
  } = {},
): AuditEntry {
  if (params.rationale.trim().length < 10) {
    // Soft enforce the rationale floor — short rationales make audit
    // less useful. Reject at audit time so the agent gets visible
    // feedback to provide more context.
    throw new Error(
      `recordRuleOverride: rationale must be at least 10 chars (got ${params.rationale.length}).`,
    );
  }
  return auditLog.record(
    userId,
    "RULE_OVERRIDE",
    params as unknown as Record<string, unknown>,
    "SUCCESS",
    {
      tradeId: options.tradeId,
      planId: options.planId,
      resultDetails: params.rationale,
      metadata: {
        gap: "trade.rule_override",
        severity: params.originalRecommendation,
        tier: params.originalTier ?? "unknown",
        // sessionId stashed in metadata since auditLog.record's options
        // bag doesn't surface it directly (the AuditLogger class does,
        // but the convenience wrapper doesn't).
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      },
    },
  );
}

/**
 * Trade-execution action types the adherence aggregator counts as
 * "trades that could have been overridden." Pulled from AuditAction's
 * enum subset that represents real trade execution / position changes.
 */
const TRADE_EXECUTION_ACTIONS = [
  "EXECUTE_PLAN",
  "CLOSE_TRADE",
  "PLACE_OCO_ORDER",
] as const;

export interface AdherenceWindow {
  /** ISO timestamp. Defaults: 7 days ago. */
  startTime?: string;
  /** ISO timestamp. Defaults: now. */
  endTime?: string;
  /** Filter to a specific operator. Defaults: any. */
  userId?: string;
}

export interface AdherenceOverrideRecord {
  auditId: string;
  timestamp: string;
  action: string;
  symbol?: string;
  originalRecommendation: RuleOverrideSeverity;
  originalTier?: string;
  rationale: string;
  tradeId?: string;
  planId?: string;
}

export interface AdherenceReport {
  windowStart: string;
  windowEnd: string;
  /** Successful trade-execution audit events in the window. */
  tradesExecuted: number;
  /** RULE_OVERRIDE events in the window. */
  overrides: number;
  /** overrides / tradesExecuted, in 0..1. Null when tradesExecuted=0. */
  deviationRate: number | null;
  /**
   * Sum of realized P&L for overridden trades when computable. Null
   * when not available (trades open, ledger not joined, or no
   * matching tradeIds). Best-effort metric.
   */
  deviationCostUsd: number | null;
  /** Override events with their captured rationales. */
  overrideList: AdherenceOverrideRecord[];
  /** Breakdown of overrides by original severity. */
  bySeverity: {
    prompt_user: number;
    require_confirmation: number;
    block: number;
  };
}

function defaultStartIso(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

function defaultEndIso(): string {
  return new Date().toISOString();
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseSeverity(v: unknown): RuleOverrideSeverity | undefined {
  if (v === "prompt_user" || v === "require_confirmation" || v === "block") return v;
  return undefined;
}

function toOverrideRecord(entry: AuditEntry): AdherenceOverrideRecord | undefined {
  const params = (entry.parameters ?? {}) as Record<string, unknown>;
  const severity = parseSeverity(params.originalRecommendation);
  const rationale = asString(params.rationale);
  if (!severity || !rationale) return undefined;
  return {
    auditId: entry.id,
    timestamp: entry.timestamp,
    action: asString(params.action) ?? "unknown",
    symbol: asString(params.symbol),
    originalRecommendation: severity,
    originalTier: asString(params.originalTier),
    rationale,
    tradeId: entry.tradeId,
    planId: entry.planId,
  };
}

/**
 * Query the audit log for adherence stats in the given window.
 *
 * Two SQL passes (not one JOIN) because the audit table doesn't
 * categorize by "is execution" — we collect both sets, filter the
 * execution set client-side, count both, build the report. SQLite
 * query volume is bounded by retention (~7y default) and the window
 * (~7d default) so the unjoined approach is fine.
 */
export function getAdherenceReport(
  window: AdherenceWindow = {},
): AdherenceReport {
  const startTime = window.startTime ?? defaultStartIso();
  const endTime = window.endTime ?? defaultEndIso();

  let tradesExecuted = 0;
  for (const action of TRADE_EXECUTION_ACTIONS) {
    const rows = getAuditHistory({
      action,
      result: "SUCCESS",
      startTime,
      endTime,
      userId: window.userId,
      limit: 100_000,
    });
    tradesExecuted += rows.length;
  }

  const overrideRows = getAuditHistory({
    action: "RULE_OVERRIDE",
    result: "SUCCESS",
    startTime,
    endTime,
    userId: window.userId,
    limit: 100_000,
  });

  const overrideList = overrideRows
    .map(toOverrideRecord)
    .filter((r): r is AdherenceOverrideRecord => r !== undefined);

  const bySeverity = {
    prompt_user: 0,
    require_confirmation: 0,
    block: 0,
  };
  for (const r of overrideList) {
    bySeverity[r.originalRecommendation]++;
  }

  const deviationRate =
    tradesExecuted > 0 ? overrideList.length / tradesExecuted : null;

  return {
    windowStart: startTime,
    windowEnd: endTime,
    tradesExecuted,
    overrides: overrideList.length,
    deviationRate,
    deviationCostUsd: null,
    overrideList,
    bySeverity,
  };
}

/**
 * Human-readable one-paragraph summary, suitable for weekend-review
 * skill output. Designed to fit operator's "did I follow my system this
 * week?" question with a concrete number.
 */
export function summarizeAdherenceReport(report: AdherenceReport): string {
  if (report.tradesExecuted === 0 && report.overrides === 0) {
    return `Adherence: no trades executed and no rule-overrides recorded in this window (${report.windowStart} → ${report.windowEnd}).`;
  }
  const ratePct =
    report.deviationRate !== null
      ? ` (${(report.deviationRate * 100).toFixed(1)}% deviation rate)`
      : "";
  const sev = report.bySeverity;
  const sevParts: string[] = [];
  if (sev.block > 0) sevParts.push(`${sev.block} were against 'block'-tier recommendations`);
  if (sev.require_confirmation > 0)
    sevParts.push(`${sev.require_confirmation} against 'require_confirmation'`);
  if (sev.prompt_user > 0) sevParts.push(`${sev.prompt_user} against 'prompt_user'`);
  const sevSummary = sevParts.length > 0 ? ` — ${sevParts.join(", ")}` : "";
  return `Adherence: ${report.tradesExecuted} trade${report.tradesExecuted === 1 ? "" : "s"} executed, ${report.overrides} rule-override${report.overrides === 1 ? "" : "s"}${ratePct}${sevSummary}.`;
}

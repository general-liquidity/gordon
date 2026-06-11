/**
 * Approval risk details — threads risk-kernel verdicts into the TUI
 * approval dialog so the operator sees WHY an order needs approval
 * (e.g. "leverage 4.2x exceeds 2x limit") instead of just a risk class,
 * and gets the kernel's size-adjusted counter-offer as an explicit option.
 *
 * Display-only enrichment: it never decides approvals. If the audit log
 * is unreachable the dialog simply renders without reasons — no gate is
 * weakened or bypassed.
 */

import type { RiskAuditEntry, RiskCheck } from "../../core/risk-kernel/audit.ts";
import type { ApprovalCounterOffer, ApprovalRiskDetails } from "../components/dialogs/ApprovalDialog.tsx";

export const MAX_RISK_REASONS = 3;
export const MAX_REASON_CHARS = 120;
/**
 * Only pair an approval with a kernel decision evaluated near the request.
 * Approvals carry no order args, so recency is the correlation key — the
 * risk-gate pre-check runs in the same turn that queues the approval.
 */
export const RISK_DETAIL_FRESHNESS_MS = 10 * 60_000;

const SEVERITY_RANK: Record<RiskCheck["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Order-execution tools are the only ones the risk kernel evaluates.
 *  Cancels are excluded — the kernel scores new exposure, not unwinds. */
export function isOrderExecutionTool(toolName: string): boolean {
  if (/cancel/i.test(toolName)) return false;
  return /(order|trade)/i.test(toolName) || /^execute(_|$)/i.test(toolName);
}

function truncateReason(details: string): string {
  if (details.length <= MAX_REASON_CHARS) return details;
  return `${details.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…`;
}

/**
 * Derive dialog-facing risk details from recent audit entries (most recent
 * first, as returned by `RiskAuditLog.getHistory`). Returns undefined when
 * there is nothing actionable to show.
 */
export function buildApprovalRiskDetails(
  entries: RiskAuditEntry[],
  approval: { toolName: string; requestedAt: string },
): ApprovalRiskDetails | undefined {
  if (!isOrderExecutionTool(approval.toolName)) return undefined;

  const requestedMs = new Date(approval.requestedAt).getTime();
  if (!Number.isFinite(requestedMs)) return undefined;

  const entry = entries.find((e) => {
    const t = new Date(e.timestamp).getTime();
    return Number.isFinite(t) && Math.abs(t - requestedMs) <= RISK_DETAIL_FRESHNESS_MS;
  });
  if (!entry) return undefined;

  const failed = entry.decision.checks
    .filter((check) => !check.passed)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const riskReasons = failed.slice(0, MAX_RISK_REASONS).map((check) => truncateReason(check.details));

  const counterOffer: ApprovalCounterOffer | undefined =
    entry.decision.action === "modify" && entry.decision.modifiedOrder
      ? {
          symbol: entry.decision.originalOrder.symbol,
          side: entry.decision.originalOrder.side,
          originalQuantity: entry.decision.originalOrder.quantity,
          adjustedQuantity: entry.decision.modifiedOrder.quantity,
        }
      : undefined;

  if (riskReasons.length === 0 && !counterOffer) return undefined;
  return { riskReasons, counterOffer };
}

/**
 * Fetch + build risk details for a pending approval. Fails soft: any error
 * (DB unavailable, no audit table yet) yields undefined and the dialog
 * renders without enrichment.
 */
export async function fetchApprovalRiskDetails(
  approval: { toolName: string; requestedAt: string },
): Promise<ApprovalRiskDetails | undefined> {
  if (!isOrderExecutionTool(approval.toolName)) return undefined;
  try {
    // Lazy import: keeps the SQLite/audit dependency out of module load
    // (and out of pure-function tests).
    const { riskAuditLog } = await import("../../core/risk-kernel/audit.ts");
    const entries = await riskAuditLog.getHistory({ limit: 20 });
    return buildApprovalRiskDetails(entries, approval);
  } catch {
    return undefined;
  }
}

/**
 * Denial reason for the "approve the reduced size" decision. Accepting the
 * counter-offer must NOT execute the original order — fail closed by denying
 * it with a structured instruction so the agent resubmits at the
 * kernel-adjusted size (which then re-passes the full risk gate).
 */
export function buildCounterOfferDenialReason(counterOffer?: ApprovalCounterOffer): string {
  if (!counterOffer) {
    return "Counter-offer accepted by user: resubmit at the risk-kernel-adjusted size. Do not retry the original size.";
  }
  return (
    `Counter-offer accepted by user: resubmit ${counterOffer.symbol} ${counterOffer.side} ` +
    `at quantity ${counterOffer.adjustedQuantity} (reduced from ${counterOffer.originalQuantity} ` +
    `to fit risk limits). Do not retry the original size.`
  );
}

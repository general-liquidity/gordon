/**
 * Adherence Tools — Gaps 1 + 2 surfaced to the agent layer.
 *
 *   - `record_rule_override` — agent emits when the operator approves a
 *      trade despite a non-auto-approve recommendation. Captures the
 *      override with a rationale (≥10 chars enforced).
 *
 *   - `get_adherence_report` — agent queries during weekend-review to
 *      get structured counts (trades executed vs rule-overrides) +
 *      severity breakdown + override list with rationales.
 *
 * Why these are agent-driven rather than orchestrator-injected: the
 * agent invoking `approve_plan` / `place_*_order` knows the prior
 * risk verdict at that exact moment (it just called `classify_trade_risk`).
 * The audit table doesn't carry forward "what the prior recommendation
 * was" through unrelated rows. Putting the emit at the agent layer
 * gives the audit the right context (rationale, severity, tier) at the
 * cost of relying on the agent's instructions to do it. Acceptable
 * trade-off — the alternative is invasive schema migration on Plan.
 *
 * Instructions for the executor agent (and any future trader agents):
 * "Whenever you proceed with a place_*_order or approve_plan call AFTER
 * classify_trade_risk returned recommendation !== 'auto_approve' AND
 * the operator approved anyway, call record_rule_override with the
 * original recommendation, tier, and the operator's reasoning."
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  getAdherenceReport,
  recordRuleOverride,
  summarizeAdherenceReport,
} from "../../../platform/audit/index.ts";

// ============================================================================
// record_rule_override
// ============================================================================

export const recordRuleOverrideTool = createTool({
  id: "record_rule_override",
  description: [
    "Record an audit event for a per-trade rule-override. Call this whenever",
    "the operator proceeds with a trade after classify_trade_risk returned",
    "recommendation !== 'auto_approve' (i.e. 'prompt_user', 'require_confirmation',",
    "or 'block'). Captures the original recommendation, the tier, the action",
    "the operator approved, and the rationale they gave for proceeding.",
    "",
    "The rationale field is REQUIRED and must be at least 10 characters —",
    "this is what makes the weekend adherence report useful. Short rationales",
    "are rejected by the audit layer.",
    "",
    "Do NOT call this when classify_trade_risk returned 'auto_approve' — that",
    "is normal-path execution, not an override.",
  ].join("\n"),
  inputSchema: z.object({
    action: z
      .string()
      .min(1)
      .describe("What the operator approved (e.g. 'approve_plan', 'place_market_order')."),
    originalRecommendation: z
      .enum(["prompt_user", "require_confirmation", "block"])
      .describe("Recommendation the operator overrode. Must be a non-auto-approve verdict."),
    originalTier: z
      .enum(["low", "medium", "high", "critical"])
      .optional()
      .describe("Risk tier from the classifier when known."),
    rationale: z
      .string()
      .min(10)
      .describe("Operator's stated reason for proceeding. Min 10 chars."),
    symbol: z.string().optional().describe("Trading symbol involved."),
    tradeId: z.string().optional(),
    planId: z.string().optional(),
    constitutionRules: z
      .array(z.string())
      .optional()
      .describe("IDs of any trading-constitution rules also overridden."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    auditId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({
    action,
    originalRecommendation,
    originalTier,
    rationale,
    symbol,
    tradeId,
    planId,
    constitutionRules,
  }: {
    action: string;
    originalRecommendation: "prompt_user" | "require_confirmation" | "block";
    originalTier?: "low" | "medium" | "high" | "critical";
    rationale: string;
    symbol?: string;
    tradeId?: string;
    planId?: string;
    constitutionRules?: string[];
  }) => {
    try {
      const entry = recordRuleOverride(
        "operator",
        {
          action,
          originalRecommendation,
          originalTier,
          rationale,
          symbol,
          constitutionRules,
        },
        {
          tradeId,
          planId,
        },
      );
      return { success: true, auditId: entry.id };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// get_adherence_report
// ============================================================================

export const getAdherenceReportTool = createTool({
  id: "get_adherence_report",
  description: [
    "Query the adherence aggregator for a structured report on how the",
    "operator's trading followed (or deviated from) the system in a given",
    "time window. Returns trade count, rule-override count, deviation rate,",
    "severity breakdown, and the list of overrides with their rationales.",
    "",
    "Use during /weekend-review to convert the rhetorical 'did I follow my",
    "rules this week?' question into a concrete number. Default window is",
    "the last 7 days.",
  ].join("\n"),
  inputSchema: z.object({
    startTime: z.string().optional().describe("ISO timestamp. Default: 7 days ago."),
    endTime: z.string().optional().describe("ISO timestamp. Default: now."),
    userId: z.string().optional().describe("Filter to a specific operator. Default: all."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    tradesExecuted: z.number(),
    overrides: z.number(),
    deviationRate: z.number().nullable(),
    bySeverity: z.object({
      prompt_user: z.number(),
      require_confirmation: z.number(),
      block: z.number(),
    }),
    overrideList: z.array(
      z.object({
        auditId: z.string(),
        timestamp: z.string(),
        action: z.string(),
        symbol: z.string().optional(),
        originalRecommendation: z.enum(["prompt_user", "require_confirmation", "block"]),
        originalTier: z.string().optional(),
        rationale: z.string(),
        tradeId: z.string().optional(),
        planId: z.string().optional(),
      }),
    ),
  }),
  execute: async ({
    startTime,
    endTime,
    userId,
  }: {
    startTime?: string;
    endTime?: string;
    userId?: string;
  }) => {
    const report = getAdherenceReport({ startTime, endTime, userId });
    return {
      summary: summarizeAdherenceReport(report),
      windowStart: report.windowStart,
      windowEnd: report.windowEnd,
      tradesExecuted: report.tradesExecuted,
      overrides: report.overrides,
      deviationRate: report.deviationRate,
      bySeverity: report.bySeverity,
      overrideList: report.overrideList,
    };
  },
});

// ============================================================================
// Export
// ============================================================================

export const adherenceTools = {
  record_rule_override: recordRuleOverrideTool,
  get_adherence_report: getAdherenceReportTool,
};

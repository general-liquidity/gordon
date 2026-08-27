/**
 * Confidence Calibration Tools
 *
 * Agent-facing tools for CloddsBot-style trade ledger + confidence calibration.
 * The agent records its decisions at decision time with a stated confidence,
 * then records outcomes later when the result is known. Over time the stats
 * tool answers "when Gordon says it's 80% confident, how often is it
 * actually right?" — the classic calibration curve.
 *
 * Tools:
 *   - record_confident_decision : write to journal at decision time
 *   - record_decision_outcome    : pair an outcome to a prior decision
 *   - get_calibration_stats      : read the journal and compute precision
 *                                  by confidence bucket + by domain
 *   - list_recent_decisions      : inspect what's been recorded lately
 *
 * Journal lives at ~/.gordon/calibration.jsonl (append-only, JSONL).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  recordDecision,
  recordOutcome,
  computeCalibrationStats,
  readCalibrationRecords,
  generateDecisionId,
} from "../../../../calibration/confidenceStore.ts";

const DOMAIN_SCHEMA = z.enum([
  "proactive_suggestion",
  "strategy_pick",
  "entry_call",
  "exit_call",
  "verdict_screen",
  "risk_assessment",
  "regime_classification",
  "custom",
]);

// ============================================================================
// 1. record_confident_decision
// ============================================================================

export const recordConfidentDecisionTool = createTool({
  id: "record_confident_decision",
  description:
    "Record a decision you're about to make along with your stated confidence " +
    "(0..1). Use this BEFORE you know the outcome — the whole point of " +
    "calibration is comparing what you said confidence-wise to what actually " +
    "happened. Returns the decisionId to use when recording the outcome later. " +
    "If you pass an existing id (e.g. proactive suggestion id, trade id) it'll " +
    "be reused; otherwise one is generated.",
  inputSchema: z.object({
    decisionId: z.string().optional().describe("Optional existing id; generated if omitted."),
    domain: DOMAIN_SCHEMA,
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe("Stated confidence 0..1 — be honest, don't round up."),
    decision: z.string().min(1).describe("One-sentence description of what you decided"),
    reasoning: z.string().optional().describe("Why you decided this — captured for audit"),
    tags: z
      .record(z.string(), z.string())
      .optional()
      .describe("Context tags (symbol, category, timeframe)"),
  }),
  outputSchema: z.object({
    recorded: z.boolean(),
    decisionId: z.string(),
    createdAt: z.string(),
  }),
  execute: async ({ decisionId, domain, confidence, decision, reasoning, tags }) => {
    const id = decisionId ?? generateDecisionId(domain);
    const record = recordDecision({
      decisionId: id,
      domain,
      confidence,
      decision,
      reasoning,
      tags,
    });
    return { recorded: true, decisionId: record.decisionId, createdAt: record.createdAt };
  },
});

// ============================================================================
// 2. record_decision_outcome
// ============================================================================

export const recordDecisionOutcomeTool = createTool({
  id: "record_decision_outcome",
  description:
    "Record the outcome of a prior decision. Pair this with an earlier " +
    "record_confident_decision by passing the same decisionId. Result " +
    "values: 'correct' = your call was right, 'wrong' = your call was " +
    "wrong, 'partial' = half-right (partial fill, wrong timing on a right " +
    "direction, etc.), 'unknown' = insufficient info to grade. Optional " +
    "pnl captures the dollar impact for trade-adjacent decisions.",
  inputSchema: z.object({
    decisionId: z.string(),
    result: z.enum(["correct", "wrong", "partial", "unknown"]),
    notes: z.string().optional(),
    pnl: z.number().optional(),
  }),
  outputSchema: z.object({
    recorded: z.boolean(),
    decisionId: z.string(),
    recordedAt: z.string(),
  }),
  execute: async ({ decisionId, result, notes, pnl }) => {
    const o = recordOutcome({ decisionId, result, notes, pnl });
    return { recorded: true, decisionId: o.decisionId, recordedAt: o.recordedAt };
  },
});

// ============================================================================
// 3. get_calibration_stats
// ============================================================================

export const getCalibrationStatsTool = createTool({
  id: "get_calibration_stats",
  description:
    "Compute calibration statistics across recorded decisions. Returns " +
    "precision at each confidence bucket (0-10, 10-20, ..., 90-100) plus " +
    "per-domain breakdowns. The calibrationError number is the mean " +
    "absolute difference between stated confidence and actual accuracy — " +
    "smaller is better. Use to answer 'am I overconfident on stop calls?' " +
    "or 'is my regime classifier reliable above 70% confidence?'.",
  inputSchema: z.object({
    domain: DOMAIN_SCHEMA.optional().describe("Filter to a specific decision domain"),
    daysBack: z
      .number()
      .int()
      .min(1)
      .max(730)
      .optional()
      .describe("Only consider decisions from the last N days"),
  }),
  outputSchema: z.object({
    totalDecisions: z.number(),
    totalWithOutcomes: z.number(),
    overallAccuracy: z.number(),
    calibrationError: z.number(),
    bucketStats: z.record(
      z.string(),
      z.object({
        count: z.number(),
        correct: z.number(),
        accuracy: z.number(),
      }),
    ),
    byDomain: z.record(
      z.string(),
      z.object({
        count: z.number(),
        correct: z.number(),
        accuracy: z.number(),
        avgConfidence: z.number(),
      }),
    ),
  }),
  execute: async ({ domain, daysBack }) => {
    const sinceMs = daysBack ? daysBack * 86_400_000 : undefined;
    const stats = computeCalibrationStats(undefined, { domain, sinceMs });
    return {
      totalDecisions: stats.totalDecisions,
      totalWithOutcomes: stats.totalWithOutcomes,
      overallAccuracy: stats.overallAccuracy,
      calibrationError: stats.calibrationError,
      bucketStats: stats.bucketStats as Record<
        string,
        { count: number; correct: number; accuracy: number }
      >,
      byDomain: stats.byDomain,
    };
  },
});

// ============================================================================
// 4. list_recent_decisions
// ============================================================================

export const listRecentDecisionsTool = createTool({
  id: "list_recent_decisions",
  description:
    "List recent calibration decisions with their paired outcomes. Use for " +
    "reviewing what you've recorded, spotting unresolved decisions that need " +
    "outcome recording, or auditing the decision trail.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).optional().default(20),
    domain: DOMAIN_SCHEMA.optional(),
    onlyPending: z
      .boolean()
      .optional()
      .describe("If true, only return decisions without an outcome recorded"),
  }),
  outputSchema: z.object({
    total: z.number(),
    decisions: z.array(
      z.object({
        decisionId: z.string(),
        domain: z.string(),
        confidence: z.number(),
        decision: z.string(),
        reasoning: z.string().optional(),
        createdAt: z.string(),
        outcomeResult: z.string().optional(),
        outcomeNotes: z.string().optional(),
      }),
    ),
  }),
  execute: async ({ limit, domain, onlyPending }) => {
    let records = readCalibrationRecords();
    if (domain) records = records.filter((r) => r.domain === domain);
    if (onlyPending) records = records.filter((r) => !r.outcome);
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    records = records.slice(0, limit ?? 20);
    return {
      total: records.length,
      decisions: records.map((r) => ({
        decisionId: r.decisionId,
        domain: r.domain,
        confidence: r.confidence,
        decision: r.decision,
        reasoning: r.reasoning,
        createdAt: r.createdAt,
        outcomeResult: r.outcome?.result,
        outcomeNotes: r.outcome?.notes,
      })),
    };
  },
});

// ============================================================================
// Export
// ============================================================================

export const calibrationTools = {
  record_confident_decision: recordConfidentDecisionTool,
  record_decision_outcome: recordDecisionOutcomeTool,
  get_calibration_stats: getCalibrationStatsTool,
  list_recent_decisions: listRecentDecisionsTool,
};

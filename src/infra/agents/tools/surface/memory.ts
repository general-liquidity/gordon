/**
 * V4 Memory + Audit Tools — 3 explicit typed tools.
 *
 *   - memory_search  → query persistent memory (FTS + semantic)
 *   - memory_write   → append observation / lesson / preference / watchlist / note
 *   - audit_event    → signed append-only provenance event
 *
 * Wired through existing memory-tools handlers + auditLog facade.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { auditLog } from "../../../platform/audit/index.ts";
import type { AuditAction } from "../../../platform/audit/index.ts";
import {
  searchMemoryTool as legacySearchMemory,
  recordObservationTool as legacyRecordObservation,
  recordInsightTool as legacyRecordInsight,
} from "../runtime/meta/memory-tools.ts";
import type { MastraExecutionContext } from "../types.ts";

// ============================================================================
// memory_search
// ============================================================================

export const memorySearchTool = createTool({
  id: "memory_search",
  description: [
    "Search Gordon's durable memory for relevant records. Memory holds the",
    "operator's trader profile (risk preferences, account context), past",
    "lessons learned, recurring strategy notes, and watchlist annotations.",
    "",
    "Use BEFORE making decisions to check if there's prior context on the",
    "symbol / pattern / regime. Returns up to `limit` records sorted by",
    "relevance.",
  ].join("\n"),
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query — symbol, concept, lesson keyword."),
    scope: z
      .enum(["all", "lessons", "profile", "watchlist", "strategy"])
      .optional()
      .describe("Restrict search to a memory scope. Default 'all'."),
    limit: z.number().int().positive().max(20).optional().describe("Max records. Default 10."),
  }),
  outputSchema: z.object({
    query: z.string(),
    records: z.array(z.unknown()),
    totalFound: z.number(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { query: string; scope?: string; limit?: number },
    execContext?: MastraExecutionContext,
  ) => {
    const result = (await (legacySearchMemory.execute as any)(
      { query: args.query, limit: args.limit ?? 10 },
      execContext,
    )) as { results: unknown[]; count: number; error?: string };
    return {
      query: args.query,
      records: result.results ?? [],
      totalFound: result.count ?? 0,
      error: result.error,
    };
  },
});

// ============================================================================
// memory_write
// ============================================================================

export const memoryWriteTool = createTool({
  id: "memory_write",
  description: [
    "Write a durable memory record. Use for lessons learned, recurring",
    "patterns, operator preferences that should survive across sessions.",
    "",
    "kind values:",
    "  - 'lesson'      → learning extracted from a trade outcome (insight)",
    "  - 'observation' → market state worth remembering",
    "  - 'preference' → operator preference (risk level, venue, asset class)",
    "  - 'watchlist'   → symbol to track + reason",
    "  - 'note'        → free-form annotation",
    "",
    "Do NOT use for short-lived session state — that's the conversation",
    "thread's job. Memory is for cross-session-durable facts.",
  ].join("\n"),
  inputSchema: z.object({
    kind: z.enum(["lesson", "observation", "preference", "watchlist", "note"]),
    content: z.string().min(1).describe("The content to record."),
    symbol: z.string().optional().describe("Associated symbol, if any."),
    tags: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    recordId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { kind: string; content: string; symbol?: string; tags?: string[] },
    execContext?: MastraExecutionContext,
  ) => {
    // Lessons + preferences route to the insight channel (long-term);
    // observations / watchlist / notes go to the observation channel.
    const useInsight = args.kind === "lesson" || args.kind === "preference";
    try {
      if (useInsight) {
        const result = (await (legacyRecordInsight.execute as any)(
          {
            content: args.content,
            confidence: 0.8,
            symbol: args.symbol,
            tags: args.tags,
          },
          execContext,
        )) as { success?: boolean; id?: string; error?: string };
        return {
          success: Boolean(result.success ?? !result.error),
          recordId: result.id,
          error: result.error,
        };
      }
      const result = (await (legacyRecordObservation.execute as any)(
        {
          symbol: args.symbol ?? "GENERAL",
          observation: args.content,
          conditions: args.tags?.join(", ") ?? "",
        },
        execContext,
      )) as { success?: boolean; id?: string; error?: string };
      return {
        success: Boolean(result.success ?? !result.error),
        recordId: result.id,
        error: result.error,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// audit_event
// ============================================================================

export const auditEventTool = createTool({
  id: "audit_event",
  description: [
    "Append a structured event to Gordon's signed audit log. Use for",
    "provenance — recording why a decision was made, what context was",
    "considered, what rules were checked. Every meaningful agent decision",
    "should produce an audit event.",
    "",
    "The audit log is append-only, HMAC-signed, tamper-detectable. Events",
    "are queryable later via the discipline audit + adherence reporting.",
    "",
    "Common action values:",
    "  - 'CREATE_PLAN' / 'EXECUTE_PLAN' / 'CLOSE_TRADE'",
    "  - 'OBSERVATION'   → market state worth auditing",
    "  - 'BACKTEST_VALIDATED' / 'REGIME_RESPONSE'",
    "  - 'STRATEGY_DRAFTED' / 'RULE_OVERRIDE'",
    "",
    "For rule overrides specifically, use record_rule_override tool which",
    "enforces rationale-min-length + structured override metadata.",
  ].join("\n"),
  inputSchema: z.object({
    action: z.string().min(1).describe("AuditAction — e.g. 'CREATE_PLAN', 'OBSERVATION'."),
    summary: z.string().min(1).describe("One-line operator-readable summary."),
    parameters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Structured event payload."),
    tradeId: z.string().optional(),
    planId: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    auditId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: {
      action: string;
      summary: string;
      parameters?: Record<string, unknown>;
      tradeId?: string;
      planId?: string;
    },
    _execContext?: MastraExecutionContext,
  ) => {
    try {
      const entry = auditLog.record(
        "operator",
        args.action as AuditAction,
        args.parameters ?? {},
        "SUCCESS",
        {
          resultDetails: args.summary,
          tradeId: args.tradeId,
          planId: args.planId,
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

export const memoryTools = {
  memory_search: memorySearchTool,
  memory_write: memoryWriteTool,
  audit_event: auditEventTool,
};

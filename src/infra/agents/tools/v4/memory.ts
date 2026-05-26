/**
 * V4 Memory + Audit Tools — 3 explicit typed tools.
 *
 *   - memory_search  → query persistent memory (FTS-style)
 *   - memory_write   → append durable trader-profile / lesson record
 *   - audit_event    → signed append-only provenance event
 *
 * Memory reads collapse INTO get_market_data... no, that's wrong.
 * Memory is its own namespace (operator profile, lessons, watchlists,
 * strategy library), not market state. Kept distinct from `query` patterns.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { auditLog } from "../../../platform/audit/index.ts";
import type { AuditAction } from "../../../platform/audit/index.ts";
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
    limit: z.number().int().positive().optional().describe("Max records. Default 10."),
  }),
  outputSchema: z.object({
    query: z.string(),
    records: z.array(z.unknown()),
    totalFound: z.number(),
  }),
  execute: async (
    args: { query: string; scope?: string; limit?: number },
    _execContext?: MastraExecutionContext,
  ) => {
    // Stub — proper implementation calls into memoryTools.search_memory
    // handler. Returns empty results until wired.
    return {
      query: args.query,
      records: [],
      totalFound: 0,
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
    "  - 'lesson'      → learning extracted from a trade outcome",
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
    _execContext?: MastraExecutionContext,
  ) => {
    // Stub — proper implementation calls into memoryTools.record_observation
    // / record_insight handlers. Returns success placeholder until wired.
    return {
      success: true,
      recordId: `mem-${Date.now().toString(36)}`,
    };
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
    "Common eventType values:",
    "  - 'decision.plan_created' → recorded plan creation rationale",
    "  - 'decision.regime_pivot' → regime shift response",
    "  - 'decision.size_adjustment' → position sizing override + reason",
    "  - 'observation.<topic>'   → market state worth auditing",
    "  - 'reflection.<topic>'    → post-trade reflection",
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

export const v4MemoryTools = {
  memory_search: memorySearchTool,
  memory_write: memoryWriteTool,
  audit_event: auditEventTool,
};

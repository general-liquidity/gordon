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
  recordObservationTool as implRecordObservation,
  recordInsightTool as implRecordInsight,
} from "../runtime/meta/memory-tools.ts";
import type { MastraExecutionContext } from "../types.ts";
import { getMemoryManager } from "../../../../core/memory/index.ts";
import {
  filterByAsOf,
  isThinEvidence,
  classifyEvidenceQuality,
  mergeAndDedupe,
  type EvidenceQuality,
} from "./retrieval-helpers.ts";

// ============================================================================
// memory_search
// ============================================================================

function formatAgeFromIso(iso: string | undefined | null): string {
  if (!iso) return "unknown";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "unknown";
  const minutes = (Date.now() - ts) / 60_000;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (60 * 24))}d`;
}

interface FlattenedRecord {
  content: string;
  type: string;
  score: number;
  age: string;
  createdAt: string | undefined;
  symbols: string[] | undefined;
  id: string | undefined;
}

function flatten(results: Array<{ entry: { id?: string; content: string; type: string; createdAt?: string; symbols?: string[] }; score: number }>): FlattenedRecord[] {
  return results.map((r) => ({
    id: r.entry.id,
    content: r.entry.content,
    type: r.entry.type,
    score: Math.round(r.score * 100) / 100,
    age: formatAgeFromIso(r.entry.createdAt),
    createdAt: r.entry.createdAt,
    symbols: r.entry.symbols,
  }));
}

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
    "",
    "Two patterns from the Quarq Agent comparison (OSS, Apache 2.0) are",
    "supported:",
    "",
    "  - `asOf`: ISO timestamp. Constrain results to memories created at",
    "    or before this time. Use for 'what did we know about X at time Y?'",
    "    questions and post-trade replay accuracy. Leave unset for the",
    "    default 'all current memory' behavior.",
    "",
    "  - `mode`: 'standard' (one pass, default limit), 'deep' (one pass,",
    "    larger limit for aggregation / timeline queries), or 'auto'",
    "    (default — run standard first; if evidence is thin, automatically",
    "    expand with a deep second pass and merge results). The output's",
    "    `evidenceQuality` field reports whether retrieval was rich /",
    "    thin / expanded.",
  ].join("\n"),
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query — symbol, concept, lesson keyword."),
    scope: z
      .enum(["all", "lessons", "profile", "watchlist", "strategy"])
      .optional()
      .describe("Restrict search to a memory scope. Default 'all'."),
    limit: z.number().int().positive().max(20).optional().describe("Max records. Default 10."),
    asOf: z
      .string()
      .optional()
      .describe(
        "ISO timestamp (e.g. '2026-05-20T14:00:00Z'). Drops records created AFTER this time. Use for replay / 'what did we know when' questions.",
      ),
    mode: z
      .enum(["standard", "deep", "auto"])
      .optional()
      .describe(
        "Retrieval mode. 'standard'=single pass. 'deep'=larger single pass for aggregation. 'auto' (default)=try standard first, fall back to deep if results are thin.",
      ),
  }),
  outputSchema: z.object({
    query: z.string(),
    records: z.array(z.unknown()),
    totalFound: z.number(),
    evidenceQuality: z.enum(["rich", "thin", "expanded"]),
    asOfApplied: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { query: string; scope?: string; limit?: number; asOf?: string; mode?: "standard" | "deep" | "auto" },
    _execContext?: MastraExecutionContext,
  ) => {
    const baseLimit = args.limit ?? 10;
    const deepLimit = Math.min(20, baseLimit * 2);
    const mode = args.mode ?? "auto";

    try {
      const manager = await getMemoryManager();

      // First pass — standard limit unless caller asked for deep upfront.
      const firstLimit = mode === "deep" ? deepLimit : baseLimit;
      const firstRaw = await manager.journal.search(args.query, { limit: firstLimit });
      const firstFiltered = filterByAsOf(flatten(firstRaw), args.asOf, (r) => r.createdAt);

      let merged: FlattenedRecord[] = firstFiltered;
      let expanded = false;

      // Auto mode: if first pass evidence is thin, run a deep second pass
      // and merge + dedupe. Bypasses second pass when caller already asked
      // for "deep" (one pass is the contract) or "standard" (no fallback).
      if (mode === "auto" && isThinEvidence(firstFiltered)) {
        const secondRaw = await manager.journal.search(args.query, { limit: deepLimit });
        const secondFiltered = filterByAsOf(flatten(secondRaw), args.asOf, (r) => r.createdAt);
        merged = mergeAndDedupe(firstFiltered as unknown as Array<Record<string, unknown>>, secondFiltered as unknown as Array<Record<string, unknown>>) as unknown as FlattenedRecord[];
        expanded = merged.length > firstFiltered.length;
      }

      const evidenceQuality: EvidenceQuality = classifyEvidenceQuality(
        firstFiltered.length,
        merged.length,
        expanded,
      );

      return {
        query: args.query,
        records: merged,
        totalFound: merged.length,
        evidenceQuality,
        asOfApplied: Boolean(args.asOf),
      };
    } catch (err) {
      return {
        query: args.query,
        records: [],
        totalFound: 0,
        evidenceQuality: "thin" as const,
        asOfApplied: Boolean(args.asOf),
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
        const result = (await (implRecordInsight.execute as any)(
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
      const result = (await (implRecordObservation.execute as any)(
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

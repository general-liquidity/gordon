/**
 * Audit Chain Manager (Singleton)
 *
 * High-level facade for the agent audit system.
 * Provides trace creation, querying, human-readable formatting,
 * and summary statistics.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { createTraceBuilder } from "./builder.ts";
import {
  saveTrace,
  getTrace,
  getTracesByPosition,
  getTracesByAgent,
  getTracesByTimeRange,
  getTracesByOutcomeType,
  getRecentTraces,
  getTraceStats,
  pruneOldTraces,
} from "./store.ts";
import type {
  AuditTrace,
  AuditTrigger,
  AuditQueryFilters,
  AuditStats,
  TraceBuilder,
} from "./types.ts";

const logger = createModuleLogger("audit-chain");

// ============================================================================
// Audit Chain Singleton
// ============================================================================

export class AuditChain {
  private static instance: AuditChain | null = null;

  private constructor() {}

  static getInstance(): AuditChain {
    if (!AuditChain.instance) {
      AuditChain.instance = new AuditChain();
    }
    return AuditChain.instance;
  }

  // --------------------------------------------------------------------------
  // Trace Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start a new trace. Returns a builder for incrementally constructing
   * the trace during execution.
   *
   * Call `builder.finish()` when done, then `saveTrace()` to persist.
   */
  startTrace(trigger: AuditTrigger): TraceBuilder {
    const builder = createTraceBuilder();
    builder.startTrace(trigger);
    logger.debug("Audit trace started", {
      trace_id: builder.traceId,
      trigger_type: trigger.type,
      source: trigger.source,
    });
    return builder;
  }

  /**
   * Finish a trace builder and persist the completed trace.
   */
  finishAndSave(builder: TraceBuilder): AuditTrace {
    const trace = builder.finish();
    saveTrace(trace);
    logger.debug("Audit trace finished and saved", {
      trace_id: trace.trace_id,
      outcome: trace.outcome.type,
      duration_ms: String(trace.duration_ms ?? 0),
    });
    return trace;
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /**
   * Flexible query with multiple optional filters.
   */
  query(filters: AuditQueryFilters): AuditTrace[] {
    const limit = filters.limit ?? 50;

    // Dispatch to the most specific query method available
    if (filters.positionId) {
      return getTracesByPosition(filters.positionId);
    }

    if (filters.agentId) {
      return getTracesByAgent(filters.agentId, limit);
    }

    if (filters.from && filters.to) {
      return getTracesByTimeRange(filters.from, filters.to);
    }

    if (filters.outcomeType) {
      return getTracesByOutcomeType(filters.outcomeType);
    }

    return getRecentTraces(limit);
  }

  /**
   * "Why did we open this position?"
   */
  getTraceForPosition(positionId: string): AuditTrace[] {
    return getTracesByPosition(positionId);
  }

  /**
   * "What has Scanner been doing for the last N hours?"
   */
  getAgentActivity(agentId: string, hours: number = 24): AuditTrace[] {
    const from = new Date(Date.now() - hours * 60 * 60 * 1000);
    const allAgentTraces = getTracesByAgent(agentId, 200);
    const fromMs = from.getTime();
    return allAgentTraces.filter(
      (t) => new Date(t.started_at).getTime() >= fromMs
    );
  }

  /**
   * Get a single trace by ID.
   */
  getTraceById(traceId: string): AuditTrace | null {
    return getTrace(traceId);
  }

  /**
   * Get summary statistics.
   */
  getStats(): AuditStats {
    return getTraceStats();
  }

  /**
   * Delete old traces.
   */
  prune(olderThanDays: number): number {
    return pruneOldTraces(olderThanDays);
  }

  // --------------------------------------------------------------------------
  // Formatting
  // --------------------------------------------------------------------------

  /**
   * Build a human-readable decision path string for a trace.
   *
   * Example:
   *   [market_event] VOLUME_SPIKE from MarketEventEmitter
   *    -> Scanner: "Detected 3.5x volume spike on BTCUSDT"
   *       - get_market_data (12ms OK)
   *       - scan_orderbook (45ms OK)
   *       => handed off to Analyst (high confidence setup)
   *    -> Analyst: "Bullish bias confirmed, R:R 3.2"
   *       - get_technical_analysis (89ms OK)
   *    => Outcome: analysis_complete
   */
  getDecisionPath(traceId: string): string {
    const trace = getTrace(traceId);
    if (!trace) return `Trace ${traceId} not found.`;
    return this.formatDecisionPath(trace);
  }

  /**
   * Format a trace object as a human-readable decision path.
   */
  private formatDecisionPath(trace: AuditTrace): string {
    const lines: string[] = [];

    // Trigger line
    const eventInfo = trace.trigger.event_type
      ? ` ${trace.trigger.event_type}`
      : "";
    lines.push(
      `[${trace.trigger.type}]${eventInfo} from ${trace.trigger.source}`
    );
    lines.push(`  "${trace.trigger.payload_summary}"`);

    // Agent steps
    for (const step of trace.agent_steps) {
      const dur = step.ended_at
        ? `${Math.round(new Date(step.ended_at).getTime() - new Date(step.started_at).getTime())}ms`
        : "running";
      lines.push(` -> ${step.agent_id} (${dur}):`);
      if (step.reasoning_summary) {
        lines.push(`    "${step.reasoning_summary}"`);
      }
      for (const tc of step.tool_calls) {
        const status = tc.success ? "OK" : `FAIL: ${tc.error ?? "unknown"}`;
        lines.push(`    - ${tc.tool_name} (${tc.duration_ms}ms ${status})`);
      }
      if (step.handed_off_to) {
        lines.push(
          `    => handed off to ${step.handed_off_to} (${step.handoff_reason ?? "no reason"})`
        );
      }
    }

    // Outcome
    const posInfo = trace.outcome.position_id
      ? ` [pos: ${trace.outcome.position_id}]`
      : "";
    lines.push(` => Outcome: ${trace.outcome.type}${posInfo}`);
    lines.push(`    "${trace.outcome.details}"`);

    // Duration
    if (trace.duration_ms !== undefined) {
      lines.push(`    Total: ${trace.duration_ms}ms`);
    }

    return lines.join("\n");
  }

  /**
   * Format a trace as structured Markdown for user-facing display.
   */
  formatTraceAsMarkdown(trace: AuditTrace): string {
    const lines: string[] = [];

    lines.push(`## Decision Trace \`${trace.trace_id.slice(0, 8)}...\``);
    lines.push("");

    // Trigger
    lines.push("### Trigger");
    lines.push(`- **Type:** ${trace.trigger.type}`);
    if (trace.trigger.event_type) {
      lines.push(`- **Event:** ${trace.trigger.event_type}`);
    }
    lines.push(`- **Source:** ${trace.trigger.source}`);
    lines.push(`- **Summary:** ${trace.trigger.payload_summary}`);
    lines.push("");

    // Agent Steps
    if (trace.agent_steps.length > 0) {
      lines.push("### Agent Steps");
      lines.push("");

      for (let i = 0; i < trace.agent_steps.length; i++) {
        const step = trace.agent_steps[i]!;
        lines.push(`**${i + 1}. ${step.agent_id}**`);
        if (step.reasoning_summary) {
          lines.push(`> ${step.reasoning_summary}`);
        }

        if (step.tool_calls.length > 0) {
          lines.push("");
          lines.push("| Tool | Duration | Status |");
          lines.push("|------|----------|--------|");
          for (const tc of step.tool_calls) {
            const status = tc.success ? "OK" : `Error: ${tc.error ?? "?"}`;
            lines.push(`| ${tc.tool_name} | ${tc.duration_ms}ms | ${status} |`);
          }
        }

        if (step.handed_off_to) {
          lines.push("");
          lines.push(
            `*Handed off to **${step.handed_off_to}*** — ${step.handoff_reason ?? "no reason given"}`
          );
        }
        lines.push("");
      }
    }

    // Outcome
    lines.push("### Outcome");
    lines.push(`- **Type:** ${trace.outcome.type}`);
    if (trace.outcome.position_id) {
      lines.push(`- **Position:** ${trace.outcome.position_id}`);
    }
    lines.push(`- **Details:** ${trace.outcome.details}`);
    lines.push("");

    // Metadata
    lines.push("### Metadata");
    lines.push(`- **Started:** ${trace.started_at}`);
    if (trace.ended_at) {
      lines.push(`- **Ended:** ${trace.ended_at}`);
    }
    if (trace.duration_ms !== undefined) {
      lines.push(`- **Duration:** ${trace.duration_ms}ms`);
    }
    if (trace.risk_check_id) {
      lines.push(`- **Risk Check:** ${trace.risk_check_id}`);
    }
    if (trace.parent_trace_id) {
      lines.push(`- **Parent Trace:** ${trace.parent_trace_id}`);
    }

    return lines.join("\n");
  }
}

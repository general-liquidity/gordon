/**
 * Audit Tools (Mastra Format)
 *
 * Agent tools for querying the Agent Audit Chain.
 * Allows agents to inspect past decisions, understand why trades were
 * executed or rejected, and review their own activity history.
 *
 * All operations are wrapped in try/catch — audit failures should
 * never crash agent execution.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { AuditChain } from "../../../core/audit/index.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("audit-tools");

// ============================================================================
// Query Audit Trail Tool
// ============================================================================

export const queryAuditTrailTool = createTool({
  id: "query_audit_trail",
  description:
    "Search the agent audit trail for past decision traces. " +
    "Filter by agent, outcome type, position, or time range. " +
    "Returns summaries of matching decision flows.",
  inputSchema: z.object({
    agent_id: z
      .string()
      .optional()
      .describe("Filter by agent ID (e.g., 'Scanner', 'Analyst', 'Executor')"),
    outcome_type: z
      .enum([
        "trade_executed",
        "trade_rejected",
        "analysis_complete",
        "alert_generated",
        "no_action",
        "error",
      ])
      .optional()
      .describe("Filter by outcome type"),
    position_id: z
      .string()
      .optional()
      .describe("Filter by position ID to see all decisions related to a position"),
    hours: z
      .number()
      .min(1)
      .max(720)
      .optional()
      .describe("Look back N hours (default: all time)"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Max results to return"),
  }),
  outputSchema: z.object({
    traces: z.array(
      z.object({
        trace_id: z.string(),
        trigger: z.string(),
        agents_involved: z.array(z.string()),
        outcome: z.string(),
        duration_ms: z.number().optional(),
        started_at: z.string(),
      })
    ),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ agent_id, outcome_type, position_id, hours, limit }) => {
    try {
      const chain = AuditChain.getInstance();
      const filters: Parameters<typeof chain.query>[0] = {
        agentId: agent_id,
        outcomeType: outcome_type,
        positionId: position_id,
        limit: limit ?? 10,
      };

      if (hours) {
        filters.from = new Date(Date.now() - hours * 60 * 60 * 1000);
        filters.to = new Date();
      }

      const traces = chain.query(filters);

      return {
        traces: traces.slice(0, limit ?? 10).map((t) => ({
          trace_id: t.trace_id,
          trigger: `[${t.trigger.type}] ${t.trigger.event_type ?? ""} from ${t.trigger.source}: ${t.trigger.payload_summary}`.trim(),
          agents_involved: t.agent_steps.map((s) => s.agent_id),
          outcome: `${t.outcome.type}: ${t.outcome.details}`,
          duration_ms: t.duration_ms,
          started_at: t.started_at,
        })),
        count: traces.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("query_audit_trail failed", { error: message });
      return { traces: [], count: 0, error: message };
    }
  },
});

// ============================================================================
// Get Decision Path Tool
// ============================================================================

export const getDecisionPathTool = createTool({
  id: "get_decision_path",
  description:
    "Get the full decision path for a specific trace or position. " +
    "Shows the complete chain: trigger -> agent reasoning -> tool calls -> outcome. " +
    "Use to answer 'why did we buy X?' or 'what happened with position Y?'",
  inputSchema: z.object({
    trace_id: z
      .string()
      .optional()
      .describe("Specific trace ID to inspect"),
    position_id: z
      .string()
      .optional()
      .describe("Position ID to find all related decision paths"),
  }),
  outputSchema: z.object({
    paths: z.array(
      z.object({
        trace_id: z.string(),
        decision_path: z.string(),
        markdown: z.string(),
      })
    ),
    count: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ trace_id, position_id }) => {
    try {
      const chain = AuditChain.getInstance();
      const paths: { trace_id: string; decision_path: string; markdown: string }[] = [];

      if (trace_id) {
        const trace = chain.getTraceById(trace_id);
        if (trace) {
          paths.push({
            trace_id: trace.trace_id,
            decision_path: chain.getDecisionPath(trace.trace_id),
            markdown: chain.formatTraceAsMarkdown(trace),
          });
        }
      }

      if (position_id) {
        const traces = chain.getTraceForPosition(position_id);
        for (const trace of traces) {
          // Avoid duplicates if both trace_id and position_id match the same trace
          if (!paths.some((p) => p.trace_id === trace.trace_id)) {
            paths.push({
              trace_id: trace.trace_id,
              decision_path: chain.getDecisionPath(trace.trace_id),
              markdown: chain.formatTraceAsMarkdown(trace),
            });
          }
        }
      }

      if (!trace_id && !position_id) {
        return {
          paths: [],
          count: 0,
          error: "Provide either trace_id or position_id",
        };
      }

      return { paths, count: paths.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_decision_path failed", { error: message });
      return { paths: [], count: 0, error: message };
    }
  },
});

// ============================================================================
// Get Agent Activity Tool
// ============================================================================

export const getAgentActivityTool = createTool({
  id: "get_agent_activity",
  description:
    "Get recent activity for a specific agent. " +
    "Shows what the agent has been doing, what decisions it participated in, " +
    "and what tools it used. Useful for monitoring agent behavior.",
  inputSchema: z.object({
    agent_id: z
      .string()
      .describe("Agent ID to inspect (e.g., 'Scanner', 'Analyst', 'Executor', 'Monitor', 'Planner', 'Teacher', 'Backtester')"),
    hours: z
      .number()
      .min(1)
      .max(720)
      .default(24)
      .describe("Look back N hours (default: 24)"),
  }),
  outputSchema: z.object({
    agent_id: z.string(),
    traces: z.array(
      z.object({
        trace_id: z.string(),
        trigger: z.string(),
        reasoning: z.string(),
        tools_used: z.array(z.string()),
        outcome: z.string(),
        started_at: z.string(),
      })
    ),
    summary: z.object({
      total_traces: z.number(),
      total_tool_calls: z.number(),
      outcomes: z.record(z.string(), z.number()),
    }),
    error: z.string().optional(),
  }),
  execute: async ({ agent_id, hours }) => {
    try {
      const chain = AuditChain.getInstance();
      const traces = chain.getAgentActivity(agent_id, hours ?? 24);

      const outcomeCounts: Record<string, number> = {};
      let totalToolCalls = 0;

      const formattedTraces = traces.map((t) => {
        // Find the step(s) for this agent
        const agentSteps = t.agent_steps.filter(
          (s) => s.agent_id === agent_id
        );
        const reasoning = agentSteps
          .map((s) => s.reasoning_summary)
          .filter(Boolean)
          .join("; ");
        const tools = agentSteps.flatMap((s) =>
          s.tool_calls.map((tc) => tc.tool_name)
        );

        totalToolCalls += tools.length;

        const outcomeKey = t.outcome.type;
        outcomeCounts[outcomeKey] = (outcomeCounts[outcomeKey] ?? 0) + 1;

        return {
          trace_id: t.trace_id,
          trigger: `[${t.trigger.type}] ${t.trigger.payload_summary}`,
          reasoning: reasoning || "(no reasoning recorded)",
          tools_used: tools,
          outcome: `${t.outcome.type}: ${t.outcome.details}`,
          started_at: t.started_at,
        };
      });

      return {
        agent_id,
        traces: formattedTraces,
        summary: {
          total_traces: traces.length,
          total_tool_calls: totalToolCalls,
          outcomes: outcomeCounts,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_agent_activity failed", { error: message });
      return {
        agent_id,
        traces: [],
        summary: { total_traces: 0, total_tool_calls: 0, outcomes: {} },
        error: message,
      };
    }
  },
});

// ============================================================================
// Get Audit Stats Tool
// ============================================================================

export const getAuditStatsTool = createTool({
  id: "get_audit_stats",
  description:
    "Get summary statistics for all traced agent decisions. " +
    "Shows totals, breakdowns by agent and outcome, and average duration. " +
    "Useful for understanding overall system behavior and health.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    total: z.number(),
    by_agent: z.record(z.string(), z.number()),
    by_outcome: z.record(z.string(), z.number()),
    by_trigger: z.record(z.string(), z.number()),
    avg_duration_ms: z.number(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const chain = AuditChain.getInstance();
      const stats = chain.getStats();

      return {
        total: stats.total,
        by_agent: stats.byAgent,
        by_outcome: stats.byOutcome,
        by_trigger: stats.byTrigger,
        avg_duration_ms: Math.round(stats.avgDurationMs),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_audit_stats failed", { error: message });
      return {
        total: 0,
        by_agent: {},
        by_outcome: {},
        by_trigger: {},
        avg_duration_ms: 0,
        error: message,
      };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Audit tools exported as an object for Mastra Agent.
 * This is the format expected by Mastra's Agent class.
 */
export const auditTools = {
  query_audit_trail: queryAuditTrailTool,
  get_decision_path: getDecisionPathTool,
  get_agent_activity: getAgentActivityTool,
  get_audit_stats: getAuditStatsTool,
};

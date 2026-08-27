/**
 * System Tools (Mastra Format)
 * Tools for testing connections and system diagnostics
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key differences:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via execContext.requestContext.get("key")
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "../../types.ts";
import {
  providerRegistry,
  getActiveRoute,
  DIRECT_MODELS,
  type DirectProviderName,
} from "../../../../runtime/providers/registry.ts";
import {
  loadConfig,
  loadConfigBundle,
  saveResolvedConfig,
} from "../../../../storage/config/config.ts";
import { ExchangeFactory } from "../../../../exchange/index.ts";
import { BrokerFactory } from "../../../../broker/factory.ts";
import { getToolCacheStats, clearToolCache, pruneToolCache } from "../cache.ts";
import { resolveFlag, writeFlagSetting } from "../../../../config/flagResolver.ts";
import {
  getAgentHealthReport,
  getAgentMetrics,
  formatAgentHealthReport,
} from "../../../../platform/observability/index.ts";

// NOTE: getHandoffHistory is dynamically imported to break circular dependency
// (system.ts -> orchestrator.ts -> agents.ts -> tools/index.ts -> system.ts)

// ============================================================================
// Connection Test Tool
// ============================================================================

export const testConnectionTool = createTool({
  id: "test_connection",
  description:
    "Test the connection to the active exchange and verify API key permissions. " +
    "Use when user asks 'test connection', 'check API', 'are my keys working?'",
  inputSchema: z.object({}),
  outputSchema: z.object({
    permissionMode: z.enum(["auto", "ask", "strict", "paper", "observe", "plan"]),
    canTradeNow: z.boolean(),
    llmConnected: z.boolean(),
    binanceConnected: z.boolean(),
    binancePermissions: z
      .object({
        read: z.boolean(),
        spotTrade: z.boolean(),
        withdraw: z.boolean(),
      })
      .nullable()
      .optional(),
    accountType: z.string().nullable(),
    canTrade: z.boolean().optional(),
    canWithdraw: z.boolean().optional(),
    canDeposit: z.boolean().optional(),
    assetsWithBalance: z.number().optional(),
    assetList: z
      .array(
        z.object({
          asset: z.string(),
          free: z.number(),
          locked: z.number(),
        }),
      )
      .optional(),
    error: z.string().nullable(),
  }),
  execute: async (_input, execContext: MastraExecutionContext) => {
    // Context is extracted from Mastra's RequestContext
    const ctx = getGordonContext(execContext);
    const results: {
      permissionMode: "auto" | "ask" | "strict" | "paper" | "observe" | "plan";
      canTradeNow: boolean;
      llmConnected: boolean;
      binanceConnected: boolean;
      binancePermissions?: { read: boolean; spotTrade: boolean; withdraw: boolean } | null;
      accountType: string | null;
      canTrade?: boolean;
      canWithdraw?: boolean;
      canDeposit?: boolean;
      assetsWithBalance?: number;
      assetList?: Array<{ asset: string; free: number; locked: number }>;
      error: string | null;
    } = {
      permissionMode: "ask",
      canTradeNow: true,
      llmConnected: !!ctx?.llm,
      binanceConnected: false,
      binancePermissions: null,
      accountType: null,
      error: null,
    };

    const config = await loadConfig().catch(() => null);
    if (config) {
      results.permissionMode = config.permissionMode;
      results.canTradeNow = config.permissionMode !== "strict";
    }

    if (!ctx?.exchange) {
      results.error = "Exchange client not initialized. Check your API keys in settings.";
      return results;
    }

    try {
      const connected = await ctx.exchange.testConnection();
      results.binanceConnected = connected;

      if (connected) {
        const accountInfo = await ctx.exchange.getAccountInfo();
        results.accountType = accountInfo.accountType;
        results.canTrade = accountInfo.canTrade;
        results.canWithdraw = accountInfo.canWithdraw;
        results.canDeposit = accountInfo.canDeposit;

        const nonZeroBalances = accountInfo.balances.filter((b) => b.free > 0 || b.locked > 0);
        results.assetsWithBalance = nonZeroBalances.length;
        results.assetList = nonZeroBalances.map((b) => ({
          asset: b.asset,
          free: b.free,
          locked: b.locked,
        }));
      }
    } catch (error) {
      results.error = error instanceof Error ? error.message : "Unknown error";
    }

    return results;
  },
});

// ============================================================================
// Model Info Tool
// ============================================================================

const DIRECT_MODEL_TIERS: Record<
  DirectProviderName,
  { flagship: string; balanced: string; fast: string }
> = DIRECT_MODELS;

export const getModelInfoTool = createTool({
  id: "get_model_info",
  description:
    "Get information about the current AI model and available providers. " +
    "Use when user asks 'what model am I using?', '/model', 'change model', 'show providers'",
  inputSchema: z.object({}),
  outputSchema: z.object({
    currentProvider: z.string(),
    currentModel: z.string(),
    directProviders: z.array(
      z.object({
        name: z.string(),
        configured: z.boolean(),
        models: z.object({
          flagship: z.string(),
          balanced: z.string(),
          fast: z.string(),
        }),
      }),
    ),
    availableModels: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        provider: z.string(),
      }),
    ),
    tip: z.string(),
  }),
  execute: async () => {
    const config = await loadConfig().catch(() => null);
    const activeRoute = getActiveRoute();
    const currentProvider = config?.modelConfig?.provider || activeRoute.provider;
    const currentModel = config?.modelConfig?.model || activeRoute.modelString;
    const availableProviders = providerRegistry.getAvailableProviders();

    const directProviders = (["anthropic", "openai", "google", "xai"] as DirectProviderName[]).map(
      (name) => ({
        name,
        configured: availableProviders.includes(name),
        models: DIRECT_MODEL_TIERS[name],
      }),
    );

    const availableModels = providerRegistry.getAllAvailableModels();

    return {
      currentProvider,
      currentModel,
      directProviders,
      availableModels,
      tip: "Use /model to select from any configured provider or gateway.",
    };
  },
});

// ============================================================================
// Cache Stats Tool
// ============================================================================

export const getCacheStatsTool = createTool({
  id: "get_cache_stats",
  description:
    "Get tool cache statistics including hit rate, misses, and in-flight requests. " +
    "Use when user asks '/cache', 'cache stats', 'show cache', or wants to debug performance.",
  inputSchema: z.object({
    action: z
      .enum(["stats", "clear", "prune"])
      .default("stats")
      .describe(
        "Action to perform: stats (show statistics), clear (reset cache), prune (remove expired)",
      ),
  }),
  outputSchema: z.object({
    action: z.string(),
    stats: z
      .object({
        hits: z.number(),
        misses: z.number(),
        hitRate: z.number(),
        inFlightRequests: z.number(),
      })
      .optional(),
    message: z.string(),
  }),
  execute: async ({ action }) => {
    if (action === "clear") {
      clearToolCache();
      return {
        action: "clear",
        message: "Tool cache cleared successfully.",
      };
    }

    if (action === "prune") {
      pruneToolCache();
      return {
        action: "prune",
        message: "Expired cache entries pruned.",
      };
    }

    // Default: show stats
    const stats = getToolCacheStats();
    const hitRatePercent = (stats.hitRate * 100).toFixed(1);

    return {
      action: "stats",
      stats,
      message: `Cache Stats: ${stats.hits} hits, ${stats.misses} misses (${hitRatePercent}% hit rate). ${stats.inFlightRequests} requests in-flight.`,
    };
  },
});

// ============================================================================
// Agent Health Tool
// ============================================================================

/**
 * Schema for per-agent metrics
 */
const perAgentMetricsSchema = z.object({
  agentName: z.string(),
  totalCalls: z.number(),
  successfulCalls: z.number(),
  failedCalls: z.number(),
  successRate: z.number(),
  totalLatencyMs: z.number(),
  avgLatencyMs: z.number(),
  minLatencyMs: z.number(),
  maxLatencyMs: z.number(),
  totalTokens: z.number(),
  avgTokensPerCall: z.number(),
  errorTypes: z.record(z.string(), z.number()),
  recentErrors: z.array(
    z.object({
      timestamp: z.number(),
      errorType: z.string(),
      message: z.string(),
    }),
  ),
  lastCallTimestamp: z.number().nullable(),
});

/**
 * Schema for agent health report
 */
const agentHealthReportSchema = z.object({
  timestamp: z.string(),
  overallHealthScore: z.number(),
  totalAgentCalls: z.number(),
  totalSuccessfulCalls: z.number(),
  totalFailedCalls: z.number(),
  overallSuccessRate: z.number(),
  agents: z.record(z.string(), perAgentMetricsSchema),
  unhealthyAgents: z.array(z.string()),
  recommendations: z.array(z.string()),
});

/**
 * Schema for handoff record
 */
const handoffRecordSchema = z.object({
  handoffId: z.string(),
  fromAgent: z.string(),
  toAgent: z.string(),
  timestamp: z.number(),
  validated: z.boolean(),
  validationReason: z.string().optional(),
});

export const getAgentHealthTool = createTool({
  id: "get_agent_health",
  description:
    "Get agent health status showing success rates, average latency, token usage, and recent errors per agent. " +
    "Use when user asks '/health', 'agent health', 'show agent status', 'which agents are failing?', or 'agent diagnostics'.",
  inputSchema: z.object({
    agentName: z
      .string()
      .optional()
      .describe(
        "Optional specific agent name to get detailed metrics for (e.g., 'Analyst', 'Scanner')",
      ),
    includeHandoffs: z
      .boolean()
      .default(false)
      .describe("Include recent handoff history in the response"),
    format: z
      .enum(["json", "text"])
      .default("json")
      .describe("Output format: 'json' for structured data, 'text' for human-readable"),
  }),
  outputSchema: z.object({
    // Full report (when no specific agent requested)
    report: agentHealthReportSchema.optional(),
    // Specific agent metrics (when agentName provided)
    agentMetrics: perAgentMetricsSchema.optional(),
    // Recent handoffs (when includeHandoffs is true)
    recentHandoffs: z.array(handoffRecordSchema).optional(),
    // Formatted text output (when format is 'text')
    formattedReport: z.string().optional(),
    // Summary info
    summary: z
      .object({
        overallHealth: z.enum(["healthy", "degraded", "unhealthy"]),
        healthScore: z.number(),
        totalAgents: z.number(),
        unhealthyCount: z.number(),
        topRecommendation: z.string().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ agentName, includeHandoffs, format }) => {
    try {
      // Dynamic import to break circular dependency
      const { getHandoffHistory } = await import("../../../orchestrator.ts");

      // If specific agent requested, return just that agent's metrics
      if (agentName) {
        const metrics = getAgentMetrics(agentName);
        const handoffs = includeHandoffs
          ? getHandoffHistory(10).filter(
              (h) => h.fromAgent === agentName || h.toAgent === agentName,
            )
          : undefined;

        if (format === "text") {
          const lines = [
            `Agent: ${metrics.agentName}`,
            `Total Calls: ${metrics.totalCalls}`,
            `Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`,
            `Avg Latency: ${metrics.avgLatencyMs.toFixed(0)}ms`,
            `Total Tokens: ${metrics.totalTokens}`,
          ];
          if (metrics.failedCalls > 0) {
            lines.push(`Failed Calls: ${metrics.failedCalls}`);
            lines.push(`Error Types: ${JSON.stringify(metrics.errorTypes)}`);
          }
          return {
            agentMetrics: metrics,
            recentHandoffs: handoffs,
            formattedReport: lines.join("\n"),
          };
        }

        return {
          agentMetrics: metrics,
          recentHandoffs: handoffs,
        };
      }

      // Get full health report
      const report = getAgentHealthReport();
      const handoffs = includeHandoffs ? getHandoffHistory(20) : undefined;

      // Determine overall health status
      let overallHealth: "healthy" | "degraded" | "unhealthy";
      if (report.overallHealthScore >= 90) {
        overallHealth = "healthy";
      } else if (report.overallHealthScore >= 70) {
        overallHealth = "degraded";
      } else {
        overallHealth = "unhealthy";
      }

      const summary = {
        overallHealth,
        healthScore: report.overallHealthScore,
        totalAgents: Object.keys(report.agents).length,
        unhealthyCount: report.unhealthyAgents.length,
        topRecommendation: report.recommendations[0],
      };

      if (format === "text") {
        return {
          report,
          recentHandoffs: handoffs,
          formattedReport: formatAgentHealthReport(),
          summary,
        };
      }

      return {
        report,
        recentHandoffs: handoffs,
        summary,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to get agent health",
      };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * System tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
// ============================================================================
// Switch Exchange Tool
// ============================================================================

export const switchExchangeTool = createTool({
  id: "switch_exchange",
  description:
    "Switch the active exchange/venue to any configured account. " +
    "Lists available exchanges when called with no ID. " +
    "Use when user says 'switch to Coinbase', 'use Binance testnet', 'change venue', 'switch exchange'.",
  inputSchema: z.object({
    exchangeId: z
      .string()
      .optional()
      .describe(
        "Exchange config ID to switch to (e.g. 'binance-live', 'coinbase-sandbox'). Omit to list available exchanges.",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    activeExchange: z
      .object({
        id: z.string(),
        type: z.string(),
        sandbox: z.boolean().optional(),
      })
      .optional(),
    available: z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
          sandbox: z.boolean().optional(),
          isDefault: z.boolean().optional(),
          active: z.boolean().optional(),
        }),
      )
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ exchangeId }) => {
    const resolved = await loadConfigBundle();
    const config = resolved.config;
    const exchanges = config.exchanges ?? [];

    if (!exchangeId) {
      const currentId =
        config.activeExchangeId ?? exchanges.find((e) => e.isDefault)?.id ?? exchanges[0]?.id;
      return {
        success: true,
        available: exchanges.map((e) => ({
          id: e.id,
          type: e.type,
          sandbox: e.sandbox,
          isDefault: e.isDefault,
          active: e.id === currentId,
        })),
        message: `${exchanges.length} exchange(s) configured. Current: ${currentId ?? "none"}`,
      };
    }

    const target = exchanges.find((e) => e.id === exchangeId);
    if (!target) {
      const ids = exchanges.map((e) => e.id).join(", ");
      return {
        error: `Exchange '${exchangeId}' not found. Available: ${ids || "none configured"}`,
      };
    }

    await saveResolvedConfig({ ...config, activeExchangeId: exchangeId }, resolved.layers);

    // Bust adapter caches so the next request picks up the new active exchange.
    ExchangeFactory.clearCache();
    BrokerFactory.clearCache();
    try {
      const { getGatewayContextResolver } = await import(
        "../../../../../gateway/runtime/context.ts"
      );
      getGatewayContextResolver().invalidate();
    } catch {
      // Not running inside the gateway daemon.
    }

    return {
      success: true,
      activeExchange: { id: target.id, type: target.type, sandbox: target.sandbox },
      message: `Switched to ${target.type} (${target.id})${target.sandbox ? " [sandbox]" : " [live]"}.`,
    };
  },
});

// ============================================================================
// Behavior-flag inspector + toggle
// ============================================================================

const KEEPER_FLAGS = [
  {
    name: "GORDON_ACE_ENABLED",
    description:
      "ACE (Agentic Context Engineering): /reflect distills the action log into lessons, injected into the system prompt of future sessions. Writes across sessions — opt-in for safety.",
    truthy: ["true", "1", "yes", "on"],
    defaultOn: false,
  },
  {
    name: "GORDON_DYNAMIC_SUBAGENTS",
    description:
      "Enables the FW7 delegate_subagent dispatcher. Requires operator-authored .claude/subagents/*.json profiles.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_DEFER_WORKING_MEMORY",
    description:
      "Buffer mid-session working-memory writes to preserve prompt-cache stability; flush at session boundaries.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_SUPERVISION_RUST_RATE",
    description:
      "Periodic flawed-plan injection rate (0–1). Calibrated threshold; operators set their own cadence.",
    truthy: [],
    defaultOn: false,
  },
  {
    name: "GORDON_COMPACTION_STAGE",
    description:
      "Force a specific compaction stage during debugging. Values: 'masking' | 'pruning' | 'aggressive' | 'full'.",
    truthy: [],
    defaultOn: false,
  },
  // --- Reasoning passes (default-on architecture; disable to save latency) ---
  {
    name: "GORDON_TOOL_FREE_THINKING",
    description: "Tool-free pre-action reasoning pass on non-trivial requests.",
    truthy: ["true", "1"],
    defaultOn: false,
  },
  {
    name: "GORDON_ADVERSARIAL_EVALUATOR",
    description: "Hostile-review critique prompt at HIGH thinking depth.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_CITATION_AGENT",
    description: "Post-hoc claim→evidence citation manifest over tool results.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_PEER_DELEGATION",
    description: "Peer-agent delegation dispatcher. Default-on; set 0/false to disable.",
    truthy: ["1", "true"],
    defaultOn: true,
  },
  {
    name: "GORDON_AUTODREAM_ENABLED",
    description: "Background memory consolidation (ACE distill + session dedupe) on cadence.",
    truthy: ["true", "1"],
    defaultOn: false,
  },
  {
    name: "GORDON_REFLECTION_ENABLED",
    description: "Warm the post-trade reflection store at boot.",
    truthy: ["true", "1"],
    defaultOn: false,
  },
  // --- Trade-halt gates ---
  {
    name: "GORDON_WIP_LIMIT_ENABLED",
    description: "Work-in-progress plan gate (WIP=N per symbol / M per strategy).",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_STREAK_CIRCUIT_BREAKER",
    description: "Consecutive-loss cooldown lockout (Rule of Three).",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_GIVE_BACK_STOP",
    description: "Flatten when session gives back >50% of intraday high-water P&L.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_ABSORBING_BARRIER",
    description: "Distance-to-ruin classifier (broker / prop-firm / psychological barriers).",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  // --- Cost / risk config (value flags) ---
  {
    name: "GORDON_COST_BUDGET_USD",
    description: "Session USD cost budget; dispatch halts once exceeded (default 25).",
    truthy: [],
    defaultOn: false,
  },
  {
    name: "GORDON_RISK_MODE",
    description: "Risk-gate mode override, e.g. 'paper' to force paper evaluation.",
    truthy: [],
    defaultOn: false,
  },
  {
    name: "GORDON_RISK_MAX_LEVERAGE",
    description: "Max leverage cap applied at the exchange adapter.",
    truthy: [],
    defaultOn: false,
  },
  // --- Safety flags ---
  {
    name: "GORDON_ALLOW_LIVE",
    description:
      "Opt into LIVE trading on a venue with no sandbox/testnet. Money-path — leave off unless deliberate.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_RISK_ACK",
    description:
      "Anti-rubber-stamp risk-acknowledgement gate on execute_plan: medium+ tier must name the top risk dimensions, and every risk-kernel warning needs a distinct acknowledgement.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_MEMORY_WRITE_GUARD",
    description:
      "Enforce (not just log) the working-memory sensitive-field guard on untrusted writes.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_SPRINT_CONTRACT",
    description: "Record scope/actuals for autonomous-loop sessions; inspect via /sprint-status.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
  {
    name: "GORDON_AGENT_READINESS_GATE",
    description:
      "Adds boot-time readiness rows to the doctor report. Not a gate: nothing blocks agent spawn on a failing condition.",
    truthy: ["1", "true"],
    defaultOn: false,
  },
] as const;

function flagIsOn(name: string, truthy: ReadonlyArray<string>, defaultOn: boolean): boolean {
  const raw = resolveFlag(name);
  if (raw === undefined || raw === "") return defaultOn;
  if (truthy.length === 0) return true; // value-flags: any set value is "on"
  if (defaultOn) return raw !== "0" && raw.toLowerCase() !== "false";
  return truthy.includes(raw.toLowerCase());
}

export const manageFlagsTool = createTool({
  id: "manage_flags",
  description: [
    "Inspect or toggle Gordon's operator-toggleable flags at runtime. Covers the",
    "opt-in behavior flags (ACE, subagents, memory deferral, supervision, compaction),",
    "the reasoning passes, the trade-halt gates, cost/risk config, and the safety flags.",
    "",
    "Resolution precedence: process.env override > settings.json (flags) > built-in default.",
    "action='list' returns the resolved state of each.",
    "action='set' persists to the local settings layer (~/.gordon/settings.local.json)",
    "AND applies to the current process, so the change survives restart. An explicit",
    "env var still overrides the stored value.",
  ].join("\n"),
  inputSchema: z.object({
    action: z.enum(["list", "set"]),
    name: z.string().optional().describe("Required when action='set'."),
    value: z.string().optional().describe("Required when action='set'. Use empty string to unset."),
  }),
  outputSchema: z.object({
    flags: z
      .array(
        z.object({
          name: z.string(),
          on: z.boolean(),
          value: z.string().optional(),
          description: z.string(),
        }),
      )
      .optional(),
    changed: z
      .object({
        name: z.string(),
        previous: z.string().optional(),
        current: z.string().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ action, name, value }) => {
    if (action === "list") {
      return {
        flags: KEEPER_FLAGS.map((f) => ({
          name: f.name,
          on: flagIsOn(f.name, f.truthy, f.defaultOn),
          value: resolveFlag(f.name),
          description: f.description,
        })),
      };
    }
    if (!name) {
      return { error: "`name` is required when action='set'." };
    }
    if (!KEEPER_FLAGS.some((f) => f.name === name)) {
      return {
        error: `Unknown flag '${name}'. Use action='list' to see the supported flags.`,
      };
    }
    const previous = resolveFlag(name);
    if (value === undefined || value === "") {
      delete process.env[name];
      writeFlagSetting(name, undefined);
      return { changed: { name, previous, current: undefined } };
    }
    process.env[name] = value;
    writeFlagSetting(name, value);
    return { changed: { name, previous, current: value } };
  },
});

export const systemTools = {
  test_connection: testConnectionTool,
  get_model_info: getModelInfoTool,
  get_cache_stats: getCacheStatsTool,
  get_agent_health: getAgentHealthTool,
  switch_exchange: switchExchangeTool,
  manage_flags: manageFlagsTool,
};

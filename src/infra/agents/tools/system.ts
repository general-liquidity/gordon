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

import { getGordonContext, type MastraExecutionContext } from "./types.ts";
import { providerRegistry, getDedalusModels, refreshDedalusModels, getActiveRoute, DIRECT_MODELS, type DirectProviderName } from "../../providers/registry.ts";
import { loadConfig } from "../../storage/config.ts";
import { getToolCacheStats, clearToolCache, pruneToolCache } from "./cache.ts";
import {
  getAgentHealthReport,
  getAgentMetrics,
  formatAgentHealthReport,
  type PerAgentMetrics,
  type AgentHealthReport,
} from "../../observability/index.ts";

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
    llmConnected: z.boolean(),
    binanceConnected: z.boolean(),
    binancePermissions: z.object({
      read: z.boolean(),
      spotTrade: z.boolean(),
      withdraw: z.boolean(),
    }).nullable().optional(),
    accountType: z.string().nullable(),
    canTrade: z.boolean().optional(),
    canWithdraw: z.boolean().optional(),
    canDeposit: z.boolean().optional(),
    assetsWithBalance: z.number().optional(),
    assetList: z.array(z.object({
      asset: z.string(),
      free: z.number(),
      locked: z.number(),
    })).optional(),
    error: z.string().nullable(),
  }),
  execute: async (_input, execContext: MastraExecutionContext) => {
    // Context is extracted from Mastra's RequestContext
    const ctx = getGordonContext(execContext);
    const results: {
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
      llmConnected: !!ctx?.llm,
      binanceConnected: false,
      binancePermissions: null,
      accountType: null,
      error: null,
    };

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

        const nonZeroBalances = accountInfo.balances.filter(
          (b) => b.free > 0 || b.locked > 0
        );
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

const DIRECT_MODEL_TIERS: Record<DirectProviderName, { flagship: string; balanced: string; fast: string }> = DIRECT_MODELS;

export const getModelInfoTool = createTool({
  id: "get_model_info",
  description:
    "Get information about the current AI model and available providers. " +
    "Use when user asks 'what model am I using?', '/model', 'change model', 'show providers'",
  inputSchema: z.object({}),
  outputSchema: z.object({
    currentProvider: z.string(),
    currentModel: z.string(),
    hasDedalus: z.boolean(),
    directProviders: z.array(z.object({
      name: z.string(),
      configured: z.boolean(),
      models: z.object({
        flagship: z.string(),
        balanced: z.string(),
        fast: z.string(),
      }),
    })),
    dedalusModels: z.array(z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string(),
    })).optional(),
    tip: z.string(),
  }),
  execute: async () => {
    const config = await loadConfig().catch(() => null);
    const activeRoute = getActiveRoute();
    const currentProvider = config?.modelConfig?.provider || activeRoute.provider;
    const currentModel = config?.modelConfig?.model || activeRoute.modelString;
    const availableProviders = providerRegistry.getAvailableProviders();
    const hasDedalus = providerRegistry.hasDedalus();

    if (hasDedalus) {
      await refreshDedalusModels().catch(() => undefined);
    }

    const directProviders = (["openai", "anthropic", "google", "inception"] as DirectProviderName[]).map((name) => ({
      name,
      configured: availableProviders.includes(name),
      models: DIRECT_MODEL_TIERS[name],
    }));

    const dedalusModels = hasDedalus
      ? getDedalusModels().map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
        }))
      : undefined;

    return {
      currentProvider,
      currentModel,
      hasDedalus,
      directProviders,
      dedalusModels,
      tip: hasDedalus
        ? "Use /model to select from direct providers, Inception Mercury, or Dedalus models (xAI, Moonshot, etc.)"
        : "Set INCEPTION_API_KEY for Mercury 2 or DEDALUS_API_KEY for a multi-provider gateway",
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
    action: z.enum(["stats", "clear", "prune"]).default("stats")
      .describe("Action to perform: stats (show statistics), clear (reset cache), prune (remove expired)"),
  }),
  outputSchema: z.object({
    action: z.string(),
    stats: z.object({
      hits: z.number(),
      misses: z.number(),
      hitRate: z.number(),
      inFlightRequests: z.number(),
    }).optional(),
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
  recentErrors: z.array(z.object({
    timestamp: z.number(),
    errorType: z.string(),
    message: z.string(),
  })),
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
    agentName: z.string().optional()
      .describe("Optional specific agent name to get detailed metrics for (e.g., 'Analyst', 'Scanner')"),
    includeHandoffs: z.boolean().default(false)
      .describe("Include recent handoff history in the response"),
    format: z.enum(["json", "text"]).default("json")
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
    summary: z.object({
      overallHealth: z.enum(["healthy", "degraded", "unhealthy"]),
      healthScore: z.number(),
      totalAgents: z.number(),
      unhealthyCount: z.number(),
      topRecommendation: z.string().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ agentName, includeHandoffs, format }) => {
    try {
      // Dynamic import to break circular dependency
      const { getHandoffHistory } = await import("../orchestrator.ts");

      // If specific agent requested, return just that agent's metrics
      if (agentName) {
        const metrics = getAgentMetrics(agentName);
        const handoffs = includeHandoffs ? getHandoffHistory(10).filter(
          (h) => h.fromAgent === agentName || h.toAgent === agentName
        ) : undefined;

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
export const systemTools = {
  test_connection: testConnectionTool,
  get_model_info: getModelInfoTool,
  get_cache_stats: getCacheStatsTool,
  get_agent_health: getAgentHealthTool,
};

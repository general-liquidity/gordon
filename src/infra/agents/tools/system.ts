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

import { getGordonContext, MastraExecutionContext } from "./types.ts";
import { providerRegistry, DEDALUS_MODELS, type DirectProviderName } from "../../providers/registry.ts";

// ============================================================================
// Connection Test Tool
// ============================================================================

export const testConnectionTool = createTool({
  id: "test_connection",
  description:
    "Test the connection to Binance and verify API key permissions. " +
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

    if (!ctx?.binance) {
      results.error = "Binance client not initialized. Check BINANCE_API_KEY and BINANCE_API_SECRET in .env";
      return results;
    }

    try {
      const connected = await ctx.binance.testConnection();
      results.binanceConnected = connected;

      if (connected) {
        const accountInfo = await ctx.binance.getAccountInfo();
        results.accountType = accountInfo.accountType;
        results.canTrade = accountInfo.canTrade;
        results.canWithdraw = accountInfo.canWithdraw;
        results.canDeposit = accountInfo.canDeposit;

        const nonZeroBalances = accountInfo.balances.filter(
          (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
        );
        results.assetsWithBalance = nonZeroBalances.length;
        results.assetList = nonZeroBalances.map((b) => ({
          asset: b.asset,
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
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

const DIRECT_MODEL_TIERS: Record<DirectProviderName, { flagship: string; balanced: string; fast: string }> = {
  anthropic: {
    flagship: "claude-opus-4-5",
    balanced: "claude-sonnet-4-5",
    fast: "claude-haiku-4-5",
  },
  openai: {
    flagship: "gpt-5.2-pro",
    balanced: "gpt-5.2",
    fast: "gpt-5-mini",
  },
  google: {
    flagship: "gemini-3-pro-preview",
    balanced: "gemini-3-pro-preview",
    fast: "gemini-3-flash-preview",
  },
};

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
    const currentProvider = (process.env.GORDON_PROVIDER || "auto-detected") as string;
    const currentModel = process.env.GORDON_MODEL || "default (flagship)";
    const availableProviders = providerRegistry.getAvailableProviders();
    const hasDedalus = providerRegistry.hasDedalus();

    const directProviders = (["openai", "anthropic", "google"] as DirectProviderName[]).map((name) => ({
      name,
      configured: availableProviders.includes(name),
      models: DIRECT_MODEL_TIERS[name],
    }));

    const dedalusModels = hasDedalus
      ? DEDALUS_MODELS.map((m) => ({
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
        ? "Use /model to select from direct providers or Dedalus models (xAI, Moonshot, etc.)"
        : "Set DEDALUS_API_KEY to access models from multiple providers with one key",
    };
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
};

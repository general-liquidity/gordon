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
// Export as Object (Mastra format)
// ============================================================================

/**
 * System tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const systemTools = {
  test_connection: testConnectionTool,
};

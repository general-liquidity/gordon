/**
 * System Tools
 * Tools for testing connections and system diagnostics
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import type { ToolRunContext } from "./types.ts";

// ============================================================================
// Connection Test Tool
// ============================================================================

export const testConnectionTool = tool({
  name: "test_connection",
  description:
    "Test the connection to Binance and verify API key permissions. " +
    "Use when user asks 'test connection', 'check API', 'are my keys working?'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    const results: Record<string, unknown> = {
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

export const systemTools = [testConnectionTool];

/**
 * Position Tools (Mastra Format)
 * Tools for monitoring and managing open positions
 *
 * Migrated from OpenAI Agents SDK to Mastra format.
 * Key differences:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { runMonitorCycle, type MonitorResult } from "../../../core/monitor.ts";
import { getGordonContext, validateToolOutput, type MastraExecutionContext } from "./types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noBinance: { error: "Binance client not connected. Please run setup first." },
};

// ============================================================================
// Output Schemas (extracted for validation reuse)
// ============================================================================

const checkPositionsOutputSchema = z.object({
  openTrades: z.number(),
  totalUnrealizedPnl: z.number(),
  totalUnrealizedPnlPercent: z.number(),
  positions: z.array(
    z.object({
      symbol: z.string(),
      status: z.string(),
      unrealizedPnl: z.number(),
      unrealizedPnlPercent: z.number(),
    })
  ),
  alerts: z.array(z.string()),
  error: z.string().optional(),
});

// ============================================================================
// Position Monitor Tool
// ============================================================================

export const checkPositionsTool = createTool({
  id: "check_positions",
  description:
    "Check the status of all open positions and detect any alerts or anomalies. " +
    "Use this when the user asks 'how are my trades?' or 'check positions'",
  inputSchema: z.object({}),
  outputSchema: checkPositionsOutputSchema,
  execute: async (_input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return validateToolOutput(checkPositionsOutputSchema, {
        ...errors.noBinance,
        openTrades: 0,
        totalUnrealizedPnl: 0,
        totalUnrealizedPnlPercent: 0,
        positions: [],
        alerts: [],
      }, { toolName: "check_positions" });
    }

    const result: MonitorResult = await runMonitorCycle(ctx.binance);

    const totalUnrealizedPnl = result.updates.reduce((sum, u) => sum + u.unrealizedPnl, 0);
    const positions = result.updates.map((p) => ({
      symbol: p.trade.symbol,
      status: p.status,
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlPercent: p.unrealizedPnlPercent,
    }));

    const output = {
      openTrades: result.updates.length,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent: ctx.portfolioValue > 0 ? (totalUnrealizedPnl / ctx.portfolioValue) * 100 : 0,
      positions,
      alerts: result.alerts.map((a) => a.message),
    };

    return validateToolOutput(checkPositionsOutputSchema, output, { toolName: "check_positions" });
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Position tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const positionTools = {
  check_positions: checkPositionsTool,
};

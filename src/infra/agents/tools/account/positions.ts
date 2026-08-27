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

import { runMonitorCycle, type MonitorResult } from "../../../../core/pipeline/monitor.ts";
import { getGordonContext, validateToolOutput, type MastraExecutionContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "No active trading venue is connected. Please run setup first." },
};

// ============================================================================
// Output Schemas (extracted for validation reuse)
// ============================================================================

const checkPositionsOutputSchema = z.object({
  marketFamily: z.enum(["crypto", "stocks"]).optional(),
  venueRoute: z.enum(["exchange", "broker"]).optional(),
  quoteCurrency: z.string().optional(),
  capabilities: z
    .object({
      supportsQuotes: z.boolean(),
      supportsBidAsk: z.boolean(),
      supportsOrderBook: z.boolean(),
      supportsSessionCalendar: z.boolean(),
      supportsExtendedHours: z.boolean(),
      supportsHistoricalBars: z.boolean(),
    })
    .optional(),
  openTrades: z.number(),
  totalUnrealizedPnl: z.number(),
  totalUnrealizedPnlPercent: z.number(),
  positions: z.array(
    z.object({
      symbol: z.string(),
      status: z.string(),
      unrealizedPnl: z.number(),
      unrealizedPnlPercent: z.number(),
      minutesOpen: z.number(),
      ppmUsd: z.number(),
    }),
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
    "Check the status of all open positions with PnL and PPM (Profit Per Minute). " +
    "PPM measures trade efficiency — how fast a trade is generating profit. " +
    "Use this when the user asks 'how are my trades?' or 'check positions'",
  inputSchema: z.object({}),
  outputSchema: checkPositionsOutputSchema,
  execute: async (_input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return validateToolOutput(
        checkPositionsOutputSchema,
        {
          ...errors.noExchange,
          openTrades: 0,
          totalUnrealizedPnl: 0,
          totalUnrealizedPnlPercent: 0,
          positions: [],
          alerts: [],
        },
        { toolName: "check_positions" },
      );
    }

    if (ctx.broker && !ctx.exchange) {
      const positions = await ctx.broker.getPositions();
      const totalUnrealizedPnl = positions.reduce(
        (sum, position) => sum + position.unrealizedPl,
        0,
      );
      const output = {
        marketFamily: "stocks" as const,
        venueRoute: "broker" as const,
        quoteCurrency: "USD",
        capabilities: {
          supportsQuotes: true,
          supportsBidAsk: true,
          supportsOrderBook: false,
          supportsSessionCalendar: true,
          supportsExtendedHours: Boolean(ctx.broker.capabilities.supportsExtendedHours),
          supportsHistoricalBars: Boolean(ctx.broker.capabilities.supportsHistoricalBars),
        },
        openTrades: positions.length,
        totalUnrealizedPnl,
        totalUnrealizedPnlPercent:
          ctx.portfolioValue > 0 ? (totalUnrealizedPnl / ctx.portfolioValue) * 100 : 0,
        positions: positions.map((position) => ({
          symbol: position.symbol,
          status: position.side,
          unrealizedPnl: position.unrealizedPl,
          unrealizedPnlPercent: position.unrealizedPlPercent,
          minutesOpen: 0,
          ppmUsd: 0,
        })),
        alerts: [],
      };

      return validateToolOutput(checkPositionsOutputSchema, output, {
        toolName: "check_positions",
      });
    }

    const result: MonitorResult = await runMonitorCycle(ctx.exchange!);

    const now = Date.now();
    const totalUnrealizedPnl = result.updates.reduce((sum, u) => sum + u.unrealizedPnl, 0);
    const positions = result.updates.map((p) => {
      const openedMs = new Date(p.trade.openedAt).getTime();
      const minutesOpen = Math.max(1, (now - openedMs) / 60_000);
      const ppmUsd = p.unrealizedPnl / minutesOpen;
      return {
        symbol: p.trade.symbol,
        status: p.status,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
        minutesOpen: Math.round(minutesOpen),
        ppmUsd: Math.round(ppmUsd * 100) / 100,
      };
    });

    const output = {
      marketFamily: "crypto" as const,
      venueRoute: "exchange" as const,
      quoteCurrency: "USD",
      capabilities: {
        supportsQuotes: true,
        supportsBidAsk: true,
        supportsOrderBook: true,
        supportsSessionCalendar: false,
        supportsExtendedHours: false,
        supportsHistoricalBars: true,
      },
      openTrades: result.updates.length,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent:
        ctx.portfolioValue > 0 ? (totalUnrealizedPnl / ctx.portfolioValue) * 100 : 0,
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

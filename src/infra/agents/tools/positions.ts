/**
 * Position Tools
 * Tools for monitoring and managing open positions
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import { runMonitorCycle, type MonitorResult } from "../../../core/monitor.ts";
import type { ToolRunContext } from "./types.ts";
import { errors } from "./types.ts";

// ============================================================================
// Position Monitor Tool
// ============================================================================

export const checkPositionsTool = tool({
  name: "check_positions",
  description:
    "Check the status of all open positions and detect any alerts or anomalies. " +
    "Use this when the user asks 'how are my trades?' or 'check positions'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const result: MonitorResult = await runMonitorCycle(ctx.binance);

    const totalUnrealizedPnl = result.updates.reduce((sum, u) => sum + u.unrealizedPnl, 0);
    const positions = result.updates.map((p) => ({
      symbol: p.trade.symbol,
      status: p.status,
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlPercent: p.unrealizedPnlPercent,
    }));

    return {
      openTrades: result.updates.length,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent: ctx.portfolioValue > 0 ? (totalUnrealizedPnl / ctx.portfolioValue) * 100 : 0,
      positions,
      alerts: result.alerts.map((a) => a.message),
    };
  },
});

export const positionTools = [checkPositionsTool];

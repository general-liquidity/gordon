/**
 * Position Tracking Tools (Mastra Format)
 * Expose the Position State Machine to agents so each specialist can
 * drive positions through their lifecycle step.
 *
 *   Scanner  -> report_setup
 *   Analyst  -> report_analysis
 *   Planner  -> report_plan
 *   User     -> approve_position / reject_position
 *   Monitor  -> update_position_live
 *   Executor -> close_position_tracking (post-trade recording)
 *   Teacher  -> review_position
 *   Any      -> list_active_positions, get_position_detail
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getEventBus } from "../../../events/index.ts";
import { getPositionManager } from "../../../core/positions/index.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("position-tracking");

// ============================================================================
// Helper — lazily resolve the PositionManager singleton
// ============================================================================

async function getManager() {
  return getPositionManager(getEventBus());
}

// ============================================================================
// Output Schemas
// ============================================================================

const setupOutputSchema = z.object({
  positionId: z.string(),
  symbol: z.string(),
  state: z.string(),
  error: z.string().optional(),
});

const transitionOutputSchema = z.object({
  positionId: z.string(),
  state: z.string(),
  symbol: z.string().optional(),
  error: z.string().optional(),
});

const positionListOutputSchema = z.object({
  count: z.number(),
  positions: z.array(z.object({
    id: z.string(),
    symbol: z.string(),
    state: z.string(),
    side: z.string(),
    entryPrice: z.number().optional(),
    currentPrice: z.number().optional(),
    unrealizedPnL: z.number().optional(),
    realizedPnL: z.number().optional(),
    strategyId: z.string().optional(),
    createdAt: z.string(),
  })),
  error: z.string().optional(),
});

const positionDetailOutputSchema = z.object({
  position: z.any().optional(),
  summary: z.any().optional(),
  error: z.string().optional(),
});

const simpleResultSchema = z.object({
  success: z.boolean(),
  positionId: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

// ============================================================================
// 1. report_setup (Scanner)
// ============================================================================

export const reportSetupTool = createTool({
  id: "report_setup",
  description:
    "Record a new setup signal detected by the Scanner. Creates a position in the 'idea' state.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol, e.g. BTCUSDT"),
    timeframe: z.string().describe("Chart timeframe where setup was spotted, e.g. 4h"),
    strategy: z.string().describe("Strategy identifier, e.g. support_bounce"),
    confidence: z.number().min(0).max(1).describe("Confidence score 0-1"),
    conditions: z.string().describe("Human-readable description of setup conditions"),
    direction: z.enum(["long", "short"]).optional().describe("Bias direction if known"),
  }),
  outputSchema: setupOutputSchema,
  execute: async ({ symbol, timeframe, strategy, confidence, conditions, direction }) => {
    try {
      const mgr = await getManager();
      const position = await mgr.reportSetup({
        symbol,
        timeframe,
        strategy,
        confidence,
        setupType: conditions,
        notes: direction ? `Direction bias: ${direction}` : undefined,
      });

      logger.info("Setup recorded", { positionId: position.id, symbol });
      return {
        positionId: position.id,
        symbol: position.symbol,
        state: position.state,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("report_setup failed", { error: msg });
      return { positionId: "", symbol, state: "error", error: msg };
    }
  },
});

// ============================================================================
// 2. report_analysis (Analyst)
// ============================================================================

export const reportAnalysisTool = createTool({
  id: "report_analysis",
  description:
    "Record analysis results on an existing position. Transitions idea -> analyzed.",
  inputSchema: z.object({
    positionId: z.string().describe("Position ID to attach analysis to"),
    bias: z.enum(["bullish", "bearish", "neutral"]).describe("Directional bias"),
    confidence: z.number().min(0).max(1).describe("Analysis confidence 0-1"),
    supportLevels: z.array(z.number()).optional().describe("Key support price levels"),
    resistanceLevels: z.array(z.number()).optional().describe("Key resistance price levels"),
    notes: z.string().optional().describe("Additional analysis notes"),
  }),
  outputSchema: transitionOutputSchema,
  execute: async ({ positionId, bias, confidence, supportLevels, resistanceLevels, notes }) => {
    try {
      const mgr = await getManager();
      const position = await mgr.reportAnalysis(positionId, {
        bias,
        confidence,
        supportLevels,
        resistanceLevels,
        notes,
      });

      logger.info("Analysis recorded", { positionId, bias });
      return {
        positionId: position.id,
        state: position.state,
        symbol: position.symbol,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("report_analysis failed", { positionId, error: msg });
      return { positionId, state: "error", error: msg };
    }
  },
});

// ============================================================================
// 3. report_plan (Planner)
// ============================================================================

export const reportPlanTool = createTool({
  id: "report_plan",
  description:
    "Record a trade plan on an analyzed position. Transitions analyzed -> planned.",
  inputSchema: z.object({
    positionId: z.string().describe("Position ID to attach plan to"),
    entryPrice: z.number().describe("Planned entry price"),
    entryType: z.enum(["limit", "market"]).default("limit").describe("Order type for entry"),
    stopLoss: z.number().describe("Stop-loss price"),
    takeProfit: z.number().describe("Primary take-profit price"),
    positionSize: z.number().describe("Position size as percentage of portfolio (0-1)"),
    allocationAmount: z.number().describe("Dollar amount to allocate"),
    riskRewardRatio: z.number().optional().describe("Risk/reward ratio"),
    notes: z.string().optional().describe("Plan notes or reasoning"),
  }),
  outputSchema: transitionOutputSchema,
  execute: async ({ positionId, entryPrice, entryType, stopLoss, takeProfit, positionSize, allocationAmount, riskRewardRatio, notes }) => {
    try {
      const mgr = await getManager();
      const position = await mgr.reportPlan(positionId, {
        entry: entryPrice,
        entryType: entryType ?? "limit",
        stopLoss,
        takeProfits: [takeProfit],
        positionSizePct: positionSize,
        allocationAmount,
        riskRewardRatio,
        notes,
      });

      logger.info("Plan recorded", { positionId, entryPrice, stopLoss });
      return {
        positionId: position.id,
        state: position.state,
        symbol: position.symbol,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("report_plan failed", { positionId, error: msg });
      return { positionId, state: "error", error: msg };
    }
  },
});

// ============================================================================
// 4. approve_position / reject_position
// ============================================================================

export const approvePositionTool = createTool({
  id: "approve_position",
  description:
    "Approve a planned position for execution. Transitions planned -> approved.",
  inputSchema: z.object({
    positionId: z.string().describe("Position ID to approve"),
  }),
  outputSchema: simpleResultSchema,
  execute: async ({ positionId }) => {
    try {
      const mgr = await getManager();
      const position = await mgr.approve(positionId);

      logger.info("Position approved", { positionId });
      return { success: true, positionId: position.id, state: position.state };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("approve_position failed", { positionId, error: msg });
      return { success: false, positionId, error: msg };
    }
  },
});

export const rejectPositionTool = createTool({
  id: "reject_position",
  description:
    "Reject a planned position. Transitions planned -> rejected (terminal).",
  inputSchema: z.object({
    positionId: z.string().describe("Position ID to reject"),
    reason: z.string().describe("Reason for rejection"),
  }),
  outputSchema: simpleResultSchema,
  execute: async ({ positionId, reason }) => {
    try {
      const mgr = await getManager();
      const position = await mgr.reject(positionId, reason);

      logger.info("Position rejected", { positionId, reason });
      return { success: true, positionId: position.id, state: position.state };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("reject_position failed", { positionId, error: msg });
      return { success: false, positionId, error: msg };
    }
  },
});

// ============================================================================
// 5. list_active_positions
// ============================================================================

export const listActivePositionsTool = createTool({
  id: "list_active_positions",
  description:
    "List all active (non-terminal) positions across all states.",
  inputSchema: z.object({}),
  outputSchema: positionListOutputSchema,
  execute: async () => {
    try {
      const mgr = await getManager();
      const positions = await mgr.getActivePositions();

      return {
        count: positions.length,
        positions: positions.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          state: p.state,
          side: p.side,
          entryPrice: p.entryPrice,
          currentPrice: p.currentPrice,
          unrealizedPnL: p.unrealizedPnL,
          realizedPnL: p.realizedPnL,
          strategyId: p.strategyId,
          createdAt: p.createdAt,
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("list_active_positions failed", { error: msg });
      return { count: 0, positions: [], error: msg };
    }
  },
});

// ============================================================================
// 6. get_position_detail
// ============================================================================

export const getPositionDetailTool = createTool({
  id: "get_position_detail",
  description:
    "Get full details for a single position including state history and summary.",
  inputSchema: z.object({
    positionId: z.string().describe("Position ID to look up"),
  }),
  outputSchema: positionDetailOutputSchema,
  execute: async ({ positionId }) => {
    try {
      const mgr = await getManager();
      const position = await mgr.getPosition(positionId);

      if (!position) {
        return { error: `Position not found: ${positionId}` };
      }

      const summary = await mgr.getPositionSummary();

      return { position, summary };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("get_position_detail failed", { positionId, error: msg });
      return { error: msg };
    }
  },
});

// ============================================================================
// 7. update_position_live (Monitor)
// ============================================================================

export const updatePositionLiveTool = createTool({
  id: "update_position_live",
  description:
    "Update live market data on a monitoring position. Does not change state.",
  inputSchema: z.object({
    positionId: z.string().describe("Position ID to update"),
    currentPrice: z.number().describe("Current market price"),
    unrealizedPnl: z.number().optional().describe("Current unrealized PnL in dollars"),
    unrealizedPnlPercent: z.number().optional().describe("Current unrealized PnL as percentage"),
  }),
  outputSchema: simpleResultSchema,
  execute: async ({ positionId, currentPrice, unrealizedPnl, unrealizedPnlPercent }) => {
    try {
      const mgr = await getManager();
      const position = await mgr.updateLive(positionId, {
        currentPrice,
        unrealizedPnL: unrealizedPnl ?? 0,
        highWaterMark: currentPrice, // Let the state machine track the actual HWM
      });

      return { success: true, positionId: position.id, state: position.state };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("update_position_live failed", { positionId, error: msg });
      return { success: false, positionId, error: msg };
    }
  },
});

// ============================================================================
// 8. close_position_tracking (post-trade recording)
// ============================================================================

export const closePositionTrackingTool = createTool({
  id: "close_position_tracking",
  description:
    "Record that a position has been closed. Transitions monitoring/closing -> closed.",
  inputSchema: z.object({
    positionId: z.string().describe("Position ID to close"),
    exitPrice: z.number().describe("Actual exit/fill price"),
    realizedPnl: z.number().describe("Realized PnL in dollars"),
    realizedPnlPercent: z.number().optional().describe("Realized PnL as percentage"),
    fees: z.number().optional().describe("Total fees paid"),
    reason: z.string().optional().describe("Reason for closing (e.g. stop-loss, take-profit, manual)"),
  }),
  outputSchema: simpleResultSchema,
  execute: async ({ positionId, exitPrice, realizedPnl, realizedPnlPercent, fees, reason }) => {
    try {
      const mgr = await getManager();
      const position = await mgr.reportClosed(positionId, {
        exitPrice,
        realizedPnL: realizedPnl,
      });

      logger.info("Position closed", { positionId, exitPrice, realizedPnl });
      return { success: true, positionId: position.id, state: position.state };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("close_position_tracking failed", { positionId, error: msg });
      return { success: false, positionId, error: msg };
    }
  },
});

// ============================================================================
// 9. review_position (Teacher)
// ============================================================================

export const reviewPositionTool = createTool({
  id: "review_position",
  description:
    "Submit a post-trade review for a closed position. Transitions closed -> reviewed (terminal).",
  inputSchema: z.object({
    positionId: z.string().describe("Position ID to review"),
    rating: z.enum(["A", "B", "C", "D", "F"]).describe("Overall trade grade"),
    lessonsLearned: z.string().optional().describe("Key takeaways from this trade"),
    whatWentWell: z.string().optional().describe("Positive aspects of the trade"),
    whatWentWrong: z.string().optional().describe("Mistakes or issues encountered"),
    wouldTakeAgain: z.boolean().optional().describe("Whether this setup would be taken again"),
  }),
  outputSchema: simpleResultSchema,
  execute: async ({ positionId, rating, lessonsLearned, whatWentWell, whatWentWrong, wouldTakeAgain }) => {
    try {
      const mgr = await getManager();

      // Compose notes from structured fields
      const notesParts: string[] = [];
      if (whatWentWell) notesParts.push(`Went well: ${whatWentWell}`);
      if (whatWentWrong) notesParts.push(`Went wrong: ${whatWentWrong}`);
      if (wouldTakeAgain !== undefined) notesParts.push(`Would take again: ${wouldTakeAgain ? "yes" : "no"}`);

      const position = await mgr.reportReview(positionId, {
        grade: rating,
        lessonsLearned,
        notes: notesParts.length > 0 ? notesParts.join(". ") : undefined,
        reviewedAt: new Date().toISOString(),
      });

      logger.info("Review submitted", { positionId, rating });
      return { success: true, positionId: position.id, state: position.state };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("review_position failed", { positionId, error: msg });
      return { success: false, positionId, error: msg };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Position tracking tools exported as an object for Mastra Agent.
 * Assign subsets to the agents that own each lifecycle step.
 */
export const positionTrackingTools = {
  report_setup: reportSetupTool,
  report_analysis: reportAnalysisTool,
  report_plan: reportPlanTool,
  approve_position: approvePositionTool,
  reject_position: rejectPositionTool,
  list_active_positions: listActivePositionsTool,
  get_position_detail: getPositionDetailTool,
  update_position_live: updatePositionLiveTool,
  close_position_tracking: closePositionTrackingTool,
  review_position: reviewPositionTool,
};

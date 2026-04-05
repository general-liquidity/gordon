/**
 * Autonomous Trading Tools (Mastra Format)
 * Tools for controlling the autonomous swing trading execution loop
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "./types.ts";
import {
  createMandate,
  MANDATE_TIMEFRAMES,
  validateMandate,
  type SwingMandate,
} from "../../../core/swing-mandate.ts";
import {
  startAutonomousLoop,
  stopAutonomousLoop,
  pauseAutonomousLoop,
  resumeAutonomousLoop,
  getAutonomousLoopStatus,
} from "../../../core/autonomous-loop.ts";
import { loadMandateState, saveMandateState } from "../../../core/session-persistence.ts";
import { loadConfig } from "../../storage/config.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
  notArmed: (action: string) => ({
    error: `permissionMode must not be 'strict' to ${action}. Use /auto or /ask to enable trading.`,
  }),
};

// ============================================================================
// Create Mandate Tool
// ============================================================================

export const createSwingMandateTool = createTool({
  id: "create_swing_mandate",
  description:
    "Create a trading mandate that defines constraints for autonomous or signal-only scanning. " +
    "Shows a clear summary of all constraints before activating. " +
    "Use when user says 'set up autonomous trading', 'create a swing mandate', 'trade automatically'.",
  inputSchema: z.object({
    symbols: z
      .array(z.string())
      .default([])
      .describe("Symbols to trade (e.g., ['BTCUSDT', 'ETHUSDT']). Empty for all scanned symbols."),
    timeframe: z
      .enum(MANDATE_TIMEFRAMES)
      .default("4h")
      .describe("Primary timeframe for analysis and scanning"),
    executionTimeframe: z
      .enum(MANDATE_TIMEFRAMES)
      .optional()
      .describe("Optional lower timeframe used for entry signals (e.g., 5m)"),
    trendTimeframe: z
      .enum(MANDATE_TIMEFRAMES)
      .optional()
      .describe("Optional higher timeframe used as a trend filter (e.g., 15m or 1h)"),
    direction: z
      .enum(["long", "short", "both"])
      .default("long")
      .describe("Trading direction"),
    maxRiskPerTrade: z
      .number()
      .min(0.1)
      .max(10)
      .default(2.0)
      .describe("Max risk per trade as % of portfolio"),
    maxOpenPositions: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(3)
      .describe("Max concurrent open positions"),
    maxDrawdown: z
      .number()
      .min(1)
      .max(50)
      .default(5.0)
      .describe("Max total drawdown % before stopping"),
    maxDailyLoss: z
      .number()
      .min(1)
      .max(25)
      .default(3.0)
      .describe("Max daily loss % before pausing"),
    scanIntervalMinutes: z
      .number()
      .min(1)
      .max(1440)
      .default(60)
      .describe("Minutes between market scans"),
    minConfidence: z
      .number()
      .min(0)
      .max(1)
      .default(0.6)
      .describe("Minimum confidence score to act on (0-1)"),
    requireApproval: z
      .boolean()
      .default(true)
      .describe("Require user approval for each trade? (recommended: true)"),
    signalOnly: z
      .boolean()
      .default(true)
      .describe("When true, emit signals and rationale only. No autonomous execution is attempted."),
    durationHours: z
      .number()
      .min(1)
      .max(168)
      .default(24)
      .describe("How many hours the mandate should run (max 168 = 7 days)"),
    maxTradesPerSessionPerSymbol: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Optional cap on trades per symbol during this session"),
    stopAfterConsecutiveLosses: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Optional stop condition after a number of consecutive losses"),
    strategyNotes: z
      .string()
      .optional()
      .describe("Operator notes describing the setup logic to follow"),
    additionalFilters: z
      .array(z.string())
      .default([])
      .describe("Extra signal filters or execution reminders"),
  }),
  outputSchema: z.object({
    mandate: z.any().optional(),
    summary: z.string().optional(),
    validation: z.object({
      valid: z.boolean(),
      errors: z.array(z.string()),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async (input, _execContext: MastraExecutionContext) => {
    try {
      const expiresAt = new Date(Date.now() + input.durationHours * 60 * 60 * 1000).toISOString();

      const mandate = createMandate({
        symbols: input.symbols,
        timeframe: input.timeframe,
        executionTimeframe: input.executionTimeframe,
        trendTimeframe: input.trendTimeframe,
        direction: input.direction,
        maxRiskPerTrade: input.maxRiskPerTrade,
        maxOpenPositions: input.maxOpenPositions,
        maxDrawdown: input.maxDrawdown,
        maxDailyLoss: input.maxDailyLoss,
        scanIntervalMinutes: input.scanIntervalMinutes,
        minConfidence: input.minConfidence,
        requireApproval: input.requireApproval,
        signalOnly: input.signalOnly,
        expiresAt,
        maxTradesPerSessionPerSymbol: input.maxTradesPerSessionPerSymbol,
        stopAfterConsecutiveLosses: input.stopAfterConsecutiveLosses,
        strategyNotes: input.strategyNotes,
        additionalFilters: input.additionalFilters,
      });

      const validation = validateMandate(mandate);
      if (validation.valid) {
        saveMandateState(mandate);
      }

      const summary = [
        `Swing Trading Mandate: ${mandate.id}`,
        ``,
        `Scope:`,
        `  Symbols: ${mandate.symbols.length > 0 ? mandate.symbols.join(", ") : "All (top 50 by volume)"}`,
        `  Primary timeframe: ${mandate.executionTimeframe ?? mandate.timeframe}`,
        `  Trend timeframe: ${mandate.trendTimeframe ?? "Not specified"}`,
        `  Direction: ${mandate.direction}`,
        ``,
        `Risk Constraints:`,
        `  Max risk/trade: ${mandate.maxRiskPerTrade}%`,
        `  Max open positions: ${mandate.maxOpenPositions}`,
        `  Max drawdown: ${mandate.maxDrawdown}%`,
        `  Max daily loss: ${mandate.maxDailyLoss}%`,
        ``,
        `Execution:`,
        `  Scan every: ${mandate.scanIntervalMinutes} minutes`,
        `  Min confidence: ${(mandate.minConfidence * 100).toFixed(0)}%`,
        `  Require approval: ${mandate.requireApproval ? "YES" : "NO (fully autonomous)"}`,
        `  Signal only: ${mandate.signalOnly ? "YES" : "NO"}`,
        `  Max trades/symbol/session: ${mandate.maxTradesPerSessionPerSymbol ?? "Not set"}`,
        `  Stop after consecutive losses: ${mandate.stopAfterConsecutiveLosses ?? "Not set"}`,
        `  Expires: ${mandate.expiresAt}`,
        ...(mandate.strategyNotes ? ["", `Strategy Notes:`, `  ${mandate.strategyNotes}`] : []),
        ...(mandate.additionalFilters.length > 0
          ? ["", "Additional Filters:", ...mandate.additionalFilters.map((filter) => `  - ${filter}`)]
          : []),
        "",
        "Implementation note:",
        mandate.signalOnly
          ? "  Gordon will keep this in signal-only mode. Opportunities are surfaced for review and approval before any execution step."
          : "  Gordon will still respect approval and ARMED-mode requirements for any execution-capable follow-up.",
      ].join("\n");

      return { mandate, summary, validation };
    } catch (error) {
      return { error: `Failed to create mandate: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Start Autonomous Mode
// ============================================================================

export const startAutonomousModeTool = createTool({
  id: "start_autonomous_mode",
  description:
    "Start the autonomous swing trading loop with an active mandate. " +
    "Requires ARMED mode. The loop will scan markets at the mandate's interval and " +
    "find opportunities within the defined constraints. " +
    "Use after creating a mandate with create_swing_mandate.",
  inputSchema: z.object({
    mandateId: z
      .string()
      .optional()
      .describe("The mandate ID to activate (from create_swing_mandate)"),
    mandate: z
      .any()
      .optional()
      .describe("The full mandate object (pass the mandate from create_swing_mandate)"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    sessionId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ mandateId, mandate }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const effectiveConfig = await loadConfig().catch(() => ctx.config);
    if (effectiveConfig?.mode !== "ARMED") {
      return errors.notArmed("start autonomous trading");
    }

    const resolvedMandate = (mandate as SwingMandate | undefined) ?? loadMandateState();
    if (!resolvedMandate) {
      return { success: false, error: "No active mandate found. Create a mandate before starting autonomous mode." };
    }
    if (mandateId && resolvedMandate.id !== mandateId) {
      return {
        success: false,
        error: `Mandate mismatch. Requested ${mandateId}, but the active mandate is ${resolvedMandate.id}.`,
      };
    }

    try {
      const result = startAutonomousLoop({
        exchange: ctx.exchange,
        mandate: resolvedMandate,
        onOpportunityFound: async (opp) => {
          // Log the opportunity — actual execution happens through the agent pipeline
          console.log(`[Autonomous] Opportunity: ${opp.symbol} ${opp.direction} (${(opp.confidence * 100).toFixed(0)}% confidence)`);
          return false; // Default: don't auto-execute, let user approve
        },
        onMandateBreach: (reason) => {
          console.log(`[Autonomous] MANDATE BREACHED: ${reason}`);
        },
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      const status = getAutonomousLoopStatus();

      return {
        success: true,
        message: resolvedMandate.signalOnly
          ? `Signal-only autonomous mode started. Scanning every ${resolvedMandate.scanIntervalMinutes} minutes on ${resolvedMandate.executionTimeframe ?? resolvedMandate.timeframe}. Session: ${status.sessionId}`
          : `Autonomous mode started. Scanning every ${resolvedMandate.scanIntervalMinutes} minutes on ${resolvedMandate.executionTimeframe ?? resolvedMandate.timeframe}. Session: ${status.sessionId}`,
        sessionId: status.sessionId,
      };
    } catch (error) {
      return { error: `Failed to start autonomous mode: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Stop / Pause / Resume
// ============================================================================

export const stopAutonomousModeTool = createTool({
  id: "stop_autonomous_mode",
  description:
    "Stop the autonomous trading loop. Cancels the active mandate. " +
    "Use when user says 'stop autonomous', 'stop the bot', 'cancel mandate'.",
  inputSchema: z.object({
    reason: z.string().default("User requested stop").describe("Reason for stopping"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    finalStats: z.object({
      cycleCount: z.number(),
      totalOpportunities: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ reason }) => {
    const status = getAutonomousLoopStatus();
    if (!status.isRunning) {
      return { success: false, error: "Autonomous mode is not running." };
    }

    stopAutonomousLoop(reason);

    return {
      success: true,
      message: `Autonomous mode stopped. Reason: ${reason}`,
      finalStats: {
        cycleCount: status.cycleCount,
        totalOpportunities: status.totalOpportunities,
      },
    };
  },
});

// ============================================================================
// Get Status
// ============================================================================

export const getAutonomousStatusTool = createTool({
  id: "get_autonomous_status",
  description:
    "Get current status of the autonomous trading loop. " +
    "Shows mandate details, cycle count, opportunities found, and next scan time. " +
    "Use when user asks 'is autonomous running', 'mandate status', 'how is the bot doing'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    isRunning: z.boolean().optional(),
    isPaused: z.boolean().optional(),
    sessionId: z.string().optional(),
    cycleCount: z.number().optional(),
    totalOpportunities: z.number().optional(),
    lastCycleTime: z.string().nullable().optional(),
    nextCycleTime: z.string().nullable().optional(),
    mandate: z.any().optional(),
    message: z.string().optional(),
  }),
  execute: async () => {
    const status = getAutonomousLoopStatus();

    if (!status.isRunning) {
      return {
        isRunning: false,
        message: "Autonomous mode is not running. Use create_swing_mandate and start_autonomous_mode to begin.",
      };
    }

    return {
      isRunning: status.isRunning,
      isPaused: status.isPaused,
      sessionId: status.sessionId,
      cycleCount: status.cycleCount,
      totalOpportunities: status.totalOpportunities,
      lastCycleTime: status.lastCycleTime,
      nextCycleTime: status.nextCycleTime,
      mandate: status.mandate,
    };
  },
});

// ============================================================================
// Pause / Resume
// ============================================================================

export const pauseAutonomousModeTool = createTool({
  id: "pause_autonomous_mode",
  description: "Pause the autonomous loop without cancelling the mandate. Scans stop but state is preserved.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    const status = getAutonomousLoopStatus();
    if (!status.isRunning) {
      return { success: false, error: "Autonomous mode is not running." };
    }
    if (status.isPaused) {
      return { success: false, error: "Already paused." };
    }
    pauseAutonomousLoop();
    return { success: true, message: "Autonomous mode paused. Use resume to continue." };
  },
});

export const resumeAutonomousModeTool = createTool({
  id: "resume_autonomous_mode",
  description: "Resume a paused autonomous loop.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    const status = getAutonomousLoopStatus();
    if (!status.isRunning) {
      return { success: false, error: "Autonomous mode is not running." };
    }
    if (!status.isPaused) {
      return { success: false, error: "Not paused." };
    }
    resumeAutonomousLoop();
    return { success: true, message: "Autonomous mode resumed." };
  },
});

// ============================================================================
// Export
// ============================================================================

export const autonomousTools = {
  create_swing_mandate: createSwingMandateTool,
  start_autonomous_mode: startAutonomousModeTool,
  stop_autonomous_mode: stopAutonomousModeTool,
  get_autonomous_status: getAutonomousStatusTool,
  pause_autonomous_mode: pauseAutonomousModeTool,
  resume_autonomous_mode: resumeAutonomousModeTool,
};

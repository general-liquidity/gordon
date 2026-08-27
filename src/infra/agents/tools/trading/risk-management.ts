/**
 * Risk Management Tools (Mastra Format)
 *
 * Tools for advanced risk management including:
 * - Kelly Criterion position sizing
 * - Volatility-adjusted sizing
 * - Daily loss limits
 * - Exit condition checking
 * - Drawdown monitoring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  PositionSizer,
  DailyLimitTracker,
  ExitConditionChecker,
  DrawdownTracker,
} from "../../../../core/risk-management/index.ts";

// ============================================================================
// Kelly Criterion Position Sizing Tool
// ============================================================================

export const calculateKellySizeTool = createTool({
  id: "calculate_kelly_size",
  description:
    "Calculate optimal position size using Kelly Criterion based on historical win rate and average win/loss. " +
    "Kelly Criterion maximizes long-term growth while managing risk. " +
    "Use when you have trading history to optimize position sizing.",
  inputSchema: z.object({
    balance: z.number().positive().describe("Current account balance in USD"),
    winRate: z.number().min(0).max(1).describe("Historical win rate (0-1, e.g., 0.6 = 60%)"),
    avgWin: z.number().positive().describe("Average winning trade amount in USD"),
    avgLoss: z.number().positive().describe("Average losing trade amount in USD (positive number)"),
  }),
  outputSchema: z.object({
    kellyPercent: z.number(),
    adjustedPercent: z.number(),
    positionSize: z.number(),
    recommendation: z.string(),
    riskRewardRatio: z.number(),
    interpretation: z.string(),
  }),
  execute: async ({ balance, winRate, avgWin, avgLoss }) => {
    const sizer = new PositionSizer();
    const result = sizer.calculateWithKelly(balance, winRate, avgWin, avgLoss);

    const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

    let interpretation: string;
    if (result.kellyPercent <= 0) {
      interpretation =
        "Negative edge detected. Either improve win rate or risk/reward ratio before trading.";
    } else if (result.kellyPercent > 25) {
      interpretation = `Full Kelly suggests ${result.kellyPercent.toFixed(1)}% which is aggressive. Using capped 25% for safety. Consider half-Kelly (${(result.kellyPercent / 2).toFixed(1)}%) for more conservative sizing.`;
    } else if (result.kellyPercent < 5) {
      interpretation = `Low Kelly percentage suggests small edge. Consider whether trading costs are worth it.`;
    } else {
      interpretation = `Healthy Kelly percentage. Position size of $${result.positionSize.toFixed(2)} balances growth and risk.`;
    }

    return {
      kellyPercent: result.kellyPercent,
      adjustedPercent: result.adjustedPercent,
      positionSize: result.positionSize,
      recommendation: result.recommendation,
      riskRewardRatio,
      interpretation,
    };
  },
});

// ============================================================================
// Volatility-Adjusted Position Sizing Tool
// ============================================================================

export const calculateVolatilityAdjustedSizeTool = createTool({
  id: "calculate_volatility_adjusted_size",
  description:
    "Calculate position size adjusted for market volatility. " +
    "Higher volatility = smaller position to maintain consistent risk. " +
    "Use when entering volatile markets or during high-volatility periods.",
  inputSchema: z.object({
    balance: z.number().positive().describe("Current account balance in USD"),
    stopLossPercent: z
      .number()
      .positive()
      .describe("Stop loss distance as percentage (e.g., 5 = 5%)"),
    volatility: z
      .number()
      .min(0)
      .max(2)
      .describe(
        "Volatility measure (0-1 scale, e.g., 0.3 = 30% volatility, can exceed 1 for extreme volatility)",
      ),
    riskPercent: z
      .number()
      .min(0.1)
      .max(10)
      .default(2)
      .describe("Risk per trade as percentage of balance (default 2%)"),
  }),
  outputSchema: z.object({
    baseSize: z.number(),
    adjustedSize: z.number(),
    adjustmentFactor: z.number(),
    volatility: z.number(),
    reduction: z.string(),
    interpretation: z.string(),
  }),
  execute: async ({ balance, stopLossPercent, volatility, riskPercent }) => {
    const sizer = new PositionSizer({ riskPerTradePercent: riskPercent });
    const result = sizer.calculateVolatilityAdjusted(balance, stopLossPercent, volatility);

    const reductionPercent = ((1 - result.adjustmentFactor) * 100).toFixed(0);

    let interpretation: string;
    if (volatility < 0.1) {
      interpretation = `Low volatility (${(volatility * 100).toFixed(0)}%). Minimal position adjustment needed.`;
    } else if (volatility < 0.3) {
      interpretation = `Moderate volatility (${(volatility * 100).toFixed(0)}%). Position reduced by ${reductionPercent}% to maintain risk.`;
    } else if (volatility < 0.5) {
      interpretation = `High volatility (${(volatility * 100).toFixed(0)}%). Position significantly reduced. Consider waiting for calmer conditions.`;
    } else {
      interpretation = `Extreme volatility (${(volatility * 100).toFixed(0)}%). Position heavily reduced. Exercise caution.`;
    }

    return {
      baseSize: result.baseSize,
      adjustedSize: result.adjustedSize,
      adjustmentFactor: result.adjustmentFactor,
      volatility,
      reduction: `${reductionPercent}%`,
      interpretation,
    };
  },
});

// ============================================================================
// Daily Loss Limit Tool
// ============================================================================

export const checkDailyLimitTool = createTool({
  id: "check_daily_limit",
  description:
    "Check current daily P&L status against loss limits. " +
    "Tracks realized P&L and determines if trading should continue. " +
    "Use before opening new positions to ensure daily limits aren't exceeded.",
  inputSchema: z.object({
    startingBalance: z
      .number()
      .positive()
      .optional()
      .describe("Starting balance for percentage calculations"),
    unrealizedPnL: z.number().default(0).describe("Current unrealized P&L across all positions"),
    dailyLossLimitUsd: z.number().positive().default(500).describe("Maximum daily loss in USD"),
    dailyLossLimitPercent: z
      .number()
      .positive()
      .default(5)
      .describe("Maximum daily loss as percentage of balance"),
  }),
  outputSchema: z.object({
    date: z.string(),
    realizedPnL: z.number(),
    unrealizedPnL: z.number(),
    totalPnL: z.number(),
    dailyLimit: z.number(),
    percentOfLimit: z.number(),
    tradingAllowed: z.boolean(),
    remainingAllowance: z.number(),
    status: z.string(),
    message: z.string(),
  }),
  execute: async ({ startingBalance, unrealizedPnL, dailyLossLimitUsd, dailyLossLimitPercent }) => {
    const tracker = new DailyLimitTracker({
      dailyLossLimitUsd,
      dailyLossLimitPercent,
    });

    const status = tracker.getStatus(startingBalance, unrealizedPnL);

    return {
      date: status.date,
      realizedPnL: status.realizedPnL,
      unrealizedPnL: status.unrealizedPnL,
      totalPnL: status.totalPnL,
      dailyLimit: status.dailyLimit,
      percentOfLimit: status.percentOfLimit,
      tradingAllowed: status.tradingAllowed,
      remainingAllowance: status.remainingAllowance,
      status: status.isLimitExceeded ? "EXCEEDED" : status.isWarning ? "WARNING" : "OK",
      message: status.message,
    };
  },
});

// ============================================================================
// Exit Condition Checker Tool
// ============================================================================

export const checkExitConditionsTool = createTool({
  id: "check_exit_conditions",
  description:
    "Check if a position should be exited based on multiple conditions: " +
    "PnL thresholds (take profit/stop loss), PnL rate (bleeding too fast), " +
    "and time held (position too old). Returns combined exit signals.",
  inputSchema: z.object({
    entryPrice: z.number().positive().describe("Entry price of position"),
    currentPrice: z.number().positive().describe("Current market price"),
    side: z.enum(["buy", "sell"]).describe("Position side"),
    entryTime: z.string().describe("Entry time (ISO format or timestamp)"),
    quantity: z
      .number()
      .positive()
      .optional()
      .describe("Position quantity for USD P&L calculation"),
    targetPercent: z.number().default(8).describe("Take profit target percentage"),
    stopLossPercent: z.number().default(-5).describe("Stop loss percentage (negative)"),
    maxMinutesInPosition: z.number().default(240).describe("Maximum minutes to hold position"),
  }),
  outputSchema: z.object({
    shouldExit: z.boolean(),
    primaryReason: z.string().nullable(),
    urgency: z.enum(["low", "medium", "high", "critical"]),
    pnlPercent: z.number(),
    pnlUsd: z.number().nullable(),
    minutesHeld: z.number(),
    signals: z.array(
      z.object({
        type: z.string(),
        shouldExit: z.boolean(),
        reason: z.string().nullable(),
        urgency: z.string(),
      }),
    ),
    interpretation: z.string(),
  }),
  execute: async ({
    entryPrice,
    currentPrice,
    side,
    entryTime,
    quantity,
    targetPercent,
    stopLossPercent,
    maxMinutesInPosition,
  }) => {
    const checker = new ExitConditionChecker({
      pnl: { targetPercent, maxLossPercent: stopLossPercent },
      time: { maxMinutesInPosition, warningMinutes: 30 },
    });

    const result = checker.checkAllExitConditions({
      entryPrice,
      currentPrice,
      side,
      entryTime,
      quantity,
    });

    // Calculate PnL for response
    const isLong = side === "buy";
    const priceDiff = isLong ? currentPrice - entryPrice : entryPrice - currentPrice;
    const pnlPercent = (priceDiff / entryPrice) * 100;
    const pnlUsd = quantity ? priceDiff * quantity : null;

    // Calculate minutes held
    const entryDate = new Date(entryTime);
    const minutesHeld = (Date.now() - entryDate.getTime()) / (1000 * 60);

    // Format signals for response
    const signals = result.signals.map((s, i) => ({
      type: i === 0 ? "pnl_threshold" : i === 1 ? "pnl_rate" : "time",
      shouldExit: s.shouldExit,
      reason: s.reason,
      urgency: s.urgency,
    }));

    let interpretation: string;
    if (result.shouldExit) {
      interpretation = `EXIT RECOMMENDED (${result.urgency}): ${result.primaryReason}`;
    } else if (result.urgency === "medium") {
      interpretation = `Position has warnings but no immediate exit needed. Monitor closely.`;
    } else {
      interpretation = `Position is healthy. P&L: ${pnlPercent.toFixed(2)}%, held ${minutesHeld.toFixed(0)} minutes.`;
    }

    return {
      shouldExit: result.shouldExit,
      primaryReason: result.primaryReason,
      urgency: result.urgency,
      pnlPercent,
      pnlUsd,
      minutesHeld,
      signals,
      interpretation,
    };
  },
});

// ============================================================================
// Drawdown Status Tool
// ============================================================================

export const checkDrawdownStatusTool = createTool({
  id: "check_drawdown_status",
  description:
    "Check current portfolio drawdown status and get trading recommendations. " +
    "Tracks drawdown from peak balance and adjusts position sizing accordingly. " +
    "Use to monitor portfolio health and determine if trading should continue.",
  inputSchema: z.object({
    currentBalance: z.number().positive().describe("Current portfolio balance in USD"),
    peakBalance: z.number().positive().describe("Peak portfolio balance (highest point)"),
    maxDrawdownPercent: z.number().default(20).describe("Maximum allowed drawdown percentage"),
    warningDrawdownPercent: z.number().default(10).describe("Warning threshold percentage"),
  }),
  outputSchema: z.object({
    currentBalance: z.number(),
    peakBalance: z.number(),
    drawdownAmount: z.number(),
    drawdownPercent: z.number(),
    recoveryNeeded: z.number(),
    status: z.enum(["healthy", "warning", "critical", "exceeded"]),
    tradingAllowed: z.boolean(),
    sizeMultiplier: z.number(),
    message: z.string(),
    interpretation: z.string(),
  }),
  execute: async ({ currentBalance, peakBalance, maxDrawdownPercent, warningDrawdownPercent }) => {
    const tracker = new DrawdownTracker({
      maxDrawdownPercent,
      warningDrawdownPercent,
      reduceSizeAtPercent: warningDrawdownPercent / 2,
      sizeReductionFactor: 0.5,
    });

    // Initialize with peak and update with current
    tracker.initialize(peakBalance);
    const status = tracker.updateBalance(currentBalance);

    let interpretation: string;
    if (status.status === "exceeded") {
      interpretation = `Portfolio is in severe drawdown. Trading halted to prevent further losses. Wait for recovery or manual intervention.`;
    } else if (status.status === "critical") {
      interpretation = `Critical drawdown level. Position sizes reduced to ${(status.sizeMultiplier * 100).toFixed(0)}%. Focus on capital preservation.`;
    } else if (status.status === "warning") {
      interpretation = `Drawdown warning. Position sizes reduced. Consider reducing risk exposure.`;
    } else if (status.drawdownPercent > 0) {
      interpretation = `Minor drawdown of ${status.drawdownPercent.toFixed(1)}%. Trading normally with full position sizes.`;
    } else {
      interpretation = `Portfolio at or above peak. Trading normally.`;
    }

    return {
      ...status,
      interpretation,
    };
  },
});

// ============================================================================
// Risk Assessment Tool
// ============================================================================

export const assessTradeRiskTool = createTool({
  id: "assess_trade_risk",
  description:
    "Comprehensive risk assessment before entering a trade. " +
    "Combines daily limits, drawdown status, and position sizing to determine if trade is allowed " +
    "and what size is appropriate.",
  inputSchema: z.object({
    balance: z.number().positive().describe("Current account balance"),
    peakBalance: z.number().positive().describe("Peak balance for drawdown calculation"),
    proposedSize: z.number().positive().describe("Proposed position size in USD"),
    stopLossPercent: z.number().positive().describe("Stop loss percentage"),
    dailyPnL: z.number().default(0).describe("Today's realized P&L"),
    dailyLossLimit: z.number().default(500).describe("Daily loss limit in USD"),
  }),
  outputSchema: z.object({
    tradeAllowed: z.boolean(),
    adjustedSize: z.number(),
    reasons: z.array(z.string()),
    riskScore: z.number(),
    riskLevel: z.enum(["low", "medium", "high", "extreme"]),
    checks: z.object({
      dailyLimitOk: z.boolean(),
      drawdownOk: z.boolean(),
      sizeOk: z.boolean(),
    }),
    recommendation: z.string(),
  }),
  execute: async ({
    balance,
    peakBalance,
    proposedSize,
    stopLossPercent,
    dailyPnL,
    dailyLossLimit,
  }) => {
    const reasons: string[] = [];
    let tradeAllowed = true;
    let adjustedSize = proposedSize;

    // Check daily limit
    const dailyTracker = new DailyLimitTracker({ dailyLossLimitUsd: dailyLossLimit });
    // Simulate today's P&L
    if (dailyPnL !== 0) {
      dailyTracker.recordTrade("SIMULATION", dailyPnL);
    }
    const dailyStatus = dailyTracker.getStatus(balance);

    const dailyLimitOk = dailyStatus.tradingAllowed;
    if (!dailyLimitOk) {
      tradeAllowed = false;
      reasons.push(`Daily loss limit exceeded: ${dailyStatus.message}`);
    }

    // Check potential loss against remaining allowance
    const potentialLoss = proposedSize * (stopLossPercent / 100);
    if (potentialLoss > dailyStatus.remainingAllowance) {
      const maxSize = (dailyStatus.remainingAllowance / stopLossPercent) * 100;
      adjustedSize = Math.min(adjustedSize, maxSize);
      reasons.push(
        `Size reduced to stay within daily limit. Max loss: $${dailyStatus.remainingAllowance.toFixed(2)}`,
      );
    }

    // Check drawdown
    const drawdownTracker = new DrawdownTracker();
    drawdownTracker.initialize(peakBalance);
    const drawdownStatus = drawdownTracker.updateBalance(balance);

    const drawdownOk = drawdownStatus.tradingAllowed;
    if (!drawdownOk) {
      tradeAllowed = false;
      reasons.push(`Drawdown limit exceeded: ${drawdownStatus.message}`);
    } else if (drawdownStatus.sizeMultiplier < 1) {
      adjustedSize = adjustedSize * drawdownStatus.sizeMultiplier;
      reasons.push(`Size reduced due to drawdown: ${drawdownStatus.message}`);
    }

    // Check size vs balance
    const sizeOk = proposedSize <= balance * 0.5; // Max 50% of balance
    if (!sizeOk) {
      adjustedSize = Math.min(adjustedSize, balance * 0.5);
      reasons.push(`Size exceeds 50% of balance. Reduced for safety.`);
    }

    // Calculate risk score (0-100)
    let riskScore = 0;
    riskScore += (1 - dailyStatus.remainingAllowance / dailyLossLimit) * 30;
    riskScore += drawdownStatus.drawdownPercent * 2;
    riskScore += (proposedSize / balance) * 40;
    riskScore = Math.min(100, Math.max(0, riskScore));

    const riskLevel: "low" | "medium" | "high" | "extreme" =
      riskScore < 25 ? "low" : riskScore < 50 ? "medium" : riskScore < 75 ? "high" : "extreme";

    // Generate recommendation
    let recommendation: string;
    if (!tradeAllowed) {
      recommendation = `Trade NOT allowed. ${reasons.join(" ")}`;
    } else if (adjustedSize < proposedSize) {
      recommendation = `Trade allowed with reduced size: $${adjustedSize.toFixed(2)} (originally $${proposedSize.toFixed(2)}).`;
    } else if (riskLevel === "high") {
      recommendation = "Trade allowed but risk is elevated. Consider smaller size.";
    } else {
      recommendation = `Trade allowed at full size. Risk level: ${riskLevel}.`;
    }

    return {
      tradeAllowed,
      adjustedSize,
      reasons: reasons.length > 0 ? reasons : ["All risk checks passed"],
      riskScore,
      riskLevel,
      checks: {
        dailyLimitOk,
        drawdownOk,
        sizeOk,
      },
      recommendation,
    };
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const riskManagementTools = {
  calculate_kelly_size: calculateKellySizeTool,
  calculate_volatility_adjusted_size: calculateVolatilityAdjustedSizeTool,
  check_daily_limit: checkDailyLimitTool,
  check_exit_conditions: checkExitConditionsTool,
  check_drawdown_status: checkDrawdownStatusTool,
  assess_trade_risk: assessTradeRiskTool,
};

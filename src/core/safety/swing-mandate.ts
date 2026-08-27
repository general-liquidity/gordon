/**
 * Swing Trading Mandate
 * Defines constraints and rules for autonomous swing trading sessions
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("swing-mandate");

export const MANDATE_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type MandateTimeframe = (typeof MANDATE_TIMEFRAMES)[number];

// ============================================================================
// Types
// ============================================================================

export interface SwingMandate {
  /** Unique mandate ID */
  id: string;
  /** Creation timestamp */
  createdAt: string;
  /** Mandate status */
  status: "active" | "paused" | "completed" | "cancelled";

  // === Scope ===
  /** Symbols to trade (empty = all scanned) */
  symbols: string[];
  /** Primary timeframe for analysis/scanning */
  timeframe: MandateTimeframe;
  /** Lower timeframe used for execution triggers, if different from the primary timeframe */
  executionTimeframe?: MandateTimeframe;
  /** Higher timeframe used as a trend filter, if configured */
  trendTimeframe?: MandateTimeframe;
  /** Which side: long, short, or both */
  direction: "long" | "short" | "both";

  // === Risk Constraints ===
  /** Max risk per trade as % of portfolio (e.g., 2.0 = 2%) */
  maxRiskPerTrade: number;
  /** Max concurrent open positions */
  maxOpenPositions: number;
  /** Max total drawdown % before stopping */
  maxDrawdown: number;
  /** Max daily loss % before pausing */
  maxDailyLoss: number;

  // === Execution ===
  /** Scan interval in minutes */
  scanIntervalMinutes: number;
  /** Minimum confidence score to act on (0-1) */
  minConfidence: number;
  /** Require user approval for each trade? */
  requireApproval: boolean;
  /** Keep the loop in signal-only mode without autonomous execution */
  signalOnly: boolean;
  /** Mandate expiry (ISO timestamp) */
  expiresAt: string;
  /** Optional cap on trades per symbol during this session */
  maxTradesPerSessionPerSymbol?: number;
  /** Optional stop condition for consecutive losing trades */
  stopAfterConsecutiveLosses?: number;
  /** Operator notes describing the intended strategy */
  strategyNotes?: string;
  /** Extra filters or reminders attached to the mandate */
  additionalFilters: string[];

  // === Tracking ===
  /** Trades executed under this mandate */
  tradesExecuted: number;
  /** Current consecutive losing-trade streak */
  consecutiveLosses: number;
  /** Current session P&L */
  currentPnl: number;
  /** Peak P&L (for drawdown calculation) */
  peakPnl: number;
  /** Daily P&L tracking */
  dailyPnl: number;
  /** Date of daily P&L reset */
  dailyPnlDate: string;
}

// ============================================================================
// Mandate Management
// ============================================================================

export function createMandate(params: Partial<SwingMandate>): SwingMandate {
  const now = new Date();
  const defaultExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h default

  const mandate: SwingMandate = {
    id: `mandate_${now.getTime()}`,
    createdAt: now.toISOString(),
    status: "active",
    symbols: params.symbols ?? [],
    timeframe: params.timeframe ?? params.executionTimeframe ?? "4h",
    executionTimeframe: params.executionTimeframe ?? params.timeframe ?? "4h",
    trendTimeframe: params.trendTimeframe,
    direction: params.direction ?? "long",
    maxRiskPerTrade: params.maxRiskPerTrade ?? 2.0,
    maxOpenPositions: params.maxOpenPositions ?? 3,
    maxDrawdown: params.maxDrawdown ?? 5.0,
    maxDailyLoss: params.maxDailyLoss ?? 3.0,
    scanIntervalMinutes: params.scanIntervalMinutes ?? 60,
    minConfidence: params.minConfidence ?? 0.6,
    requireApproval: params.requireApproval ?? true,
    signalOnly: params.signalOnly ?? params.requireApproval ?? true,
    expiresAt: params.expiresAt ?? defaultExpiry.toISOString(),
    maxTradesPerSessionPerSymbol: params.maxTradesPerSessionPerSymbol,
    stopAfterConsecutiveLosses: params.stopAfterConsecutiveLosses,
    strategyNotes: params.strategyNotes,
    additionalFilters: params.additionalFilters ?? [],
    tradesExecuted: 0,
    consecutiveLosses: 0,
    currentPnl: 0,
    peakPnl: 0,
    dailyPnl: 0,
    dailyPnlDate: now.toISOString().split("T")[0]!,
    ...params,
  };

  logger.info("Mandate created", {
    id: mandate.id,
    symbols: mandate.symbols,
    timeframe: mandate.timeframe,
    maxRiskPerTrade: mandate.maxRiskPerTrade,
    expiresAt: mandate.expiresAt,
  });

  return mandate;
}

export function validateMandate(mandate: SwingMandate): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (mandate.maxRiskPerTrade <= 0 || mandate.maxRiskPerTrade > 10) {
    errors.push("maxRiskPerTrade must be between 0 and 10%");
  }
  if (mandate.maxOpenPositions < 1 || mandate.maxOpenPositions > 20) {
    errors.push("maxOpenPositions must be between 1 and 20");
  }
  if (mandate.maxDrawdown <= 0 || mandate.maxDrawdown > 50) {
    errors.push("maxDrawdown must be between 0 and 50%");
  }
  if (mandate.maxDailyLoss <= 0 || mandate.maxDailyLoss > 25) {
    errors.push("maxDailyLoss must be between 0 and 25%");
  }
  if (mandate.scanIntervalMinutes < 1 || mandate.scanIntervalMinutes > 1440) {
    errors.push("scanIntervalMinutes must be between 1 and 1440 (24h)");
  }
  if (mandate.minConfidence < 0 || mandate.minConfidence > 1) {
    errors.push("minConfidence must be between 0 and 1");
  }
  if (!MANDATE_TIMEFRAMES.includes(mandate.timeframe)) {
    errors.push(`timeframe must be one of: ${MANDATE_TIMEFRAMES.join(", ")}`);
  }
  if (mandate.executionTimeframe && !MANDATE_TIMEFRAMES.includes(mandate.executionTimeframe)) {
    errors.push(`executionTimeframe must be one of: ${MANDATE_TIMEFRAMES.join(", ")}`);
  }
  if (mandate.trendTimeframe && !MANDATE_TIMEFRAMES.includes(mandate.trendTimeframe)) {
    errors.push(`trendTimeframe must be one of: ${MANDATE_TIMEFRAMES.join(", ")}`);
  }
  if (
    mandate.maxTradesPerSessionPerSymbol !== undefined &&
    (mandate.maxTradesPerSessionPerSymbol < 1 || mandate.maxTradesPerSessionPerSymbol > 100)
  ) {
    errors.push("maxTradesPerSessionPerSymbol must be between 1 and 100");
  }
  if (
    mandate.stopAfterConsecutiveLosses !== undefined &&
    (mandate.stopAfterConsecutiveLosses < 1 || mandate.stopAfterConsecutiveLosses > 20)
  ) {
    errors.push("stopAfterConsecutiveLosses must be between 1 and 20");
  }

  const expiresAt = new Date(mandate.expiresAt);
  if (expiresAt.getTime() <= Date.now()) {
    errors.push("expiresAt must be in the future");
  }

  return { valid: errors.length === 0, errors };
}

export function isMandateExpired(mandate: SwingMandate): boolean {
  return new Date(mandate.expiresAt).getTime() <= Date.now();
}

export function isMandateBreached(mandate: SwingMandate): { breached: boolean; reason?: string } {
  // Check total drawdown
  if (mandate.peakPnl > 0) {
    const drawdownPercent = ((mandate.peakPnl - mandate.currentPnl) / mandate.peakPnl) * 100;
    if (drawdownPercent >= mandate.maxDrawdown) {
      return {
        breached: true,
        reason: `Max drawdown breached: ${drawdownPercent.toFixed(2)}% >= ${mandate.maxDrawdown}%`,
      };
    }
  }

  // Check absolute drawdown from zero
  if (mandate.currentPnl < 0) {
    const absDrawdown = Math.abs(mandate.currentPnl);
    // Use maxDrawdown as absolute % threshold too
    if (absDrawdown >= mandate.maxDrawdown) {
      return {
        breached: true,
        reason: `Absolute loss breached: ${absDrawdown.toFixed(2)}% >= ${mandate.maxDrawdown}%`,
      };
    }
  }

  // Check daily loss (reset if new day)
  const today = new Date().toISOString().split("T")[0]!;
  const dailyPnl = mandate.dailyPnlDate === today ? mandate.dailyPnl : 0;
  if (dailyPnl < 0 && Math.abs(dailyPnl) >= mandate.maxDailyLoss) {
    return {
      breached: true,
      reason: `Daily loss limit breached: ${Math.abs(dailyPnl).toFixed(2)}% >= ${mandate.maxDailyLoss}%`,
    };
  }
  if (
    mandate.stopAfterConsecutiveLosses !== undefined &&
    mandate.consecutiveLosses >= mandate.stopAfterConsecutiveLosses
  ) {
    return {
      breached: true,
      reason: `Consecutive loss limit breached: ${mandate.consecutiveLosses} >= ${mandate.stopAfterConsecutiveLosses}`,
    };
  }

  return { breached: false };
}

export function updateMandateTracking(mandate: SwingMandate, pnlDelta: number): SwingMandate {
  const today = new Date().toISOString().split("T")[0]!;

  // Reset daily P&L if new day
  const dailyPnl = mandate.dailyPnlDate === today ? mandate.dailyPnl + pnlDelta : pnlDelta;

  const newPnl = mandate.currentPnl + pnlDelta;
  const newPeak = Math.max(mandate.peakPnl, newPnl);
  const consecutiveLosses = pnlDelta < 0 ? mandate.consecutiveLosses + 1 : 0;

  return {
    ...mandate,
    currentPnl: newPnl,
    peakPnl: newPeak,
    dailyPnl,
    dailyPnlDate: today,
    tradesExecuted: mandate.tradesExecuted + 1,
    consecutiveLosses,
  };
}

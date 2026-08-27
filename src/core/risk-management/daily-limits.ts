/**
 * Daily Loss Limits
 *
 * Track and enforce daily loss limits to prevent
 * catastrophic losses in a single trading day.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("daily-limits");

// ============================================================================
// Types
// ============================================================================

export interface DailyLimitConfig {
  dailyLossLimitUsd: number; // Max loss in USD per day
  dailyLossLimitPercent: number; // Max loss as % of starting balance
  warningThresholdPercent: number; // Warn when this % of limit is reached
}

export interface DailyPnLStatus {
  date: string;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  dailyLimit: number;
  percentOfLimit: number;
  isLimitExceeded: boolean;
  isWarning: boolean;
  tradingAllowed: boolean;
  remainingAllowance: number;
  message: string;
}

export interface TradeRecord {
  timestamp: Date;
  symbol: string;
  pnl: number;
  type: "realized" | "unrealized";
}

// ============================================================================
// Daily Limit Tracker
// ============================================================================

export class DailyLimitTracker {
  private config: DailyLimitConfig;
  private todaysPnL: number = 0;
  private todaysDate: string = "";
  private trades: TradeRecord[] = [];

  constructor(config?: Partial<DailyLimitConfig>) {
    this.config = {
      dailyLossLimitUsd: config?.dailyLossLimitUsd ?? 500,
      dailyLossLimitPercent: config?.dailyLossLimitPercent ?? 5,
      warningThresholdPercent: config?.warningThresholdPercent ?? 80,
    };
    this.resetIfNewDay();
  }

  /**
   * Reset tracking if it's a new day
   */
  private resetIfNewDay(): void {
    const today = new Date().toISOString().split("T")[0]!;
    if (today !== this.todaysDate) {
      this.todaysDate = today;
      this.todaysPnL = 0;
      this.trades = [];
      logger.debug("Daily limit tracker reset for new day", { date: today });
    }
  }

  /**
   * Record a trade's PnL
   */
  recordTrade(symbol: string, pnl: number, type: "realized" | "unrealized" = "realized"): void {
    this.resetIfNewDay();

    if (type === "realized") {
      this.todaysPnL += pnl;
    }

    this.trades.push({
      timestamp: new Date(),
      symbol,
      pnl,
      type,
    });

    logger.debug("Trade recorded", { symbol, pnl, type, todaysPnL: this.todaysPnL });
  }

  /**
   * Update unrealized PnL (replaces previous unrealized)
   */
  updateUnrealizedPnL(_unrealizedPnL: number): void {
    this.resetIfNewDay();
    // Unrealized is tracked separately, not added to todaysPnL
  }

  /**
   * Check if trading is allowed based on daily limits
   */
  isTradingAllowed(startingBalance?: number): boolean {
    this.resetIfNewDay();

    // Check USD limit
    if (this.todaysPnL <= -this.config.dailyLossLimitUsd) {
      return false;
    }

    // Check percentage limit if starting balance provided
    if (startingBalance && startingBalance > 0) {
      const percentLoss = (Math.abs(this.todaysPnL) / startingBalance) * 100;
      if (this.todaysPnL < 0 && percentLoss >= this.config.dailyLossLimitPercent) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get current daily PnL status
   */
  getStatus(startingBalance?: number, unrealizedPnL: number = 0): DailyPnLStatus {
    this.resetIfNewDay();

    const totalPnL = this.todaysPnL + unrealizedPnL;
    const effectiveLimit = startingBalance
      ? Math.min(
          this.config.dailyLossLimitUsd,
          startingBalance * (this.config.dailyLossLimitPercent / 100),
        )
      : this.config.dailyLossLimitUsd;

    const percentOfLimit =
      effectiveLimit > 0 ? (Math.abs(Math.min(totalPnL, 0)) / effectiveLimit) * 100 : 0;

    const isLimitExceeded = totalPnL <= -effectiveLimit;
    const isWarning = percentOfLimit >= this.config.warningThresholdPercent && !isLimitExceeded;
    const tradingAllowed = !isLimitExceeded;
    const remainingAllowance = Math.max(0, effectiveLimit + totalPnL);

    let message: string;
    if (isLimitExceeded) {
      message = `DAILY LIMIT EXCEEDED: Lost $${Math.abs(totalPnL).toFixed(2)} (limit: $${effectiveLimit.toFixed(2)}). Trading halted.`;
    } else if (isWarning) {
      message = `WARNING: ${percentOfLimit.toFixed(0)}% of daily loss limit used. $${remainingAllowance.toFixed(2)} remaining.`;
    } else if (totalPnL >= 0) {
      message = `Daily P&L: +$${totalPnL.toFixed(2)}. Trading allowed.`;
    } else {
      message = `Daily P&L: -$${Math.abs(totalPnL).toFixed(2)}. $${remainingAllowance.toFixed(2)} of limit remaining.`;
    }

    return {
      date: this.todaysDate,
      realizedPnL: this.todaysPnL,
      unrealizedPnL,
      totalPnL,
      dailyLimit: effectiveLimit,
      percentOfLimit,
      isLimitExceeded,
      isWarning,
      tradingAllowed,
      remainingAllowance,
      message,
    };
  }

  /**
   * Get today's trades
   */
  getTodaysTrades(): TradeRecord[] {
    this.resetIfNewDay();
    return [...this.trades];
  }

  /**
   * Check a proposed trade against remaining allowance
   */
  canAffordLoss(
    potentialLoss: number,
    startingBalance?: number,
  ): {
    allowed: boolean;
    reason: string;
  } {
    const status = this.getStatus(startingBalance);

    if (!status.tradingAllowed) {
      return {
        allowed: false,
        reason: "Daily loss limit already exceeded",
      };
    }

    if (Math.abs(potentialLoss) > status.remainingAllowance) {
      return {
        allowed: false,
        reason: `Potential loss ($${Math.abs(potentialLoss).toFixed(2)}) exceeds remaining allowance ($${status.remainingAllowance.toFixed(2)})`,
      };
    }

    return {
      allowed: true,
      reason: `Trade allowed. Remaining allowance: $${status.remainingAllowance.toFixed(2)}`,
    };
  }

  /**
   * Reset daily tracking (for testing or manual reset)
   */
  reset(): void {
    this.todaysPnL = 0;
    this.trades = [];
    this.todaysDate = new Date().toISOString().split("T")[0]!;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DailyLimitConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Default instance
export const dailyLimitTracker = new DailyLimitTracker();

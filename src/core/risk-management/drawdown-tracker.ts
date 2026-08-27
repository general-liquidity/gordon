/**
 * Drawdown Tracker
 *
 * Track and manage portfolio drawdown:
 * - Current drawdown from peak
 * - Maximum drawdown history
 * - Recovery calculations
 * - Drawdown-based trading restrictions
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("drawdown-tracker");

// ============================================================================
// Types
// ============================================================================

export interface DrawdownConfig {
  maxDrawdownPercent: number; // Stop trading if drawdown exceeds this
  warningDrawdownPercent: number; // Warn when drawdown reaches this
  reduceSizeAtPercent: number; // Reduce position sizes when drawdown reaches this
  sizeReductionFactor: number; // Multiply position size by this when in drawdown
}

export interface DrawdownStatus {
  currentBalance: number;
  peakBalance: number;
  drawdownAmount: number;
  drawdownPercent: number;
  maxDrawdownSeen: number;
  recoveryNeeded: number; // Percent gain needed to recover
  status: "healthy" | "warning" | "critical" | "exceeded";
  tradingAllowed: boolean;
  sizeMultiplier: number; // 1.0 = full size, 0.5 = half size, etc.
  message: string;
}

export interface DrawdownEvent {
  timestamp: Date;
  balance: number;
  peak: number;
  drawdownPercent: number;
}

// ============================================================================
// Drawdown Tracker
// ============================================================================

export class DrawdownTracker {
  private config: DrawdownConfig;
  private peakBalance: number = 0;
  private currentBalance: number = 0;
  private maxDrawdownSeen: number = 0;
  private history: DrawdownEvent[] = [];

  constructor(config?: Partial<DrawdownConfig>) {
    this.config = {
      maxDrawdownPercent: config?.maxDrawdownPercent ?? 20,
      warningDrawdownPercent: config?.warningDrawdownPercent ?? 10,
      reduceSizeAtPercent: config?.reduceSizeAtPercent ?? 5,
      sizeReductionFactor: config?.sizeReductionFactor ?? 0.5,
    };
  }

  /**
   * Initialize with starting balance
   */
  initialize(startingBalance: number): void {
    this.peakBalance = startingBalance;
    this.currentBalance = startingBalance;
    this.maxDrawdownSeen = 0;
    this.history = [];
    logger.debug("Drawdown tracker initialized", { startingBalance });
  }

  /**
   * Update current balance and recalculate drawdown
   */
  updateBalance(newBalance: number): DrawdownStatus {
    this.currentBalance = newBalance;

    // Update peak if we've reached a new high
    if (newBalance > this.peakBalance) {
      this.peakBalance = newBalance;
    }

    // Calculate current drawdown
    const drawdownAmount = this.peakBalance - this.currentBalance;
    const drawdownPercent = this.peakBalance > 0 ? (drawdownAmount / this.peakBalance) * 100 : 0;

    // Update max drawdown if current is worse
    if (drawdownPercent > this.maxDrawdownSeen) {
      this.maxDrawdownSeen = drawdownPercent;
    }

    // Record history
    this.history.push({
      timestamp: new Date(),
      balance: newBalance,
      peak: this.peakBalance,
      drawdownPercent,
    });

    // Keep history to reasonable size
    if (this.history.length > 1000) {
      this.history = this.history.slice(-500);
    }

    return this.getStatus();
  }

  /**
   * Get current drawdown status
   */
  getStatus(): DrawdownStatus {
    const drawdownAmount = this.peakBalance - this.currentBalance;
    const drawdownPercent = this.peakBalance > 0 ? (drawdownAmount / this.peakBalance) * 100 : 0;

    // Calculate recovery needed
    const recoveryNeeded =
      this.currentBalance > 0 ? (drawdownAmount / this.currentBalance) * 100 : 0;

    // Determine status
    let status: "healthy" | "warning" | "critical" | "exceeded";
    let tradingAllowed = true;
    let sizeMultiplier = 1.0;

    if (drawdownPercent >= this.config.maxDrawdownPercent) {
      status = "exceeded";
      tradingAllowed = false;
      sizeMultiplier = 0;
    } else if (drawdownPercent >= this.config.warningDrawdownPercent) {
      status = "critical";
      sizeMultiplier = this.config.sizeReductionFactor * 0.5; // Extra reduction
    } else if (drawdownPercent >= this.config.reduceSizeAtPercent) {
      status = "warning";
      sizeMultiplier = this.config.sizeReductionFactor;
    } else {
      status = "healthy";
    }

    // Generate message
    let message: string;
    if (status === "exceeded") {
      message = `DRAWDOWN EXCEEDED: ${drawdownPercent.toFixed(1)}% (max: ${this.config.maxDrawdownPercent}%). Trading halted until recovery.`;
    } else if (status === "critical") {
      message = `CRITICAL DRAWDOWN: ${drawdownPercent.toFixed(1)}%. Position sizes reduced to ${(sizeMultiplier * 100).toFixed(0)}%.`;
    } else if (status === "warning") {
      message = `Drawdown warning: ${drawdownPercent.toFixed(1)}%. Position sizes reduced to ${(sizeMultiplier * 100).toFixed(0)}%.`;
    } else if (drawdownPercent > 0) {
      message = `Current drawdown: ${drawdownPercent.toFixed(1)}%. Trading normally.`;
    } else {
      message = "At or above peak balance. Trading normally.";
    }

    return {
      currentBalance: this.currentBalance,
      peakBalance: this.peakBalance,
      drawdownAmount,
      drawdownPercent,
      maxDrawdownSeen: this.maxDrawdownSeen,
      recoveryNeeded,
      status,
      tradingAllowed,
      sizeMultiplier,
      message,
    };
  }

  /**
   * Calculate drawdown from an equity curve
   */
  calculateFromEquityCurve(equityCurve: number[]): {
    currentDrawdown: number;
    maxDrawdown: number;
    peak: number;
    trough: number;
  } {
    if (equityCurve.length === 0) {
      return { currentDrawdown: 0, maxDrawdown: 0, peak: 0, trough: 0 };
    }

    let peak = equityCurve[0]!;
    let trough = equityCurve[0]!;
    let maxDrawdown = 0;
    let currentDrawdown = 0;

    for (const equity of equityCurve) {
      if (equity > peak) {
        peak = equity;
        trough = equity; // Reset trough when new peak
      }
      if (equity < trough) {
        trough = equity;
      }

      const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
      currentDrawdown = drawdown;
    }

    return { currentDrawdown, maxDrawdown, peak, trough };
  }

  /**
   * Get historical drawdown events
   */
  getHistory(limit?: number): DrawdownEvent[] {
    const events = [...this.history];
    if (limit) {
      return events.slice(-limit);
    }
    return events;
  }

  /**
   * Calculate risk-adjusted position size based on drawdown
   */
  adjustPositionSize(baseSize: number): number {
    const status = this.getStatus();
    return baseSize * status.sizeMultiplier;
  }

  /**
   * Check if a new position is allowed
   */
  canOpenPosition(): { allowed: boolean; reason: string } {
    const status = this.getStatus();

    if (!status.tradingAllowed) {
      return {
        allowed: false,
        reason: `Drawdown limit exceeded (${status.drawdownPercent.toFixed(1)}% > ${this.config.maxDrawdownPercent}%)`,
      };
    }

    return {
      allowed: true,
      reason: status.message,
    };
  }

  /**
   * Reset to initial state (new peak)
   */
  reset(newBalance?: number): void {
    if (newBalance !== undefined) {
      this.peakBalance = newBalance;
      this.currentBalance = newBalance;
    } else {
      this.peakBalance = this.currentBalance;
    }
    this.maxDrawdownSeen = 0;
    this.history = [];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DrawdownConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    currentDrawdown: number;
    maxDrawdownSeen: number;
    peakBalance: number;
    currentBalance: number;
    avgDrawdown: number;
    drawdownEvents: number;
  } {
    const drawdowns = this.history
      .filter((e) => e.drawdownPercent > 0)
      .map((e) => e.drawdownPercent);

    const avgDrawdown =
      drawdowns.length > 0 ? drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length : 0;

    return {
      currentDrawdown: this.getStatus().drawdownPercent,
      maxDrawdownSeen: this.maxDrawdownSeen,
      peakBalance: this.peakBalance,
      currentBalance: this.currentBalance,
      avgDrawdown,
      drawdownEvents: drawdowns.length,
    };
  }
}

// Default instance
export const drawdownTracker = new DrawdownTracker();

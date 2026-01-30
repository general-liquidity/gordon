/**
 * Exit Conditions
 *
 * Dynamic exit condition checking including:
 * - PnL threshold exits
 * - PnL rate (per minute) exits
 * - Time-based exits
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("exit-conditions");

// ============================================================================
// Types
// ============================================================================

export interface PnLExitConfig {
  targetPercent: number; // Take profit at this %
  maxLossPercent: number; // Stop loss at this % (negative)
}

export interface PnLRateConfig {
  minMinutes: number; // Minimum time before checking rate
  maxGainRatePerMin: number; // Exit if gaining faster than this (momentum exit)
  maxLossRatePerMin: number; // Exit if losing faster than this (negative)
}

export interface TimeExitConfig {
  maxMinutesInPosition: number; // Maximum time to hold
  warningMinutes: number; // Warn when this time remaining
}

export interface ExitSignal {
  shouldExit: boolean;
  reason: string | null;
  urgency: "low" | "medium" | "high" | "critical";
  details: Record<string, unknown>;
}

export interface PnLExitResult extends ExitSignal {
  pnlPercent: number;
  pnlUsd: number | null;
}

export interface PnLRateResult extends ExitSignal {
  pnlPercent: number;
  minutesHeld: number;
  pnlPerMinute: number;
}

export interface TimeExitResult extends ExitSignal {
  minutesHeld: number;
  minutesRemaining: number;
  percentTimeElapsed: number;
}

// ============================================================================
// Exit Condition Checker
// ============================================================================

export class ExitConditionChecker {
  private pnlConfig: PnLExitConfig;
  private rateConfig: PnLRateConfig;
  private timeConfig: TimeExitConfig;

  constructor(config?: {
    pnl?: Partial<PnLExitConfig>;
    rate?: Partial<PnLRateConfig>;
    time?: Partial<TimeExitConfig>;
  }) {
    this.pnlConfig = {
      targetPercent: config?.pnl?.targetPercent ?? 8.0,
      maxLossPercent: config?.pnl?.maxLossPercent ?? -5.0,
    };

    this.rateConfig = {
      minMinutes: config?.rate?.minMinutes ?? 1.0,
      maxGainRatePerMin: config?.rate?.maxGainRatePerMin ?? 2.0, // 2%/min is very fast
      maxLossRatePerMin: config?.rate?.maxLossRatePerMin ?? -1.0, // -1%/min is bleeding
    };

    this.timeConfig = {
      maxMinutesInPosition: config?.time?.maxMinutesInPosition ?? 240, // 4 hours
      warningMinutes: config?.time?.warningMinutes ?? 30,
    };
  }

  /**
   * Check if position should exit based on PnL thresholds
   */
  checkPnLExit(
    entryPrice: number,
    currentPrice: number,
    side: "buy" | "sell",
    quantity?: number
  ): PnLExitResult {
    try {
      const isLong = side === "buy";
      const priceDiff = isLong
        ? currentPrice - entryPrice
        : entryPrice - currentPrice;

      const pnlPercent = (priceDiff / entryPrice) * 100;
      const pnlUsd = quantity ? priceDiff * quantity : null;

      let shouldExit = false;
      let reason: string | null = null;
      let urgency: "low" | "medium" | "high" | "critical" = "low";

      if (pnlPercent >= this.pnlConfig.targetPercent) {
        shouldExit = true;
        reason = `Target reached: ${pnlPercent.toFixed(2)}% >= ${this.pnlConfig.targetPercent}%`;
        urgency = "medium";
      } else if (pnlPercent <= this.pnlConfig.maxLossPercent) {
        shouldExit = true;
        reason = `Stop loss hit: ${pnlPercent.toFixed(2)}% <= ${this.pnlConfig.maxLossPercent}%`;
        urgency = "critical";
      }

      return {
        shouldExit,
        reason,
        urgency,
        pnlPercent,
        pnlUsd,
        details: {
          entryPrice,
          currentPrice,
          side,
          targetPercent: this.pnlConfig.targetPercent,
          maxLossPercent: this.pnlConfig.maxLossPercent,
        },
      };
    } catch (error) {
      logger.error("Error checking PnL exit", error as Error);
      return {
        shouldExit: false,
        reason: null,
        urgency: "low",
        pnlPercent: 0,
        pnlUsd: null,
        details: { error: (error as Error).message },
      };
    }
  }

  /**
   * Check if position should exit based on PnL rate
   *
   * Useful for:
   * - Exiting positions that are bleeding slowly (death by a thousand cuts)
   * - Taking quick profits on momentum moves
   */
  checkPnLRateExit(
    entryTime: Date | string,
    currentPnLPercent: number,
    currentTime?: Date
  ): PnLRateResult {
    try {
      const entryDate = typeof entryTime === "string"
        ? new Date(entryTime)
        : entryTime;
      const now = currentTime || new Date();

      const minutesHeld = (now.getTime() - entryDate.getTime()) / (1000 * 60);

      // Not enough time to calculate rate
      if (minutesHeld < this.rateConfig.minMinutes) {
        return {
          shouldExit: false,
          reason: null,
          urgency: "low",
          pnlPercent: currentPnLPercent,
          minutesHeld,
          pnlPerMinute: 0,
          details: {
            message: `Position held < ${this.rateConfig.minMinutes} minutes`,
          },
        };
      }

      const pnlPerMinute = currentPnLPercent / minutesHeld;

      let shouldExit = false;
      let reason: string | null = null;
      let urgency: "low" | "medium" | "high" | "critical" = "low";

      // Check for rapid loss
      if (pnlPerMinute <= this.rateConfig.maxLossRatePerMin) {
        shouldExit = true;
        reason = `Rapid loss: ${pnlPerMinute.toFixed(3)}%/min <= ${this.rateConfig.maxLossRatePerMin}%/min`;
        urgency = "high";
      }
      // Check for rapid gain (momentum exit - optional, can be disabled)
      else if (pnlPerMinute >= this.rateConfig.maxGainRatePerMin && currentPnLPercent > 0) {
        shouldExit = true;
        reason = `Momentum exit: ${pnlPerMinute.toFixed(3)}%/min >= ${this.rateConfig.maxGainRatePerMin}%/min`;
        urgency = "medium";
      }

      return {
        shouldExit,
        reason,
        urgency,
        pnlPercent: currentPnLPercent,
        minutesHeld,
        pnlPerMinute,
        details: {
          entryTime: entryDate.toISOString(),
          maxGainRatePerMin: this.rateConfig.maxGainRatePerMin,
          maxLossRatePerMin: this.rateConfig.maxLossRatePerMin,
        },
      };
    } catch (error) {
      logger.error("Error checking PnL rate exit", error as Error);
      return {
        shouldExit: false,
        reason: null,
        urgency: "low",
        pnlPercent: currentPnLPercent,
        minutesHeld: 0,
        pnlPerMinute: 0,
        details: { error: (error as Error).message },
      };
    }
  }

  /**
   * Check if position should exit based on time held
   */
  checkTimeExit(
    entryTime: Date | string,
    currentTime?: Date
  ): TimeExitResult {
    try {
      const entryDate = typeof entryTime === "string"
        ? new Date(entryTime)
        : entryTime;
      const now = currentTime || new Date();

      const minutesHeld = (now.getTime() - entryDate.getTime()) / (1000 * 60);
      const minutesRemaining = this.timeConfig.maxMinutesInPosition - minutesHeld;
      const percentTimeElapsed = (minutesHeld / this.timeConfig.maxMinutesInPosition) * 100;

      let shouldExit = false;
      let reason: string | null = null;
      let urgency: "low" | "medium" | "high" | "critical" = "low";

      if (minutesHeld >= this.timeConfig.maxMinutesInPosition) {
        shouldExit = true;
        reason = `Time limit exceeded: ${minutesHeld.toFixed(0)} >= ${this.timeConfig.maxMinutesInPosition} minutes`;
        urgency = "high";
      } else if (minutesRemaining <= this.timeConfig.warningMinutes) {
        // Warning but don't force exit
        reason = `Time warning: ${minutesRemaining.toFixed(0)} minutes remaining`;
        urgency = "medium";
      }

      return {
        shouldExit,
        reason,
        urgency,
        minutesHeld,
        minutesRemaining: Math.max(0, minutesRemaining),
        percentTimeElapsed,
        details: {
          entryTime: entryDate.toISOString(),
          maxMinutes: this.timeConfig.maxMinutesInPosition,
          warningMinutes: this.timeConfig.warningMinutes,
        },
      };
    } catch (error) {
      logger.error("Error checking time exit", error as Error);
      return {
        shouldExit: false,
        reason: null,
        urgency: "low",
        minutesHeld: 0,
        minutesRemaining: this.timeConfig.maxMinutesInPosition,
        percentTimeElapsed: 0,
        details: { error: (error as Error).message },
      };
    }
  }

  /**
   * Check all exit conditions and return combined result
   */
  checkAllExitConditions(params: {
    entryPrice: number;
    currentPrice: number;
    side: "buy" | "sell";
    entryTime: Date | string;
    quantity?: number;
  }): {
    shouldExit: boolean;
    signals: ExitSignal[];
    primaryReason: string | null;
    urgency: "low" | "medium" | "high" | "critical";
  } {
    const signals: ExitSignal[] = [];

    // Calculate current PnL
    const isLong = params.side === "buy";
    const priceDiff = isLong
      ? params.currentPrice - params.entryPrice
      : params.entryPrice - params.currentPrice;
    const pnlPercent = (priceDiff / params.entryPrice) * 100;

    // Check PnL threshold
    const pnlExit = this.checkPnLExit(
      params.entryPrice,
      params.currentPrice,
      params.side,
      params.quantity
    );
    signals.push(pnlExit);

    // Check PnL rate
    const rateExit = this.checkPnLRateExit(params.entryTime, pnlPercent);
    signals.push(rateExit);

    // Check time
    const timeExit = this.checkTimeExit(params.entryTime);
    signals.push(timeExit);

    // Determine overall result
    const exitSignals = signals.filter((s) => s.shouldExit);
    const shouldExit = exitSignals.length > 0;

    // Get highest urgency
    const urgencyOrder = ["low", "medium", "high", "critical"] as const;
    const highestUrgency = signals.reduce((max, s) => {
      return urgencyOrder.indexOf(s.urgency) > urgencyOrder.indexOf(max)
        ? s.urgency
        : max;
    }, "low" as "low" | "medium" | "high" | "critical");

    // Primary reason is the highest urgency exit signal
    const primarySignal = exitSignals.sort(
      (a, b) => urgencyOrder.indexOf(b.urgency) - urgencyOrder.indexOf(a.urgency)
    )[0];

    return {
      shouldExit,
      signals,
      primaryReason: primarySignal?.reason ?? null,
      urgency: highestUrgency,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: {
    pnl?: Partial<PnLExitConfig>;
    rate?: Partial<PnLRateConfig>;
    time?: Partial<TimeExitConfig>;
  }): void {
    if (config.pnl) {
      this.pnlConfig = { ...this.pnlConfig, ...config.pnl };
    }
    if (config.rate) {
      this.rateConfig = { ...this.rateConfig, ...config.rate };
    }
    if (config.time) {
      this.timeConfig = { ...this.timeConfig, ...config.time };
    }
  }
}

// Default instance
export const exitConditionChecker = new ExitConditionChecker();

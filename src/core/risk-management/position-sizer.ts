/**
 * Position Sizer
 *
 * Advanced position sizing calculations including:
 * - Kelly Criterion
 * - Volatility-adjusted sizing
 * - ATR-based sizing
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("position-sizer");

// ============================================================================
// Types
// ============================================================================

export interface PositionSizeConfig {
  riskPerTradePercent: number; // Default 2%
  maxPositionSize: number; // Max position in USD
  maxRiskPerPosition: number; // Max risk amount in USD
}

export interface KellyResult {
  kellyPercent: number; // Raw Kelly percentage
  adjustedPercent: number; // Capped at 25%
  positionSize: number; // Dollar amount
  recommendation: string;
  /**
   * Set when the caller supplied a non-zero `transactionCostBps`. Records
   * the cost adjustment applied to avgWin / avgLoss before Kelly was
   * computed, so the audit trail shows whether the size reflects gross
   * or net edge.
   */
  costAdjustment?: {
    transactionCostBps: number;
    rawWin: number;
    rawLoss: number;
    netWin: number;
    netLoss: number;
    /** Kelly % using uncorrected gross edge — surfaced so callers can see what they would have sized at if costs were ignored. */
    grossKellyPercent: number;
    /** True when the cost adjustment flipped the trade from positive- to negative-expectancy. */
    flipsToNegative: boolean;
  };
}

export interface VolatilityAdjustedResult {
  baseSize: number;
  adjustedSize: number;
  adjustmentFactor: number;
  volatility: number;
}

export interface RiskBasedSizeResult {
  positionSize: number;
  riskAmount: number;
  riskPercent: number;
  stopLossPercent: number;
}

// ============================================================================
// Position Sizer
// ============================================================================

export class PositionSizer {
  private config: PositionSizeConfig;

  constructor(config?: Partial<PositionSizeConfig>) {
    this.config = {
      riskPerTradePercent: config?.riskPerTradePercent ?? 2.0,
      maxPositionSize: config?.maxPositionSize ?? 10000,
      maxRiskPerPosition: config?.maxRiskPerPosition ?? 1000,
    };
  }

  /**
   * Calculate position size based on risk percentage and stop loss
   */
  calculateRiskBasedSize(balance: number, stopLossPercent: number): RiskBasedSizeResult {
    try {
      const riskAmount = balance * (this.config.riskPerTradePercent / 100);
      let positionSize = riskAmount / (stopLossPercent / 100);

      // Apply limits
      positionSize = Math.min(
        positionSize,
        this.config.maxPositionSize,
        this.config.maxRiskPerPosition / (stopLossPercent / 100),
      );

      return {
        positionSize,
        riskAmount,
        riskPercent: this.config.riskPerTradePercent,
        stopLossPercent,
      };
    } catch (error) {
      logger.error("Error calculating risk-based size", error as Error);
      return {
        positionSize: 0,
        riskAmount: 0,
        riskPercent: this.config.riskPerTradePercent,
        stopLossPercent,
      };
    }
  }

  /**
   * Calculate position size using Kelly Criterion
   *
   * Kelly % = (W * R - L) / R
   * Where:
   *   W = Win rate (0-1)
   *   L = Loss rate (1 - W)
   *   R = Win/Loss ratio (avg win / avg loss)
   *
   * When `transactionCostBps` is supplied, costs are subtracted from
   * avgWin and added to avgLoss BEFORE Kelly is computed. A round-trip
   * trade incurs the cost twice (enter + exit), so the deduction is
   * 2 × bps / 10_000 against each return. If the cost adjustment flips
   * the edge from positive to negative, Kelly returns 0 — the cost
   * adjustment then surfaces this in the audit field, so the operator
   * can see they would have sized into a negative-expectancy trade
   * without the deduction.
   */
  calculateWithKelly(
    balance: number,
    winRate: number,
    avgWin: number,
    avgLoss: number,
    transactionCostBps: number = 0,
  ): KellyResult {
    try {
      if (avgLoss === 0 || winRate <= 0 || winRate >= 1) {
        return {
          kellyPercent: 0,
          adjustedPercent: 0,
          positionSize: 0,
          recommendation: "Invalid inputs - cannot calculate Kelly",
        };
      }

      // Compute the gross-edge Kelly as a reference point (what an
      // operator would have sized at if they ignored costs).
      const grossWinLossRatio = Math.abs(avgWin / avgLoss);
      const grossKelly = (winRate * (grossWinLossRatio + 1) - 1) / grossWinLossRatio;

      // Cost-aware adjustment — each round trip eats 2 × bps off the
      // edge. The cost adjustment is applied to absolute return magnitudes
      // (avgWin is positive, avgLoss is positive-magnitude).
      const costFraction = (Math.max(0, transactionCostBps) * 2) / 10_000;
      const netWin = Math.max(0, avgWin - costFraction);
      const netLoss = avgLoss + costFraction; // costs add to loss magnitude

      let kellyPercent: number;
      let flipsToNegative = false;
      if (netWin <= 0 || netLoss <= 0) {
        kellyPercent = 0;
        flipsToNegative = grossKelly > 0;
      } else {
        const winLossRatio = Math.abs(netWin / netLoss);
        kellyPercent = (winRate * (winLossRatio + 1) - 1) / winLossRatio;
        flipsToNegative = grossKelly > 0 && kellyPercent <= 0;
      }

      // Cap at 25% (half-Kelly is common practice for safety)
      const adjustedPercent = Math.max(0, Math.min(kellyPercent, 0.25));
      const positionSize = balance * adjustedPercent;

      let recommendation: string;
      if (flipsToNegative) {
        recommendation =
          `Cost-adjusted edge is negative (cost ${transactionCostBps}bps round-trip) - ` +
          `gross Kelly was ${(grossKelly * 100).toFixed(1)}% but costs flip it to no-trade`;
      } else if (kellyPercent <= 0) {
        recommendation = "Kelly suggests no position - edge is negative";
      } else if (kellyPercent > 0.25) {
        recommendation = `Full Kelly is ${(kellyPercent * 100).toFixed(1)}% - using capped 25%`;
      } else {
        recommendation =
          transactionCostBps > 0
            ? `Cost-adjusted Kelly: ${(kellyPercent * 100).toFixed(1)}% (gross would have been ${(grossKelly * 100).toFixed(1)}%)`
            : `Kelly sizing: ${(kellyPercent * 100).toFixed(1)}% of balance`;
      }

      return {
        kellyPercent: kellyPercent * 100,
        adjustedPercent: adjustedPercent * 100,
        positionSize,
        recommendation,
        ...(transactionCostBps > 0 && {
          costAdjustment: {
            transactionCostBps,
            rawWin: avgWin,
            rawLoss: avgLoss,
            netWin,
            netLoss,
            grossKellyPercent: grossKelly * 100,
            flipsToNegative,
          },
        }),
      };
    } catch (error) {
      logger.error("Error calculating Kelly size", error as Error);
      return {
        kellyPercent: 0,
        adjustedPercent: 0,
        positionSize: 0,
        recommendation: "Error calculating Kelly criterion",
      };
    }
  }

  /**
   * Adjust position size based on volatility
   * Higher volatility = smaller position
   */
  calculateVolatilityAdjusted(
    balance: number,
    stopLossPercent: number,
    volatility: number, // 0-1 scale, e.g., 0.3 = 30% volatility
  ): VolatilityAdjustedResult {
    try {
      const baseResult = this.calculateRiskBasedSize(balance, stopLossPercent);
      const baseSize = baseResult.positionSize;

      // Adjustment factor: inverse relationship with volatility
      // volatility of 0 = factor of 1 (no adjustment)
      // volatility of 1 = factor of 0.5 (halve position)
      const adjustmentFactor = 1 / (1 + volatility);
      let adjustedSize = baseSize * adjustmentFactor;

      // Apply limits
      adjustedSize = Math.min(
        adjustedSize,
        this.config.maxPositionSize,
        this.config.maxRiskPerPosition / (stopLossPercent / 100),
      );

      return {
        baseSize,
        adjustedSize,
        adjustmentFactor,
        volatility,
      };
    } catch (error) {
      logger.error("Error calculating volatility-adjusted size", error as Error);
      return {
        baseSize: 0,
        adjustedSize: 0,
        adjustmentFactor: 1,
        volatility,
      };
    }
  }

  /**
   * Calculate position size using ATR for stop loss
   */
  calculateFromATR(
    balance: number,
    currentPrice: number,
    atrValue: number,
    riskPercent: number = 2.0,
    atrMultiplier: number = 2.0,
  ): {
    positionSize: number;
    stopLossPrice: number;
    stopLossPercent: number;
    units: number;
  } {
    try {
      // Calculate stop loss based on ATR
      const stopLossDistance = atrValue * atrMultiplier;
      const stopLossPrice = currentPrice - stopLossDistance;

      if (stopLossPrice <= 0) {
        return {
          positionSize: 0,
          stopLossPrice: 0,
          stopLossPercent: 0,
          units: 0,
        };
      }

      // Calculate stop loss percentage
      const stopLossPercent = (stopLossDistance / currentPrice) * 100;

      // Use risk-based calculation
      const riskAmount = balance * (riskPercent / 100);
      let positionSize = riskAmount / (stopLossPercent / 100);

      // Apply limits
      positionSize = Math.min(positionSize, this.config.maxPositionSize);

      const units = positionSize / currentPrice;

      return {
        positionSize,
        stopLossPrice,
        stopLossPercent,
        units,
      };
    } catch (error) {
      logger.error("Error calculating ATR-based size", error as Error);
      return {
        positionSize: 0,
        stopLossPrice: 0,
        stopLossPercent: 0,
        units: 0,
      };
    }
  }
}

// Default instance
export const positionSizer = new PositionSizer();

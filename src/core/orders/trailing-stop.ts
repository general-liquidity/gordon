/**
 * Trailing Stop Tracker Module
 *
 * Manages trailing stops for open positions. Trailing stops adjust dynamically
 * based on price movement to lock in profits while allowing room for volatility.
 *
 * Supports:
 * - Percentage-based trailing (e.g., 3% below high)
 * - ATR-based trailing (e.g., 2x ATR below high)
 * - Event emission when trail should trigger
 * - Integration with monitor cycle
 */

import { EventEmitter } from "events";
import type { Exchange, OrderParams, Order } from "../../infra/exchange/index.ts";
import { calculateATR } from "../indicators/atr.ts";
import { getTrade, updateTrade } from "../../infra/storage/entities/trades.ts";
import { getPlan, updatePlan } from "../../infra/storage/entities/plans.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import type { Trade, Plan, ExitFill } from "../../types/index.ts";
import { assertLiveConsent } from "../../infra/trading/execution/preflight.ts";

const logger = createModuleLogger("trailing-stop");

// ============================================================================
// Types
// ============================================================================

/**
 * Trailing stop configuration
 */
export interface TrailingStopConfig {
  /** Unique identifier for the trailing stop */
  id: string;
  /** Trade ID this trailing stop is associated with */
  tradeId: string;
  /** Symbol being traded */
  symbol: string;
  /** Type of trailing calculation */
  type: "percentage" | "atr";
  /** Trail distance - percentage (0.03 = 3%) or ATR multiplier (e.g., 2.0) */
  trailDistance: number;
  /** Activation price - trailing only starts after this price is reached */
  activationPrice?: number;
  /** Whether the trailing stop is currently active */
  isActive: boolean;
  /** Highest price observed since activation */
  highestPrice: number;
  /** Current calculated stop price */
  currentStopPrice: number;
  /** When this trailing stop was created */
  createdAt: string;
  /** Last time this trailing stop was updated */
  updatedAt: string;
}

/**
 * Trailing stop update result
 */
export interface TrailingStopUpdateResult {
  /** Whether an update occurred */
  updated: boolean;
  /** Previous stop price */
  previousStopPrice: number;
  /** New stop price */
  newStopPrice: number;
  /** Current highest price */
  highestPrice: number;
  /** Whether the stop should trigger */
  shouldTrigger: boolean;
  /** Current market price */
  currentPrice: number;
}

/**
 * Events emitted by TrailingStopTracker
 */
export interface TrailingStopEvents {
  /** Emitted when trailing stop price is updated */
  "stop:updated": {
    tradeId: string;
    previousStop: number;
    newStop: number;
    highestPrice: number;
  };
  /** Emitted when trailing stop should trigger */
  "stop:triggered": {
    tradeId: string;
    triggerPrice: number;
    currentPrice: number;
    highestPrice: number;
  };
  /** Emitted when trailing stop is activated */
  "stop:activated": {
    tradeId: string;
    activationPrice: number;
    initialStop: number;
  };
}

// ============================================================================
// Trailing Stop Tracker Class
// ============================================================================

/**
 * TrailingStopTracker manages trailing stops for multiple positions
 *
 * Usage:
 * ```typescript
 * const tracker = new TrailingStopTracker();
 *
 * // Add a trailing stop
 * tracker.addTrailingStop({
 *   tradeId: "trd_abc123",
 *   symbol: "BTCUSDT",
 *   type: "percentage",
 *   trailDistance: 0.03, // 3%
 *   activationPrice: 50000,
 * });
 *
 * // Update in monitor cycle
 * const result = await tracker.updateTrailingStop(client, "trd_abc123");
 * if (result.shouldTrigger) {
 *   // Execute stop loss
 * }
 * ```
 */
export class TrailingStopTracker extends EventEmitter {
  /** Map of trade ID to trailing stop config */
  private trailingStops: Map<string, TrailingStopConfig> = new Map();

  /** ATR period for ATR-based trailing stops */
  private atrPeriod: number = 14;

  /** Candle interval for ATR calculation */
  private atrInterval: string = "1h";

  constructor() {
    super();
    logger.debug("TrailingStopTracker initialized");
  }

  /**
   * Add a new trailing stop for a trade
   */
  addTrailingStop(config: {
    tradeId: string;
    symbol: string;
    type: "percentage" | "atr";
    trailDistance: number;
    activationPrice?: number;
    initialHighPrice?: number;
  }): TrailingStopConfig {
    const now = new Date().toISOString();
    const id = `tsl_${config.tradeId.slice(4)}`;

    // If no activation price, the stop is immediately active
    const isActive = !config.activationPrice;

    // Calculate initial stop price if active
    const initialHigh = config.initialHighPrice ?? 0;
    const initialStop = isActive && initialHigh > 0
      ? this.calculateStopPrice(initialHigh, config.type, config.trailDistance)
      : 0;

    const trailingStop: TrailingStopConfig = {
      id,
      tradeId: config.tradeId,
      symbol: config.symbol,
      type: config.type,
      trailDistance: config.trailDistance,
      activationPrice: config.activationPrice,
      isActive,
      highestPrice: initialHigh,
      currentStopPrice: initialStop,
      createdAt: now,
      updatedAt: now,
    };

    this.trailingStops.set(config.tradeId, trailingStop);

    logger.info("Trailing stop added", {
      tradeId: config.tradeId,
      type: config.type,
      trailDistance: config.trailDistance,
      isActive,
    });

    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "TRAILING_STOP_ADDED",
        type: config.type,
        trailDistance: config.trailDistance,
        activationPrice: config.activationPrice,
        isActive,
      },
      tradeId: config.tradeId,
    });

    return trailingStop;
  }

  /**
   * Remove a trailing stop
   */
  removeTrailingStop(tradeId: string): boolean {
    const removed = this.trailingStops.delete(tradeId);
    if (removed) {
      logger.info("Trailing stop removed", { tradeId });
    }
    return removed;
  }

  /**
   * Get trailing stop for a trade
   */
  getTrailingStop(tradeId: string): TrailingStopConfig | undefined {
    return this.trailingStops.get(tradeId);
  }

  /**
   * Get all active trailing stops
   */
  getActiveTrailingStops(): TrailingStopConfig[] {
    return Array.from(this.trailingStops.values()).filter((ts) => ts.isActive);
  }

  /**
   * Get all trailing stops
   */
  getAllTrailingStops(): TrailingStopConfig[] {
    return Array.from(this.trailingStops.values());
  }

  /**
   * Calculate stop price based on type and trail distance
   */
  private calculateStopPrice(
    highPrice: number,
    type: "percentage" | "atr",
    trailDistance: number,
    atrValue?: number
  ): number {
    if (type === "percentage") {
      return highPrice * (1 - trailDistance);
    } else if (type === "atr" && atrValue) {
      return highPrice - (atrValue * trailDistance);
    }
    return highPrice * (1 - 0.03); // Default 3% fallback
  }

  /**
   * Update a trailing stop with current market data
   *
   * @param client - Binance client for price/ATR data
   * @param tradeId - Trade ID to update
   * @returns Update result with trigger status
   */
  async updateTrailingStop(
    client: Exchange,
    tradeId: string
  ): Promise<TrailingStopUpdateResult> {
    const config = this.trailingStops.get(tradeId);

    if (!config) {
      throw new Error(`No trailing stop found for trade: ${tradeId}`);
    }

    // Get current price
    const currentPrice = await client.getPrice(config.symbol);
    const previousStopPrice = config.currentStopPrice;

    // Check activation
    if (!config.isActive) {
      if (config.activationPrice && currentPrice >= config.activationPrice) {
        // Activate the trailing stop
        config.isActive = true;
        config.highestPrice = currentPrice;
        config.currentStopPrice = this.calculateStopPrice(
          currentPrice,
          config.type,
          config.trailDistance
        );
        config.updatedAt = new Date().toISOString();

        this.emit("stop:activated", {
          tradeId,
          activationPrice: config.activationPrice,
          initialStop: config.currentStopPrice,
        });

        logger.info("Trailing stop activated", {
          tradeId,
          activationPrice: config.activationPrice,
          initialStop: config.currentStopPrice,
        });

        logEvent({
          type: "ALERT",
          data: {
            action: "TRAILING_STOP_ACTIVATED",
            activationPrice: config.activationPrice,
            initialStop: config.currentStopPrice,
          },
          tradeId,
        });
      }

      return {
        updated: false,
        previousStopPrice,
        newStopPrice: config.currentStopPrice,
        highestPrice: config.highestPrice,
        shouldTrigger: false,
        currentPrice,
      };
    }

    // Update highest price if new high
    let updated = false;
    if (currentPrice > config.highestPrice) {
      config.highestPrice = currentPrice;

      // Calculate new stop based on trail type
      let atrValue: number | undefined;
      if (config.type === "atr") {
        const candles = await client.getCandles(
          config.symbol,
          this.atrInterval,
          this.atrPeriod + 5
        );
        const atrResult = calculateATR(candles, this.atrPeriod);
        atrValue = atrResult.current ?? undefined;
      }

      const newStopPrice = this.calculateStopPrice(
        config.highestPrice,
        config.type,
        config.trailDistance,
        atrValue
      );

      // Only update if new stop is higher (trailing up, not down)
      if (newStopPrice > config.currentStopPrice) {
        config.currentStopPrice = newStopPrice;
        config.updatedAt = new Date().toISOString();
        updated = true;

        this.emit("stop:updated", {
          tradeId,
          previousStop: previousStopPrice,
          newStop: newStopPrice,
          highestPrice: config.highestPrice,
        });

        logger.debug("Trailing stop updated", {
          tradeId,
          previousStop: previousStopPrice,
          newStop: newStopPrice,
          highestPrice: config.highestPrice,
        });
      }
    }

    // Check if stop should trigger
    const shouldTrigger = currentPrice <= config.currentStopPrice;

    if (shouldTrigger) {
      this.emit("stop:triggered", {
        tradeId,
        triggerPrice: config.currentStopPrice,
        currentPrice,
        highestPrice: config.highestPrice,
      });

      logger.warn("Trailing stop triggered", {
        tradeId,
        triggerPrice: config.currentStopPrice,
        currentPrice,
        highestPrice: config.highestPrice,
      });

      logEvent({
        type: "ALERT",
        data: {
          action: "TRAILING_STOP_TRIGGERED",
          triggerPrice: config.currentStopPrice,
          currentPrice,
          highestPrice: config.highestPrice,
        },
        tradeId,
      });
    }

    return {
      updated,
      previousStopPrice,
      newStopPrice: config.currentStopPrice,
      highestPrice: config.highestPrice,
      shouldTrigger,
      currentPrice,
    };
  }

  /**
   * Update all trailing stops (for monitor cycle integration)
   *
   * @param client - Binance client
   * @returns Map of trade ID to update results
   */
  async updateAllTrailingStops(
    client: Exchange
  ): Promise<Map<string, TrailingStopUpdateResult>> {
    const results = new Map<string, TrailingStopUpdateResult>();

    for (const [tradeId] of this.trailingStops) {
      try {
        const result = await this.updateTrailingStop(client, tradeId);
        results.set(tradeId, result);
      } catch (error) {
        logger.error("Error updating trailing stop", error as Error, { tradeId });
      }
    }

    return results;
  }

  /**
   * Execute a trailing stop (close the position)
   *
   * @param client - Binance client
   * @param tradeId - Trade ID to close
   * @returns Success status
   */
  async executeTrailingStop(
    client: Exchange,
    tradeId: string
  ): Promise<{ success: boolean; pnl?: number; error?: string }> {
    const config = this.trailingStops.get(tradeId);
    if (!config) {
      return { success: false, error: "Trailing stop not found" };
    }

    const trade = getTrade(tradeId);
    if (!trade) {
      return { success: false, error: "Trade not found" };
    }

    if (trade.status === "CLOSED") {
      this.removeTrailingStop(tradeId);
      return { success: false, error: "Trade already closed" };
    }

    // Calculate remaining quantity
    const totalEntryQty = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
    const totalExitQty = trade.exits.reduce((sum, e) => sum + e.quantity, 0);
    const remainingQty = totalEntryQty - totalExitQty;

    if (remainingQty <= 0) {
      this.removeTrailingStop(tradeId);
      return { success: false, error: "No remaining position" };
    }

    // Round quantity
    const precision = 8;
    const multiplier = Math.pow(10, precision);
    const roundedQty = Math.floor(remainingQty * multiplier) / multiplier;

    // Place market sell order
    const orderParams: OrderParams = {
      symbol: config.symbol,
      side: "SELL",
      type: "MARKET",
      quantity: roundedQty,
      newClientOrderId: `gordon_tsl_${tradeId.slice(4)}_${Date.now().toString(36)}`,
    };

    let sellOrder: Order;
    try {
      assertLiveConsent(client, "trailing_stop.execute");
      sellOrder = await client.placeOrder(orderParams);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Trailing stop execution failed", error as Error, { tradeId });
      return { success: false, error: errorMessage };
    }

    // Calculate exit details
    const executedQty = sellOrder.executedQty;
    const exitPrice = executedQty > 0
      ? sellOrder.cummulativeQuoteQty / executedQty
      : trade.averageEntry;

    // Create exit fill
    const exitFill: ExitFill = {
      orderId: sellOrder.orderId.toString(),
      price: exitPrice,
      quantity: executedQty,
      filledAt: new Date().toISOString(),
      reason: "STOP",
    };

    // Calculate PnL
    const exitValue = exitPrice * executedQty;
    const entryValue = trade.averageEntry * executedQty;
    const pnl = exitValue - entryValue;
    const totalRealizedPnl = trade.realizedPnl + pnl;
    const totalInvested = trade.averageEntry * totalEntryQty;
    const realizedPnlPercent = totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0;

    // Update trade
    const updatedExits = [...trade.exits, exitFill];
    updateTrade(trade.id, {
      exits: updatedExits,
      realizedPnl: totalRealizedPnl,
      realizedPnlPercent,
      status: "CLOSED",
      closedAt: new Date().toISOString(),
    });

    // Update plan status
    updatePlan(trade.planId, { status: "CLOSED" });

    // Remove trailing stop
    this.removeTrailingStop(tradeId);

    // Log and emit events
    logger.info("Trailing stop executed", {
      tradeId,
      exitPrice,
      highestPrice: config.highestPrice,
      pnl,
    });

    logEvent({
      type: "ORDER_FILLED",
      data: {
        action: "TRAILING_STOP_EXECUTED",
        orderId: sellOrder.orderId.toString(),
        exitPrice,
        highestPrice: config.highestPrice,
        quantity: executedQty,
        pnl,
        realizedPnlPercent,
      },
      tradeId,
      planId: trade.planId,
    });

    await emitEvent("trade:closed", {
      trade: { ...trade, exits: updatedExits, realizedPnl: totalRealizedPnl, status: "CLOSED" },
      reason: "TRAILING_STOP",
      pnl: totalRealizedPnl,
      pnlPercent: realizedPnlPercent,
    });

    return { success: true, pnl: totalRealizedPnl };
  }

  /**
   * Clear all trailing stops
   */
  clear(): void {
    this.trailingStops.clear();
    logger.debug("All trailing stops cleared");
  }

  /**
   * Set ATR parameters for ATR-based trailing stops
   */
  setATRParams(period: number, interval: string): void {
    this.atrPeriod = period;
    this.atrInterval = interval;
    logger.debug("ATR params updated", { period, interval });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Global trailing stop tracker instance */
let globalTracker: TrailingStopTracker | null = null;

/**
 * Get or create the global trailing stop tracker
 */
export function getTrailingStopTracker(): TrailingStopTracker {
  if (!globalTracker) {
    globalTracker = new TrailingStopTracker();
  }
  return globalTracker;
}

/**
 * Reset the global trailing stop tracker (for testing)
 */
export function resetTrailingStopTracker(): void {
  if (globalTracker) {
    globalTracker.clear();
    globalTracker = null;
  }
}

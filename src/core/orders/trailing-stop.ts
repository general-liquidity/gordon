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

import { EventEmitter } from "node:events";
import type { Exchange, OrderParams, Order } from "../../infra/exchange/index.ts";
import { calculateATR } from "../indicators/atr.ts";
import { getTrade, updateTrade } from "../../infra/storage/entities/trades.ts";
import { getPlan, updatePlan } from "../../infra/storage/entities/plans.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import type { ExitFill } from "../../types/index.ts";
import { assertConsentForExposure } from "../../infra/trading/execution/preflight.ts";
import {
  cancelPlanProtectiveOrders,
  generateDeterministicClientOrderId,
  placeOrderIdempotent,
  repairProtectiveOrders,
  waitForFill,
} from "../pipeline/executor.ts";

const logger = createModuleLogger("trailing-stop");

async function restoreTrailingProtection(planId: string, client: Exchange): Promise<string> {
  try {
    const repair = await repairProtectiveOrders(planId, client);
    if (repair.repaired || repair.reason === "protective_orders_intact") return "";
    return `; protection was not restored (${repair.reason})`;
  } catch (error) {
    return `; protection repair failed (${error instanceof Error ? error.message : String(error)})`;
  }
}

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
  /** Position direction; for shorts highestPrice stores the lowest favorable price. */
  direction: "long" | "short";
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
    const trade = getTrade(config.tradeId);
    const direction = trade ? (getPlan(trade.planId)?.direction ?? "long") : "long";

    // Calculate initial stop price if active
    const initialHigh = config.initialHighPrice ?? 0;
    const initialStop =
      isActive && initialHigh > 0
        ? this.calculateStopPrice(initialHigh, config.type, config.trailDistance, direction)
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
      direction,
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
    favorableExtreme: number,
    type: "percentage" | "atr",
    trailDistance: number,
    direction: "long" | "short",
    atrValue?: number,
  ): number {
    if (type === "percentage") {
      return direction === "short"
        ? favorableExtreme * (1 + trailDistance)
        : favorableExtreme * (1 - trailDistance);
    } else if (type === "atr" && atrValue) {
      return direction === "short"
        ? favorableExtreme + atrValue * trailDistance
        : favorableExtreme - atrValue * trailDistance;
    }
    return direction === "short" ? favorableExtreme * 1.03 : favorableExtreme * 0.97;
  }

  /**
   * Update a trailing stop with current market data
   *
   * @param client - Binance client for price/ATR data
   * @param tradeId - Trade ID to update
   * @returns Update result with trigger status
   */
  async updateTrailingStop(client: Exchange, tradeId: string): Promise<TrailingStopUpdateResult> {
    const config = this.trailingStops.get(tradeId);

    if (!config) {
      throw new Error(`No trailing stop found for trade: ${tradeId}`);
    }

    // Get current price
    const currentPrice = await client.getPrice(config.symbol);
    const previousStopPrice = config.currentStopPrice;

    // Check activation
    if (!config.isActive) {
      const activationReached =
        config.activationPrice !== undefined &&
        (config.direction === "short"
          ? currentPrice <= config.activationPrice
          : currentPrice >= config.activationPrice);
      if (activationReached) {
        // Activate the trailing stop
        config.isActive = true;
        config.highestPrice = currentPrice;
        config.currentStopPrice = this.calculateStopPrice(
          currentPrice,
          config.type,
          config.trailDistance,
          config.direction,
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

    // Track the favorable extreme: highest price for longs, lowest for shorts.
    let updated = false;
    const isNewFavorableExtreme =
      config.direction === "short"
        ? config.highestPrice === 0 || currentPrice < config.highestPrice
        : currentPrice > config.highestPrice;
    if (isNewFavorableExtreme) {
      config.highestPrice = currentPrice;

      // Calculate new stop based on trail type
      let atrValue: number | undefined;
      if (config.type === "atr") {
        const candles = await client.getCandles(
          config.symbol,
          this.atrInterval,
          this.atrPeriod + 5,
        );
        const atrResult = calculateATR(candles, this.atrPeriod);
        atrValue = atrResult.current ?? undefined;
      }

      const newStopPrice = this.calculateStopPrice(
        config.highestPrice,
        config.type,
        config.trailDistance,
        config.direction,
        atrValue,
      );

      const improvesStop =
        config.direction === "short"
          ? config.currentStopPrice === 0 || newStopPrice < config.currentStopPrice
          : newStopPrice > config.currentStopPrice;
      if (improvesStop) {
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
    const shouldTrigger =
      config.direction === "short"
        ? currentPrice >= config.currentStopPrice
        : currentPrice <= config.currentStopPrice;

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
  async updateAllTrailingStops(client: Exchange): Promise<Map<string, TrailingStopUpdateResult>> {
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
    tradeId: string,
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
    const multiplier = 10 ** precision;
    const roundedQty = Math.floor(remainingQty * multiplier) / multiplier;

    const plan = getPlan(trade.planId);
    if (!plan) {
      return { success: false, error: "Cannot safely close a trade whose plan is missing" };
    }
    const exitSide: "BUY" | "SELL" = plan.direction === "short" ? "BUY" : "SELL";

    const orderParams: OrderParams = {
      symbol: config.symbol,
      side: exitSide,
      type: "MARKET",
      quantity: roundedQty,
      newClientOrderId: generateDeterministicClientOrderId(
        trade.planId,
        `tsl_${trade.exits.length.toString(36)}_${Math.round(roundedQty * 1e8).toString(36)}`,
      ),
    };

    const cancelledProtection = await cancelPlanProtectiveOrders(
      client,
      trade.symbol,
      trade.planId,
    );
    if (!cancelledProtection.success) {
      const repairFailure = await restoreTrailingProtection(trade.planId, client);
      return {
        success: false,
        error: `Cannot execute trailing stop while sibling protection remains live: ${cancelledProtection.failures.join("; ")}${repairFailure}`,
      };
    }

    let sellOrder: Order;
    try {
      assertConsentForExposure(client, "trailing_stop.execute", {
        direction: "REDUCES_EXPOSURE",
        reduction: {
          side: orderParams.side,
          quantity: roundedQty,
          exitSide,
          remainingQuantity: remainingQty,
        },
      });
      sellOrder = await placeOrderIdempotent(client, orderParams, {
        direction: "REDUCES_EXPOSURE",
        reduction: {
          side: orderParams.side,
          quantity: roundedQty,
          exitSide,
          remainingQuantity: remainingQty,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Trailing stop execution failed", error as Error, { tradeId });
      const repairFailure = await restoreTrailingProtection(trade.planId, client);
      return { success: false, error: `${errorMessage}${repairFailure}` };
    }

    let executedQty: number;
    let exitPrice: number;
    try {
      executedQty = sellOrder.executedQty;
      exitPrice =
        executedQty > 0 && sellOrder.cummulativeQuoteQty > 0
          ? sellOrder.cummulativeQuoteQty / executedQty
          : sellOrder.price;
      if (sellOrder.status !== "FILLED") {
        const fill = await waitForFill(client, trade.symbol, sellOrder.orderId.toString(), {
          onPartialFill: "cancel",
        });
        executedQty = Math.min(roundedQty, fill.fillStatus.filledQuantity);
        exitPrice = fill.fillStatus.averagePrice;
      }
    } catch (error) {
      const repairFailure = await restoreTrailingProtection(trade.planId, client);
      return {
        success: false,
        error: `${error instanceof Error ? error.message : String(error)}${repairFailure}`,
      };
    }
    if (executedQty <= 0) {
      const repairFailure = await restoreTrailingProtection(trade.planId, client);
      return {
        success: false,
        error: `Trailing-stop order ${sellOrder.orderId} was acknowledged but no fill was confirmed${repairFailure}.`,
      };
    }

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
    const pnlMultiplier = plan.direction === "short" ? -1 : 1;
    const pnl = pnlMultiplier * (exitValue - entryValue);
    const totalRealizedPnl = trade.realizedPnl + pnl;
    const totalInvested = trade.averageEntry * totalEntryQty;
    const realizedPnlPercent = totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0;

    // Update trade
    const updatedExits = [...trade.exits, exitFill];
    const fullyClosed = executedQty >= remainingQty - 1e-8;
    updateTrade(trade.id, {
      exits: updatedExits,
      realizedPnl: totalRealizedPnl,
      realizedPnlPercent,
      status: fullyClosed ? "CLOSED" : "PARTIAL",
      closedAt: fullyClosed ? new Date().toISOString() : null,
    });

    let repairFailure = "";
    if (fullyClosed) {
      updatePlan(trade.planId, { status: "CLOSED" });
      this.removeTrailingStop(tradeId);
    } else {
      repairFailure = await restoreTrailingProtection(trade.planId, client);
    }

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

    const updatedTrade = {
      ...trade,
      exits: updatedExits,
      realizedPnl: totalRealizedPnl,
      realizedPnlPercent,
      status: fullyClosed ? ("CLOSED" as const) : ("PARTIAL" as const),
    };
    if (fullyClosed) {
      await emitEvent("trade:closed", {
        trade: updatedTrade,
        reason: "TRAILING_STOP",
        pnl: totalRealizedPnl,
        pnlPercent: realizedPnlPercent,
      });
    } else {
      await emitEvent("trade:partial_close", {
        tradeId,
        trade: updatedTrade,
        symbol: trade.symbol,
        reason: "TRAILING_STOP",
        closedQuantity: executedQty,
        remainingQuantity: remainingQty - executedQty,
        pnl,
      });
    }

    return fullyClosed
      ? { success: true, pnl: totalRealizedPnl }
      : {
          success: false,
          pnl: totalRealizedPnl,
          error: `Trailing stop only filled ${executedQty} of ${remainingQty}; the remainder stays open${repairFailure || " and protection was re-armed"}.`,
        };
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

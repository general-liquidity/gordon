/**
 * Executor Module
 * Places orders on Binance. Fully deterministic (no AI).
 *
 * This module handles the critical task of executing trading plans.
 * It is defensive by design - trading is critical and errors can be costly.
 */

import { BinanceClient } from "../infra/binance/index.ts";
import type { BinanceOrder, OrderParams } from "../infra/binance/index.ts";
import { validatePlan } from "./validator.ts";
import { createTrade, updateTrade } from "../infra/storage/trades.ts";
import { updatePlan } from "../infra/storage/plans.ts";
import { logEvent } from "../infra/storage/events.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import { emitEvent } from "../events/index.ts";
import {
  TradingModeError,
  InvalidPlanError,
  BinanceError as BinanceErrorType,
  isGordonError,
} from "../errors/index.ts";
import type {
  Plan,
  Trade,
  GordonConfig,
  EntryFill,
  ExitFill,
} from "../types/index.ts";

const logger = createModuleLogger("executor");

/**
 * Order placed during execution
 */
interface PlacedOrder {
  type: "entry" | "dca" | "stop" | "take_profit";
  orderId: string;
  price: number;
  quantity: number;
}

/**
 * Result of plan execution
 */
export interface ExecutionResult {
  success: boolean;
  trade?: Trade;
  error?: string;
  orders: PlacedOrder[];
}

/**
 * Current portfolio state for execution context
 */
export interface PortfolioState {
  totalValue: number;
  availableCash: number;
  openPositions: number;
}

/**
 * Result of trade cancellation
 */
interface CancelResult {
  success: boolean;
  error?: string;
}

/**
 * Result of trade closure
 */
interface CloseResult {
  success: boolean;
  pnl?: number;
  error?: string;
}

/**
 * Reason for closing a trade
 */
type CloseReason = "MANUAL" | "STOP" | "TP1" | "TP2" | "TP3";

/**
 * Generate a unique client order ID for tracking
 */
function generateClientOrderId(planId: string, type: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `gordon_${planId.slice(4, 12)}_${type}_${timestamp}_${random}`;
}

/**
 * Round quantity to appropriate precision for Binance
 * Default to 8 decimal places, which is safe for most pairs
 */
function roundQuantity(quantity: number, precision: number = 8): number {
  const multiplier = Math.pow(10, precision);
  return Math.floor(quantity * multiplier) / multiplier;
}

/**
 * Round price to appropriate precision
 */
function roundPrice(price: number, precision: number = 8): number {
  const multiplier = Math.pow(10, precision);
  return Math.round(price * multiplier) / multiplier;
}

/**
 * Attempt to cancel a single order, logging any errors
 */
async function safelyCancelOrder(
  client: BinanceClient,
  symbol: string,
  orderId: string,
  planId: string
): Promise<boolean> {
  try {
    await client.cancelOrder(symbol, orderId);
    logger.debug("Order cancelled", { symbol, orderId, reason: "ROLLBACK" });
    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "CANCELLED",
        symbol,
        orderId,
        reason: "ROLLBACK",
      },
      planId,
    });
    return true;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to cancel order", error as Error, { symbol, orderId });
    logEvent({
      type: "ERROR",
      data: {
        action: "CANCEL_FAILED",
        symbol,
        orderId,
        error: errorMessage,
      },
      planId,
    });
    return false;
  }
}

/**
 * Rollback previously placed orders in case of failure
 */
async function rollbackOrders(
  client: BinanceClient,
  symbol: string,
  orders: PlacedOrder[],
  planId: string
): Promise<void> {
  logger.warn("Rolling back orders", { symbol, orderCount: orders.length });
  for (const order of orders) {
    await safelyCancelOrder(client, symbol, order.orderId, planId);
  }
}

/**
 * Execute a trading plan by placing orders on Binance
 *
 * @param client - Authenticated Binance client
 * @param plan - The trading plan to execute
 * @param config - Gordon configuration
 * @param portfolio - Current portfolio state
 * @returns ExecutionResult with success status, trade, and order details
 */
export async function executePlan(
  client: BinanceClient,
  plan: Plan,
  config: GordonConfig,
  portfolio: PortfolioState
): Promise<ExecutionResult> {
  const placedOrders: PlacedOrder[] = [];

  logger.info("Executing plan", { planId: plan.id, symbol: plan.symbol });

  // Step 1: Check mode is ARMED
  if (config.mode !== "ARMED") {
    logger.warn("Execution blocked - system not armed");
    return {
      success: false,
      error: "Cannot execute: System is not in ARMED mode. Use '/arm' to enable trading.",
      orders: [],
    };
  }

  // Step 2: Check armed hasn't expired
  if (config.armedUntil === null) {
    return {
      success: false,
      error: "Cannot execute: ARMED mode has no expiration set. Please re-arm the system.",
      orders: [],
    };
  }

  const armedUntilDate = new Date(config.armedUntil);
  const now = new Date();

  if (armedUntilDate <= now) {
    logger.warn("Execution blocked - armed mode expired", { armedUntil: config.armedUntil });
    return {
      success: false,
      error: `Cannot execute: ARMED mode expired at ${config.armedUntil}. Please re-arm the system.`,
      orders: [],
    };
  }

  // Step 3: Run validator one more time with fresh data
  const validationResult = validatePlan(plan, config, portfolio);

  if (!validationResult.valid) {
    logger.warn("Plan validation failed", { errors: validationResult.errors });
    return {
      success: false,
      error: `Validation failed: ${validationResult.errors.join("; ")}`,
      orders: [],
    };
  }

  // Log warnings but don't block execution
  if (validationResult.warnings.length > 0) {
    logger.warn("Plan has warnings", { warnings: validationResult.warnings });
    logEvent({
      type: "ALERT",
      data: {
        action: "EXECUTION_WARNINGS",
        warnings: validationResult.warnings,
      },
      planId: plan.id,
    });
  }

  // Step 4: Get current price for calculations
  let currentPrice: number;
  try {
    currentPrice = await client.getPrice(plan.symbol);
    logger.debug("Got current price", { symbol: plan.symbol, price: currentPrice });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to get price", error as Error, { symbol: plan.symbol });
    return {
      success: false,
      error: `Failed to get current price for ${plan.symbol}: ${errorMessage}`,
      orders: [],
    };
  }

  // Step 5: Calculate quantity based on allocation and current price
  const priceForCalculation =
    plan.entry.type === "market" || plan.entry.price === null
      ? currentPrice
      : plan.entry.price;

  const totalQuantity = roundQuantity(
    plan.allocation.amount / priceForCalculation
  );

  if (totalQuantity <= 0) {
    return {
      success: false,
      error: `Calculated quantity is too small. Allocation: ${plan.allocation.amount} USDT, Price: ${priceForCalculation}`,
      orders: [],
    };
  }

  // Step 6: Place orders in sequence
  try {
    // 6a. Place entry order
    const entryOrderParams: OrderParams = {
      symbol: plan.symbol,
      side: "BUY",
      type: plan.entry.type === "market" ? "MARKET" : "LIMIT",
      quantity: totalQuantity,
      newClientOrderId: generateClientOrderId(plan.id, "entry"),
    };

    if (plan.entry.type === "limit" && plan.entry.price !== null) {
      entryOrderParams.price = roundPrice(plan.entry.price);
      entryOrderParams.timeInForce = "GTC";
    }

    let entryOrder: BinanceOrder;
    try {
      entryOrder = await client.placeOrder(entryOrderParams);
      logger.info("Entry order placed", {
        orderId: entryOrder.orderId,
        symbol: plan.symbol,
        type: entryOrderParams.type,
      });
    } catch (error) {
      const errorMessage = isGordonError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown error";

      logger.error("Entry order failed", error as Error, { params: entryOrderParams });
      logEvent({
        type: "ERROR",
        data: {
          action: "ENTRY_ORDER_FAILED",
          params: entryOrderParams,
          error: errorMessage,
        },
        planId: plan.id,
      });

      return {
        success: false,
        error: `Failed to place entry order: ${errorMessage}`,
        orders: [],
      };
    }

    const entryPrice =
      plan.entry.type === "market"
        ? parseFloat(entryOrder.cummulativeQuoteQty) /
          parseFloat(entryOrder.executedQty)
        : plan.entry.price ?? currentPrice;

    placedOrders.push({
      type: "entry",
      orderId: entryOrder.orderId.toString(),
      price: entryPrice,
      quantity: totalQuantity,
    });

    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "ENTRY",
        orderId: entryOrder.orderId.toString(),
        symbol: plan.symbol,
        side: "BUY",
        type: entryOrderParams.type,
        price: entryPrice,
        quantity: totalQuantity,
      },
      planId: plan.id,
    });

    // 6b. Place stop-loss order
    const stopOrderParams: OrderParams = {
      symbol: plan.symbol,
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      quantity: totalQuantity,
      price: roundPrice(plan.stopLoss.price * 0.995),
      stopPrice: roundPrice(plan.stopLoss.price),
      timeInForce: "GTC",
      newClientOrderId: generateClientOrderId(plan.id, "stop"),
    };

    let stopOrder: BinanceOrder;
    try {
      stopOrder = await client.placeOrder(stopOrderParams);
      logger.info("Stop order placed", {
        orderId: stopOrder.orderId,
        stopPrice: plan.stopLoss.price,
      });
    } catch (error) {
      await rollbackOrders(client, plan.symbol, placedOrders, plan.id);

      const errorMessage = isGordonError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown error";

      logger.error("Stop order failed", error as Error, { params: stopOrderParams });
      logEvent({
        type: "ERROR",
        data: {
          action: "STOP_ORDER_FAILED",
          params: stopOrderParams,
          error: errorMessage,
        },
        planId: plan.id,
      });

      return {
        success: false,
        error: `Failed to place stop-loss order: ${errorMessage}. Entry order rolled back.`,
        orders: placedOrders,
      };
    }

    placedOrders.push({
      type: "stop",
      orderId: stopOrder.orderId.toString(),
      price: plan.stopLoss.price,
      quantity: totalQuantity,
    });

    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "STOP_LOSS",
        orderId: stopOrder.orderId.toString(),
        symbol: plan.symbol,
        side: "SELL",
        type: "STOP_LOSS_LIMIT",
        stopPrice: plan.stopLoss.price,
        quantity: totalQuantity,
      },
      planId: plan.id,
    });

    // 6c. Place take-profit orders
    let remainingQuantity = totalQuantity;
    for (let i = 0; i < plan.takeProfit.length; i++) {
      const tp = plan.takeProfit[i];
      if (!tp) {
        continue;
      }
      const isLastTP = i === plan.takeProfit.length - 1;

      const tpQuantity = isLastTP
        ? remainingQuantity
        : roundQuantity(totalQuantity * tp.percentToSell);

      remainingQuantity = roundQuantity(remainingQuantity - tpQuantity);

      if (tpQuantity <= 0) {
        continue;
      }

      const tpOrderParams: OrderParams = {
        symbol: plan.symbol,
        side: "SELL",
        type: "LIMIT",
        quantity: tpQuantity,
        price: roundPrice(tp.price),
        timeInForce: "GTC",
        newClientOrderId: generateClientOrderId(plan.id, `tp${i + 1}`),
      };

      let tpOrder: BinanceOrder;
      try {
        tpOrder = await client.placeOrder(tpOrderParams);
        logger.info("Take profit order placed", {
          level: i + 1,
          orderId: tpOrder.orderId,
          price: tp.price,
        });
      } catch (error) {
        await rollbackOrders(client, plan.symbol, placedOrders, plan.id);

        const errorMessage = isGordonError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unknown error";

        logger.error("TP order failed", error as Error, { level: i + 1, params: tpOrderParams });
        logEvent({
          type: "ERROR",
          data: {
            action: "TP_ORDER_FAILED",
            tpLevel: i + 1,
            params: tpOrderParams,
            error: errorMessage,
          },
          planId: plan.id,
        });

        return {
          success: false,
          error: `Failed to place take-profit order ${i + 1}: ${errorMessage}. All orders rolled back.`,
          orders: placedOrders,
        };
      }

      placedOrders.push({
        type: "take_profit",
        orderId: tpOrder.orderId.toString(),
        price: tp.price,
        quantity: tpQuantity,
      });

      logEvent({
        type: "ORDER_PLACED",
        data: {
          action: `TAKE_PROFIT_${i + 1}`,
          orderId: tpOrder.orderId.toString(),
          symbol: plan.symbol,
          side: "SELL",
          type: "LIMIT",
          price: tp.price,
          quantity: tpQuantity,
        },
        planId: plan.id,
      });
    }

    // Step 7: Create Trade record with order IDs
    const entryFill: EntryFill = {
      orderId: entryOrder.orderId.toString(),
      price: entryPrice,
      quantity: totalQuantity,
      filledAt:
        plan.entry.type === "market" ? new Date().toISOString() : "",
    };

    const trade = createTrade({
      planId: plan.id,
      openedAt: new Date().toISOString(),
      closedAt: null,
      symbol: plan.symbol,
      entries: [entryFill],
      exits: [],
      averageEntry: entryPrice,
      realizedPnl: 0,
      realizedPnlPercent: 0,
      status: plan.entry.type === "market" ? "OPEN" : "PARTIAL",
    });

    // Emit trade opened event
    await emitEvent("trade:opened", { trade, planId: plan.id });

    // Step 8: Log events for trade creation
    logger.info("Trade created", {
      tradeId: trade.id,
      symbol: plan.symbol,
      orderCount: placedOrders.length,
    });

    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "TRADE_CREATED",
        tradeId: trade.id,
        symbol: plan.symbol,
        orderCount: placedOrders.length,
        orders: placedOrders.map((o) => ({
          type: o.type,
          orderId: o.orderId,
        })),
      },
      planId: plan.id,
      tradeId: trade.id,
    });

    // Step 9: Update plan status to EXECUTING
    updatePlan(plan.id, { status: "EXECUTING" });

    // Step 10: Return success with trade details
    return {
      success: true,
      trade,
      orders: placedOrders,
    };
  } catch (error) {
    // Unexpected error - attempt to rollback any placed orders
    if (placedOrders.length > 0) {
      await rollbackOrders(client, plan.symbol, placedOrders, plan.id);
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error("Unexpected execution error", error as Error, { planId: plan.id });
    logEvent({
      type: "ERROR",
      data: {
        action: "EXECUTION_FAILED",
        error: errorMessage,
        placedOrdersCount: placedOrders.length,
      },
      planId: plan.id,
    });

    return {
      success: false,
      error: `Unexpected execution error: ${errorMessage}`,
      orders: placedOrders,
    };
  }
}

/**
 * Cancel an active trade by cancelling all open orders
 *
 * @param client - Authenticated Binance client
 * @param trade - The trade to cancel
 * @returns CancelResult with success status
 */
export async function cancelTrade(
  client: BinanceClient,
  trade: Trade
): Promise<CancelResult> {
  logger.info("Cancelling trade", { tradeId: trade.id, symbol: trade.symbol });

  if (trade.status === "CLOSED") {
    return {
      success: false,
      error: "Cannot cancel a closed trade.",
    };
  }

  try {
    const openOrders = await client.getOpenOrders(trade.symbol);

    const cancelPromises = openOrders.map(async (order) => {
      try {
        await client.cancelOrder(trade.symbol, order.orderId.toString());
        logger.debug("Order cancelled", { orderId: order.orderId, symbol: trade.symbol });
        logEvent({
          type: "ORDER_PLACED",
          data: {
            action: "CANCELLED",
            orderId: order.orderId.toString(),
            symbol: trade.symbol,
            reason: "TRADE_CANCELLED",
          },
          tradeId: trade.id,
          planId: trade.planId,
        });
        return { success: true, orderId: order.orderId.toString() };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return {
          success: false,
          orderId: order.orderId.toString(),
          error: errorMessage,
        };
      }
    });

    const results = await Promise.all(cancelPromises);
    const failures = results.filter((r) => !r.success);

    if (failures.length > 0) {
      logger.warn("Partial cancellation", { failures });
      logEvent({
        type: "ERROR",
        data: {
          action: "PARTIAL_CANCEL",
          failures: failures.map((f) => ({
            orderId: f.orderId,
            error: f.error,
          })),
        },
        tradeId: trade.id,
        planId: trade.planId,
      });

      return {
        success: false,
        error: `Failed to cancel ${failures.length} order(s). Some orders may still be active.`,
      };
    }

    updateTrade(trade.id, { status: "CLOSED", closedAt: new Date().toISOString() });
    updatePlan(trade.planId, { status: "CANCELLED" });

    await emitEvent("plan:cancelled", { planId: trade.planId, reason: "User cancelled" });

    logger.info("Trade cancelled", { tradeId: trade.id, cancelledOrders: results.length });
    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "TRADE_CANCELLED",
        cancelledOrders: results.length,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });

    return { success: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error("Failed to cancel trade", error as Error, { tradeId: trade.id });
    logEvent({
      type: "ERROR",
      data: {
        action: "CANCEL_FAILED",
        error: errorMessage,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });

    return {
      success: false,
      error: `Failed to cancel trade: ${errorMessage}`,
    };
  }
}

/**
 * Close a trade by selling all remaining position
 *
 * @param client - Authenticated Binance client
 * @param trade - The trade to close
 * @param reason - Reason for closing (MANUAL, STOP, TP1, TP2, TP3)
 * @returns CloseResult with success status and PnL
 */
export async function closeTrade(
  client: BinanceClient,
  trade: Trade,
  reason: CloseReason
): Promise<CloseResult> {
  logger.info("Closing trade", { tradeId: trade.id, symbol: trade.symbol, reason });

  if (trade.status === "CLOSED") {
    return {
      success: false,
      error: "Trade is already closed.",
    };
  }

  try {
    // First, cancel all open orders to prevent double-execution
    const openOrders = await client.getOpenOrders(trade.symbol);

    for (const order of openOrders) {
      try {
        await client.cancelOrder(trade.symbol, order.orderId.toString());
      } catch {
        // Continue even if some cancellations fail
      }
    }

    // Calculate remaining quantity to sell
    const totalEntryQuantity = trade.entries.reduce(
      (sum, e) => sum + e.quantity,
      0
    );
    const totalExitQuantity = trade.exits.reduce(
      (sum, e) => sum + e.quantity,
      0
    );
    const remainingQuantity = roundQuantity(
      totalEntryQuantity - totalExitQuantity
    );

    if (remainingQuantity <= 0) {
      updateTrade(trade.id, {
        status: "CLOSED",
        closedAt: new Date().toISOString(),
      });
      updatePlan(trade.planId, { status: "CLOSED" });

      await emitEvent("trade:closed", {
        trade,
        reason,
        pnl: trade.realizedPnl,
        pnlPercent: trade.realizedPnlPercent,
      });

      return {
        success: true,
        pnl: trade.realizedPnl,
      };
    }

    // Place market sell order for remaining quantity
    const sellOrderParams: OrderParams = {
      symbol: trade.symbol,
      side: "SELL",
      type: "MARKET",
      quantity: remainingQuantity,
      newClientOrderId: generateClientOrderId(trade.planId, "close"),
    };

    let sellOrder: BinanceOrder;
    try {
      sellOrder = await client.placeOrder(sellOrderParams);
      logger.info("Close order placed", { orderId: sellOrder.orderId, quantity: remainingQuantity });
    } catch (error) {
      const errorMessage = isGordonError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown error";

      logger.error("Close order failed", error as Error, { params: sellOrderParams });
      logEvent({
        type: "ERROR",
        data: {
          action: "CLOSE_ORDER_FAILED",
          params: sellOrderParams,
          error: errorMessage,
        },
        tradeId: trade.id,
        planId: trade.planId,
      });

      return {
        success: false,
        error: `Failed to close position: ${errorMessage}`,
      };
    }

    // Calculate exit price from filled order
    const exitPrice =
      parseFloat(sellOrder.cummulativeQuoteQty) /
      parseFloat(sellOrder.executedQty);
    const executedQuantity = parseFloat(sellOrder.executedQty);

    // Create exit fill record
    const exitFill: ExitFill = {
      orderId: sellOrder.orderId.toString(),
      price: exitPrice,
      quantity: executedQuantity,
      filledAt: new Date().toISOString(),
      reason,
    };

    // Calculate PnL
    const exitValue = exitPrice * executedQuantity;
    const entryValue = trade.averageEntry * executedQuantity;
    const pnlFromThisExit = exitValue - entryValue;
    const totalRealizedPnl = trade.realizedPnl + pnlFromThisExit;

    const totalInvested = trade.averageEntry * totalEntryQuantity;
    const realizedPnlPercent =
      totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0;

    // Update trade with exit info
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

    // Emit trade closed event
    await emitEvent("trade:closed", {
      trade: { ...trade, exits: updatedExits, realizedPnl: totalRealizedPnl, realizedPnlPercent, status: "CLOSED" },
      reason,
      pnl: totalRealizedPnl,
      pnlPercent: realizedPnlPercent,
    });

    logger.info("Trade closed", {
      tradeId: trade.id,
      reason,
      pnl: totalRealizedPnl,
      pnlPercent: realizedPnlPercent,
    });

    logEvent({
      type: "ORDER_FILLED",
      data: {
        action: "TRADE_CLOSED",
        reason,
        orderId: sellOrder.orderId.toString(),
        exitPrice,
        quantity: executedQuantity,
        pnl: totalRealizedPnl,
        pnlPercent: realizedPnlPercent,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });

    return {
      success: true,
      pnl: totalRealizedPnl,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    logger.error("Failed to close trade", error as Error, { tradeId: trade.id, reason });
    logEvent({
      type: "ERROR",
      data: {
        action: "CLOSE_FAILED",
        error: errorMessage,
        reason,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });

    return {
      success: false,
      error: `Failed to close trade: ${errorMessage}`,
    };
  }
}

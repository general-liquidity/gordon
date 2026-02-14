/**
 * Executor Module
 * Places orders on the active exchange. Fully deterministic (no AI).
 *
 * This module handles the critical task of executing trading plans.
 * It is defensive by design - trading is critical and errors can be costly.
 *
 * Security features:
 * - Audit logging for all sensitive operations
 * - Access control checks before execution
 * - Permission validation before trading
 */

import type { Exchange, Order, OrderParams, ExchangeExtended, OCOOrderParams } from "../infra/exchange/index.ts";
import { BinanceAdapter } from "../infra/exchange/index.ts";
import { validatePlan } from "./validator.ts";
import { createTrade, updateTrade, getTrade, listTrades } from "../infra/storage/trades.ts";
import { updatePlan, listPlans, getPlan } from "../infra/storage/plans.ts";
import { logEvent } from "../infra/storage/events.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import { emitEvent } from "../events/index.ts";
import {
  TradingModeError,
  InvalidPlanError,
  isGordonError,
} from "../errors/index.ts";
import { auditLog } from "../infra/audit/index.ts";
import { validateOperation } from "../infra/binance/permissions.ts";
import type {
  Plan,
  Trade,
  GordonConfig,
  EntryFill,
  ExitFill,
} from "../types/index.ts";

const logger = createModuleLogger("executor");

/** Default maximum concurrent trades if not configured */
const DEFAULT_MAX_CONCURRENT_TRADES = 5;

// ============================================================================
// Constants
// ============================================================================

/** Default plan expiration time in milliseconds (24 hours) */
const DEFAULT_PLAN_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/** Default fill wait timeout in milliseconds (30 seconds) */
const DEFAULT_FILL_WAIT_TIMEOUT_MS = 30 * 1000;

/** Poll interval when waiting for fills (1 second) */
const FILL_POLL_INTERVAL_MS = 1000;

// ============================================================================
// Types
// ============================================================================

/**
 * Order placed during execution
 */
interface PlacedOrder {
  type: "entry" | "dca" | "stop" | "take_profit" | "grid";
  orderId: string;
  price: number;
  quantity: number;
}

/**
 * Fill status for an order
 */
export interface FillStatus {
  orderId: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "EXPIRED" | "REJECTED";
  filledQuantity: number;
  remainingQuantity: number;
  averagePrice: number;
  isComplete: boolean;
}

/**
 * Options for waiting for fills
 */
export interface WaitForFillOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Action to take on partial fill: 'continue' waits, 'cancel' cancels order */
  onPartialFill?: "continue" | "cancel";
  /** Poll interval in milliseconds (default: 1000) */
  pollIntervalMs?: number;
}

/**
 * Result of waiting for a fill
 */
export interface WaitForFillResult {
  success: boolean;
  fillStatus: FillStatus;
  timedOut: boolean;
  error?: string;
}

/**
 * Result of partial position close
 */
export interface PartialCloseResult {
  success: boolean;
  closedQuantity: number;
  remainingQuantity: number;
  exitPrice: number;
  pnl: number;
  error?: string;
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
export function generateClientOrderId(planId: string, type: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `gordon_${planId.slice(4, 12)}_${type}_${timestamp}_${random}`;
}

/**
 * Round quantity to appropriate precision for exchange orders
 * Default to 8 decimal places, which is safe for most pairs
 */
export function roundQuantity(quantity: number, precision: number = 8): number {
  const multiplier = Math.pow(10, precision);
  return Math.floor(quantity * multiplier) / multiplier;
}

/**
 * Round price to appropriate precision
 */
export function roundPrice(price: number, precision: number = 8): number {
  const multiplier = Math.pow(10, precision);
  return Math.round(price * multiplier) / multiplier;
}

async function validateTradePermissions(exchange: Exchange): Promise<{ allowed: boolean; error?: string }> {
  if (exchange instanceof BinanceAdapter) {
    return validateOperation(exchange.getUnderlyingClient(), "trade");
  }

  try {
    const accountInfo = await exchange.getAccountInfo();
    if (!accountInfo.canTrade) {
      return {
        allowed: false,
        error: "Permission denied: Exchange account cannot trade.",
      };
    }
  } catch (error) {
    return {
      allowed: false,
      error: error instanceof Error ? error.message : "Failed to verify exchange permissions.",
    };
  }

  return { allowed: true };
}

/**
 * Attempt to cancel a single order, logging any errors
 */
async function safelyCancelOrder(
  client: Exchange,
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
  client: Exchange,
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
 * Execute a trading plan by placing orders on the active exchange
 *
 * @param client - Authenticated exchange client
 * @param plan - The trading plan to execute
 * @param config - Gordon configuration
 * @param portfolio - Current portfolio state
 * @returns ExecutionResult with success status, trade, and order details
 */
export async function executePlan(
  client: Exchange,
  plan: Plan,
  config: GordonConfig,
  portfolio: PortfolioState,
  userId: string = "system"
): Promise<ExecutionResult> {
  const placedOrders: PlacedOrder[] = [];

  logger.info("Executing plan", { planId: plan.id, symbol: plan.symbol });

  // Audit: Record execution attempt
  auditLog.record(userId, "EXECUTE_PLAN", {
    planId: plan.id,
    symbol: plan.symbol,
    allocation: plan.allocation.amount,
    strategy: plan.strategy,
  }, "PENDING", { planId: plan.id });

  // Step 0: Validate trading permissions
  const permissionCheck = await validateTradePermissions(client);
  if (!permissionCheck.allowed) {
    auditLog.blocked(userId, "EXECUTE_PLAN", { planId: plan.id }, permissionCheck.error || "Permission denied", { planId: plan.id });
    return {
      success: false,
      error: permissionCheck.error,
      orders: [],
    };
  }

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

  // Step 3.5: Check concurrent trade limit
  const concurrentTradeCheck = checkConcurrentTradeLimit(config);
  if (!concurrentTradeCheck.canOpen) {
    logger.warn("Concurrent trade limit reached", {
      activeCount: concurrentTradeCheck.activeCount,
      maxAllowed: concurrentTradeCheck.maxAllowed,
    });
    return {
      success: false,
      error: `Cannot execute: Maximum concurrent trades limit reached (${concurrentTradeCheck.activeCount}/${concurrentTradeCheck.maxAllowed}). Close existing trades or increase the limit in preferences.`,
      orders: [],
    };
  }

  // Handle grid_entry strategy
  if (plan.strategy === "grid_entry" && plan.grid) {
    return await executeGridPlan(client, plan, config, portfolio);
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

    let entryOrder: Order;
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
        ? (entryOrder.executedQty > 0
          ? entryOrder.cummulativeQuoteQty / entryOrder.executedQty
          : currentPrice)
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

    // 6b + 6c. Place exit orders (stop-loss + take-profit)
    //
    // Optimization: When there is exactly one take-profit level AND the
    // exchange supports native OCO, place an atomic OCO order that pairs
    // the stop-loss with the take-profit. This guarantees one cancels the
    // other without relying on the monitor.
    //
    // For multiple take-profit levels (tiered exits), we fall back to
    // placing separate orders because OCO is a 1:1 pairing.

    const canUseOCO = plan.takeProfit.length === 1
      && plan.takeProfit[0]
      && getOCOCapableExchange(client) !== null;

    if (canUseOCO) {
      // --- OCO path: single atomic order for SL + TP ---
      const tp = plan.takeProfit[0]!;

      const ocoResult = await placeOCOOrders(
        client,
        plan.symbol,
        "SELL",
        totalQuantity,
        plan.stopLoss.price,
        roundPrice(plan.stopLoss.price * 0.995),
        tp.price,
        plan.id,
        userId
      );

      if (!ocoResult.success) {
        // OCO failed — rollback entry order
        await rollbackOrders(client, plan.symbol, placedOrders, plan.id);

        logger.error("OCO exit order failed", new Error(ocoResult.error), { planId: plan.id });

        return {
          success: false,
          error: `Failed to place OCO exit orders: ${ocoResult.error}. Entry order rolled back.`,
          orders: placedOrders,
        };
      }

      // Record both legs as placed orders
      // First order ID is the stop leg, second is the TP leg
      if (ocoResult.orderIds[0]) {
        placedOrders.push({
          type: "stop",
          orderId: ocoResult.orderIds[0],
          price: plan.stopLoss.price,
          quantity: totalQuantity,
        });
      }
      if (ocoResult.orderIds[1]) {
        placedOrders.push({
          type: "take_profit",
          orderId: ocoResult.orderIds[1],
          price: tp.price,
          quantity: totalQuantity,
        });
      }

      logEvent({
        type: "ORDER_PLACED",
        data: {
          action: "OCO_EXIT_PLACED",
          native: ocoResult.native,
          orderListId: ocoResult.orderListId,
          symbol: plan.symbol,
          stopPrice: plan.stopLoss.price,
          takeProfitPrice: tp.price,
          quantity: totalQuantity,
          orderIds: ocoResult.orderIds,
        },
        planId: plan.id,
      });
    } else {
      // --- Standard path: separate stop-loss + take-profit orders ---

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

      let stopOrder: Order;
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

        let tpOrder: Order;
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

    // Step 10: Audit log success and return
    auditLog.success(userId, "EXECUTE_PLAN", {
      planId: plan.id,
      symbol: plan.symbol,
      tradeId: trade.id,
      orderCount: placedOrders.length,
    }, { planId: plan.id, tradeId: trade.id });

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

    // Audit log failure
    auditLog.failure(userId, "EXECUTE_PLAN", { planId: plan.id }, errorMessage, { planId: plan.id });

    return {
      success: false,
      error: `Unexpected execution error: ${errorMessage}`,
      orders: placedOrders,
    };
  }
}

/**
 * Execute a grid entry trading plan
 *
 * Places multiple limit buy orders across grid levels with a single stop loss.
 * Take profits are NOT placed during execution - they are handled by the monitor
 * after grid levels fill.
 *
 * @param client - Authenticated Binance client
 * @param plan - The grid trading plan to execute
 * @param config - Gordon configuration
 * @param portfolio - Current portfolio state
 * @returns ExecutionResult with success status, trade, and order details
 */
async function executeGridPlan(
  client: Exchange,
  plan: Plan,
  config: GordonConfig,
  portfolio: PortfolioState
): Promise<ExecutionResult> {
  const placedOrders: PlacedOrder[] = [];

  logger.info("Executing grid plan", {
    planId: plan.id,
    symbol: plan.symbol,
    gridLevels: plan.grid!.levels.length,
  });

  // Grid must exist (already checked in executePlan)
  const grid = plan.grid!;

  try {
    // Step 1: Calculate quantities for each grid level
    const gridOrders: { price: number; quantity: number; levelIndex: number }[] = [];
    let totalQuantity = 0;

    for (let i = 0; i < grid.levels.length; i++) {
      const level = grid.levels[i];
      if (!level) continue;

      const levelAllocation = plan.allocation.amount * level.percentOfAllocation;
      const quantity = roundQuantity(levelAllocation / level.price);

      if (quantity > 0) {
        gridOrders.push({
          price: level.price,
          quantity,
          levelIndex: i + 1,
        });
        totalQuantity += quantity;
      }
    }

    if (gridOrders.length === 0) {
      return {
        success: false,
        error: "No valid grid orders could be created. Check allocation amounts.",
        orders: [],
      };
    }

    logger.debug("Grid orders calculated", {
      orderCount: gridOrders.length,
      totalQuantity,
    });

    // Step 2: Place limit buy orders for each grid level
    for (const gridOrder of gridOrders) {
      const orderParams: OrderParams = {
        symbol: plan.symbol,
        side: "BUY",
        type: "LIMIT",
        quantity: gridOrder.quantity,
        price: roundPrice(gridOrder.price),
        timeInForce: "GTC",
        newClientOrderId: generateClientOrderId(plan.id, `grid${gridOrder.levelIndex}`),
      };

      let order: Order;
      try {
        order = await client.placeOrder(orderParams);
        logger.info("Grid level order placed", {
          level: gridOrder.levelIndex,
          orderId: order.orderId,
          price: gridOrder.price,
          quantity: gridOrder.quantity,
        });
      } catch (error) {
        // Rollback all previously placed orders
        await rollbackOrders(client, plan.symbol, placedOrders, plan.id);

        const errorMessage = isGordonError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unknown error";

        logger.error("Grid level order failed", error as Error, {
          level: gridOrder.levelIndex,
          params: orderParams,
        });
        logEvent({
          type: "ERROR",
          data: {
            action: "GRID_ORDER_FAILED",
            level: gridOrder.levelIndex,
            params: orderParams,
            error: errorMessage,
          },
          planId: plan.id,
        });

        return {
          success: false,
          error: `Failed to place grid level ${gridOrder.levelIndex} order: ${errorMessage}. All orders rolled back.`,
          orders: placedOrders,
        };
      }

      placedOrders.push({
        type: "grid",
        orderId: order.orderId.toString(),
        price: gridOrder.price,
        quantity: gridOrder.quantity,
      });

      logEvent({
        type: "ORDER_PLACED",
        data: {
          action: `GRID_LEVEL_${gridOrder.levelIndex}`,
          orderId: order.orderId.toString(),
          symbol: plan.symbol,
          side: "BUY",
          type: "LIMIT",
          price: gridOrder.price,
          quantity: gridOrder.quantity,
        },
        planId: plan.id,
      });
    }

    // Step 3: Place single stop loss for total quantity
    const stopOrderParams: OrderParams = {
      symbol: plan.symbol,
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      quantity: roundQuantity(totalQuantity),
      price: roundPrice(plan.stopLoss.price * 0.995), // Limit price slightly below stop
      stopPrice: roundPrice(plan.stopLoss.price),
      timeInForce: "GTC",
      newClientOrderId: generateClientOrderId(plan.id, "stop"),
    };

    let stopOrder: Order;
    try {
      stopOrder = await client.placeOrder(stopOrderParams);
      logger.info("Grid stop loss placed", {
        orderId: stopOrder.orderId,
        stopPrice: plan.stopLoss.price,
        quantity: totalQuantity,
      });
    } catch (error) {
      // Rollback all grid orders
      await rollbackOrders(client, plan.symbol, placedOrders, plan.id);

      const errorMessage = isGordonError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown error";

      logger.error("Grid stop order failed", error as Error, { params: stopOrderParams });
      logEvent({
        type: "ERROR",
        data: {
          action: "GRID_STOP_ORDER_FAILED",
          params: stopOrderParams,
          error: errorMessage,
        },
        planId: plan.id,
      });

      return {
        success: false,
        error: `Failed to place stop-loss order: ${errorMessage}. All grid orders rolled back.`,
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

    // Step 4: Create Trade record with PARTIAL status (no fills yet)
    // Note: Take profits are NOT placed here - they will be placed by the monitor
    // after grid levels fill, based on the average entry price
    const trade = createTrade({
      planId: plan.id,
      openedAt: new Date().toISOString(),
      closedAt: null,
      symbol: plan.symbol,
      entries: [], // Empty - no fills yet
      exits: [],
      averageEntry: 0, // Will be calculated as levels fill
      realizedPnl: 0,
      realizedPnlPercent: 0,
      status: "PARTIAL", // Grid trades start as PARTIAL until levels fill
    });

    // Emit trade opened event
    await emitEvent("trade:opened", { trade, planId: plan.id });

    // Step 5: Log trade creation
    logger.info("Grid trade created", {
      tradeId: trade.id,
      symbol: plan.symbol,
      gridLevels: gridOrders.length,
      totalQuantity,
      orderCount: placedOrders.length,
    });

    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "GRID_TRADE_CREATED",
        tradeId: trade.id,
        symbol: plan.symbol,
        gridLevels: gridOrders.length,
        totalQuantity,
        orderCount: placedOrders.length,
        orders: placedOrders.map((o) => ({
          type: o.type,
          orderId: o.orderId,
          price: o.price,
        })),
      },
      planId: plan.id,
      tradeId: trade.id,
    });

    // Step 6: Update plan status to EXECUTING
    updatePlan(plan.id, { status: "EXECUTING" });

    // Step 7: Return success
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

    logger.error("Unexpected grid execution error", error as Error, { planId: plan.id });
    logEvent({
      type: "ERROR",
      data: {
        action: "GRID_EXECUTION_FAILED",
        error: errorMessage,
        placedOrdersCount: placedOrders.length,
      },
      planId: plan.id,
    });

    return {
      success: false,
      error: `Unexpected grid execution error: ${errorMessage}`,
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
  client: Exchange,
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
  client: Exchange,
  trade: Trade,
  reason: CloseReason,
  userId: string = "system"
): Promise<CloseResult> {
  logger.info("Closing trade", { tradeId: trade.id, symbol: trade.symbol, reason });

  // Audit: Record close attempt
  auditLog.record(userId, "CLOSE_TRADE", {
    tradeId: trade.id,
    symbol: trade.symbol,
    reason,
  }, "PENDING", { tradeId: trade.id, planId: trade.planId });

  if (trade.status === "CLOSED") {
    auditLog.failure(userId, "CLOSE_TRADE", { tradeId: trade.id }, "Trade is already closed", { tradeId: trade.id });
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

    let sellOrder: Order;
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
    const executedQuantity = sellOrder.executedQty;
    const exitPrice = executedQuantity > 0
      ? sellOrder.cummulativeQuoteQty / executedQuantity
      : trade.averageEntry;

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

    // Audit log success
    auditLog.success(userId, "CLOSE_TRADE", {
      tradeId: trade.id,
      symbol: trade.symbol,
      reason,
      pnl: totalRealizedPnl,
      pnlPercent: realizedPnlPercent,
    }, { tradeId: trade.id, planId: trade.planId, resultDetails: `PnL: ${totalRealizedPnl.toFixed(2)}` });

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

    // Audit log failure
    auditLog.failure(userId, "CLOSE_TRADE", { tradeId: trade.id, reason }, errorMessage, { tradeId: trade.id, planId: trade.planId });

    return {
      success: false,
      error: `Failed to close trade: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Fill Tracking & Partial Fill Handling
// ============================================================================

/**
 * Fill tracker utility for monitoring order fill status
 */
export const fillTracker = {
  /**
   * Get fill status for an order
   */
  async getStatus(
    client: Exchange,
    symbol: string,
    orderId: string
  ): Promise<FillStatus> {
    const order = await client.getOrderStatus(symbol, orderId);
    const executedQty = order.executedQty;
    const origQty = order.quantity;
    const avgPrice = executedQty > 0
      ? order.cummulativeQuoteQty / executedQty
      : 0;

    return {
      orderId: order.orderId.toString(),
      status: order.status as FillStatus["status"],
      filledQuantity: executedQty,
      remainingQuantity: origQty - executedQty,
      averagePrice: avgPrice,
      isComplete: order.status === "FILLED" || order.status === "CANCELED" || order.status === "EXPIRED" || order.status === "REJECTED",
    };
  },

  /**
   * Check if an order is fully filled
   */
  async isFilled(
    client: Exchange,
    symbol: string,
    orderId: string
  ): Promise<boolean> {
    const status = await this.getStatus(client, symbol, orderId);
    return status.status === "FILLED";
  },

  /**
   * Check if an order is partially filled
   */
  async isPartiallyFilled(
    client: Exchange,
    symbol: string,
    orderId: string
  ): Promise<boolean> {
    const status = await this.getStatus(client, symbol, orderId);
    return status.status === "PARTIALLY_FILLED";
  },
};

/**
 * Wait for an order to fill with timeout and partial fill handling
 *
 * @param client - Authenticated Binance client
 * @param symbol - Trading pair symbol
 * @param orderId - Order ID to wait for
 * @param options - Wait options (timeout, partial fill handling)
 * @returns WaitForFillResult with fill status
 */
export async function waitForFill(
  client: Exchange,
  symbol: string,
  orderId: string,
  options: WaitForFillOptions = {}
): Promise<WaitForFillResult> {
  const {
    timeoutMs = DEFAULT_FILL_WAIT_TIMEOUT_MS,
    onPartialFill = "continue",
    pollIntervalMs = FILL_POLL_INTERVAL_MS,
  } = options;

  const startTime = Date.now();

  logger.debug("Waiting for fill", { symbol, orderId, timeoutMs, onPartialFill });

  while (true) {
    try {
      const fillStatus = await fillTracker.getStatus(client, symbol, orderId);

      // Order is complete (filled, canceled, expired, or rejected)
      if (fillStatus.isComplete) {
        logger.info("Order fill complete", {
          orderId,
          status: fillStatus.status,
          filledQuantity: fillStatus.filledQuantity,
        });

        return {
          success: fillStatus.status === "FILLED",
          fillStatus,
          timedOut: false,
          error: fillStatus.status === "REJECTED" ? "Order was rejected" : undefined,
        };
      }

      // Handle partial fills
      if (fillStatus.status === "PARTIALLY_FILLED" && onPartialFill === "cancel") {
        logger.info("Canceling partially filled order", {
          orderId,
          filledQuantity: fillStatus.filledQuantity,
          remainingQuantity: fillStatus.remainingQuantity,
        });

        try {
          await client.cancelOrder(symbol, orderId);
          const finalStatus = await fillTracker.getStatus(client, symbol, orderId);

          return {
            success: finalStatus.filledQuantity > 0,
            fillStatus: finalStatus,
            timedOut: false,
          };
        } catch (cancelError) {
          logger.error("Failed to cancel partial order", cancelError as Error);
          return {
            success: false,
            fillStatus,
            timedOut: false,
            error: "Failed to cancel partial order",
          };
        }
      }

      // Check timeout
      if (Date.now() - startTime >= timeoutMs) {
        logger.warn("Wait for fill timed out", { orderId, elapsed: Date.now() - startTime });

        return {
          success: false,
          fillStatus,
          timedOut: true,
          error: `Timeout waiting for fill after ${timeoutMs}ms`,
        };
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error checking fill status", error as Error, { orderId });

      return {
        success: false,
        fillStatus: {
          orderId,
          status: "NEW",
          filledQuantity: 0,
          remainingQuantity: 0,
          averagePrice: 0,
          isComplete: false,
        },
        timedOut: false,
        error: `Error checking fill status: ${errorMessage}`,
      };
    }
  }
}

// ============================================================================
// Idempotency & Order Deduplication
// ============================================================================

/**
 * Check if an order already exists by client order ID
 * Used for idempotency to prevent duplicate orders on retry
 *
 * @param client - Authenticated Binance client
 * @param symbol - Trading pair symbol
 * @param clientOrderId - The client order ID to check
 * @returns The existing order if found, null otherwise
 */
export async function getExistingOrder(
  client: Exchange,
  symbol: string,
  clientOrderId: string
): Promise<Order | null> {
  try {
    // Get all orders for the symbol and find by clientOrderId
    const orders = await client.getOrderHistory(symbol, 100);
    const existingOrder = orders.find(
      (order) => order.clientOrderId === clientOrderId
    );

    if (existingOrder) {
      logger.info("Found existing order", {
        clientOrderId,
        orderId: existingOrder.orderId,
        status: existingOrder.status,
      });
      return existingOrder;
    }

    // Also check open orders
    const openOrders = await client.getOpenOrders(symbol);
    const existingOpenOrder = openOrders.find(
      (order) => order.clientOrderId === clientOrderId
    );

    if (existingOpenOrder) {
      logger.info("Found existing open order", {
        clientOrderId,
        orderId: existingOpenOrder.orderId,
        status: existingOpenOrder.status,
      });
      return existingOpenOrder;
    }

    return null;
  } catch (error) {
    logger.error("Error checking for existing order", error as Error, { clientOrderId });
    return null;
  }
}

/**
 * Place an order with idempotency check
 * If order with same clientOrderId already exists, returns that order instead
 *
 * @param client - Authenticated Binance client
 * @param params - Order parameters including newClientOrderId
 * @returns The placed or existing order
 */
export async function placeOrderIdempotent(
  client: Exchange,
  params: OrderParams
): Promise<Order> {
  if (!params.newClientOrderId) {
    // No client order ID - just place normally
    return client.placeOrder(params);
  }

  // Check if order already exists
  const existingOrder = await getExistingOrder(
    client,
    params.symbol,
    params.newClientOrderId
  );

  if (existingOrder) {
    logger.info("Order already exists, returning existing order", {
      clientOrderId: params.newClientOrderId,
      orderId: existingOrder.orderId,
    });
    return existingOrder;
  }

  // Place new order
  return client.placeOrder(params);
}

// ============================================================================
// Partial Position Close
// ============================================================================

/**
 * Close a partial position (tier-based exits)
 * Supports TP1=50%, TP2=30%, TP3=20% style exits
 *
 * @param client - Authenticated Binance client
 * @param tradeId - ID of the trade to partially close
 * @param percentage - Percentage of remaining position to close (0.0 to 1.0)
 * @param reason - Reason for closing (TP1, TP2, TP3, MANUAL)
 * @returns PartialCloseResult with closed quantity and PnL
 */
export async function closePartialPosition(
  client: Exchange,
  tradeId: string,
  percentage: number,
  reason: "TP1" | "TP2" | "TP3" | "MANUAL" = "MANUAL"
): Promise<PartialCloseResult> {
  logger.info("Closing partial position", { tradeId, percentage, reason });

  // Validate percentage
  if (percentage <= 0 || percentage > 1) {
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity: 0,
      exitPrice: 0,
      pnl: 0,
      error: "Percentage must be between 0 and 1",
    };
  }

  // Get trade
  const trade = getTrade(tradeId);
  if (!trade) {
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity: 0,
      exitPrice: 0,
      pnl: 0,
      error: `Trade not found: ${tradeId}`,
    };
  }

  if (trade.status === "CLOSED") {
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity: 0,
      exitPrice: 0,
      pnl: 0,
      error: "Trade is already closed",
    };
  }

  // Calculate remaining quantity
  const totalEntryQuantity = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalExitQuantity = trade.exits.reduce((sum, e) => sum + e.quantity, 0);
  const remainingQuantity = roundQuantity(totalEntryQuantity - totalExitQuantity);

  if (remainingQuantity <= 0) {
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity: 0,
      exitPrice: 0,
      pnl: 0,
      error: "No remaining position to close",
    };
  }

  // Calculate quantity to close
  const quantityToClose = roundQuantity(remainingQuantity * percentage);

  if (quantityToClose <= 0) {
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity,
      exitPrice: 0,
      pnl: 0,
      error: "Calculated quantity too small to close",
    };
  }

  // Place market sell order
  const sellOrderParams: OrderParams = {
    symbol: trade.symbol,
    side: "SELL",
    type: "MARKET",
    quantity: quantityToClose,
    newClientOrderId: generateClientOrderId(trade.planId, `partial_${reason.toLowerCase()}`),
  };

  let sellOrder: Order;
  try {
    sellOrder = await placeOrderIdempotent(client, sellOrderParams);
    logger.info("Partial close order placed", {
      orderId: sellOrder.orderId,
      quantity: quantityToClose,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Partial close order failed", error as Error, { params: sellOrderParams });

    logEvent({
      type: "ERROR",
      data: {
        action: "PARTIAL_CLOSE_FAILED",
        params: sellOrderParams,
        error: errorMessage,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });

    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity,
      exitPrice: 0,
      pnl: 0,
      error: `Failed to place partial close order: ${errorMessage}`,
    };
  }

  // Calculate exit price and PnL
  const executedQuantity = sellOrder.executedQty;
  const exitPrice = executedQuantity > 0
    ? sellOrder.cummulativeQuoteQty / executedQuantity
    : trade.averageEntry;
  const newRemainingQuantity = roundQuantity(remainingQuantity - executedQuantity);

  // Calculate PnL for this partial close
  const exitValue = exitPrice * executedQuantity;
  const entryValue = trade.averageEntry * executedQuantity;
  const pnl = exitValue - entryValue;

  // Create exit fill record
  const exitFill: ExitFill = {
    orderId: sellOrder.orderId.toString(),
    price: exitPrice,
    quantity: executedQuantity,
    filledAt: new Date().toISOString(),
    reason,
  };

  // Update trade
  const updatedExits = [...trade.exits, exitFill];
  const totalRealizedPnl = trade.realizedPnl + pnl;
  const totalInvested = trade.averageEntry * totalEntryQuantity;
  const realizedPnlPercent = totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0;

  // Determine new status
  const newStatus = newRemainingQuantity <= 0 ? "CLOSED" : "PARTIAL";

  updateTrade(trade.id, {
    exits: updatedExits,
    realizedPnl: totalRealizedPnl,
    realizedPnlPercent,
    status: newStatus,
    closedAt: newStatus === "CLOSED" ? new Date().toISOString() : null,
  });

  // Log and emit events
  logger.info("Partial position closed", {
    tradeId: trade.id,
    reason,
    closedQuantity: executedQuantity,
    remainingQuantity: newRemainingQuantity,
    pnl,
  });

  logEvent({
    type: "ORDER_FILLED",
    data: {
      action: "PARTIAL_CLOSE",
      reason,
      orderId: sellOrder.orderId.toString(),
      exitPrice,
      quantity: executedQuantity,
      remainingQuantity: newRemainingQuantity,
      pnl,
    },
    tradeId: trade.id,
    planId: trade.planId,
  });

  await emitEvent("trade:partial_close", {
    tradeId: trade.id,
    trade: { ...trade, exits: updatedExits, realizedPnl: totalRealizedPnl, status: newStatus },
    symbol: trade.symbol,
    reason,
    closedQuantity: executedQuantity,
    remainingQuantity: newRemainingQuantity,
    pnl,
  });

  return {
    success: true,
    closedQuantity: executedQuantity,
    remainingQuantity: newRemainingQuantity,
    exitPrice,
    pnl,
  };
}

/**
 * Close position using tier-based exits
 * Standard tier percentages: TP1=50%, TP2=30%, TP3=20%
 *
 * @param client - Authenticated Binance client
 * @param tradeId - ID of the trade
 * @param tier - Which tier to execute (1, 2, or 3)
 * @returns PartialCloseResult
 */
export async function closeTierPosition(
  client: Exchange,
  tradeId: string,
  tier: 1 | 2 | 3
): Promise<PartialCloseResult> {
  // Standard tier percentages (of remaining position)
  const tierPercentages: Record<1 | 2 | 3, number> = {
    1: 0.5,  // TP1: 50% of position
    2: 0.6,  // TP2: 60% of remaining (30% of original)
    3: 1.0,  // TP3: 100% of remaining (20% of original)
  };

  const reason = `TP${tier}` as "TP1" | "TP2" | "TP3";
  return closePartialPosition(client, tradeId, tierPercentages[tier], reason);
}

// ============================================================================
// OCO (One-Cancels-Other) Order Placement
// ============================================================================

/**
 * Result of an OCO order placement
 */
export interface OCOResult {
  success: boolean;
  /** Native OCO orderListId (Binance-family only) */
  orderListId?: number;
  /** Individual order IDs placed */
  orderIds: string[];
  /** Whether native OCO was used or separate orders */
  native: boolean;
  error?: string;
}

/**
 * Check whether an exchange supports native OCO orders.
 * Returns the exchange cast to ExchangeExtended if OCO is available, null otherwise.
 */
function getOCOCapableExchange(exchange: Exchange): ExchangeExtended | null {
  const ext = exchange as ExchangeExtended;
  if (typeof ext.placeOCOOrder === "function") {
    return ext;
  }
  return null;
}

/**
 * Place an OCO (One-Cancels-Other) order combining stop-loss and take-profit.
 *
 * For Binance-family exchanges that support native OCO, this uses the atomic
 * /api/v3/orderList/oco endpoint so both legs are guaranteed to be coordinated.
 *
 * For other exchanges, this places two separate orders (stop-loss-limit + limit)
 * and returns both order IDs. NOTE: without native OCO the caller is responsible
 * for cancelling the other leg when one fills (the Monitor handles this).
 *
 * @param client - Authenticated exchange client
 * @param symbol - Trading pair (e.g. "BTCUSDT")
 * @param side - Order side (typically "SELL" for exit OCO)
 * @param quantity - Position quantity
 * @param stopPrice - Stop-loss trigger price
 * @param stopLimitPrice - Limit price for the stop-loss leg (set slightly below stopPrice)
 * @param takeProfitPrice - Take-profit limit price
 * @param planId - Optional plan ID for audit trail
 * @param userId - User ID for audit logging
 * @returns OCOResult with order IDs and success status
 */
export async function placeOCOOrders(
  client: Exchange,
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
  stopPrice: number,
  stopLimitPrice: number,
  takeProfitPrice: number,
  planId?: string,
  userId: string = "system"
): Promise<OCOResult> {
  const logPrefix = planId ? `[${planId}] ` : "";
  logger.info(`${logPrefix}Placing OCO order`, { symbol, side, quantity, stopPrice, takeProfitPrice });

  // Audit: Record OCO attempt
  auditLog.record(userId, "PLACE_OCO_ORDER", {
    symbol,
    side,
    quantity,
    stopPrice,
    stopLimitPrice,
    takeProfitPrice,
    planId,
  }, "PENDING", planId ? { planId } : undefined);

  // -----------------------------------------------------------------------
  // Path A: Native OCO (Binance-family)
  // -----------------------------------------------------------------------
  const ocoExchange = getOCOCapableExchange(client);
  if (ocoExchange) {
    try {
      const ocoParams: OCOOrderParams = {
        symbol,
        side,
        quantity: roundQuantity(quantity),
        price: roundPrice(takeProfitPrice),
        stopPrice: roundPrice(stopPrice),
        stopLimitPrice: roundPrice(stopLimitPrice),
        stopLimitTimeInForce: "GTC",
      };

      const result = await ocoExchange.placeOCOOrder!(ocoParams);

      const orderIds = result.orders.map((o) => o.orderId.toString());

      logger.info(`${logPrefix}Native OCO placed`, {
        orderListId: result.orderListId,
        orderIds,
      });

      logEvent({
        type: "ORDER_PLACED",
        data: {
          action: "OCO_PLACED",
          native: true,
          orderListId: result.orderListId,
          symbol,
          side,
          quantity,
          stopPrice,
          takeProfitPrice,
          orderIds,
        },
        planId,
      });

      auditLog.success(userId, "PLACE_OCO_ORDER", {
        symbol,
        orderListId: result.orderListId,
        orderIds,
        native: true,
      }, planId ? { planId } : undefined);

      return {
        success: true,
        orderListId: result.orderListId,
        orderIds,
        native: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`${logPrefix}Native OCO failed`, error as Error, { symbol });

      logEvent({
        type: "ERROR",
        data: {
          action: "OCO_NATIVE_FAILED",
          symbol,
          error: errorMessage,
        },
        planId,
      });

      auditLog.failure(userId, "PLACE_OCO_ORDER", { symbol, native: true }, errorMessage, planId ? { planId } : undefined);

      return {
        success: false,
        orderIds: [],
        native: true,
        error: `Native OCO failed: ${errorMessage}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Path B: Fallback — place two separate orders
  // -----------------------------------------------------------------------
  const placedOrderIds: string[] = [];

  try {
    // Leg 1: Stop-loss limit order
    const stopParams: OrderParams = {
      symbol,
      side,
      type: "STOP_LOSS_LIMIT",
      quantity: roundQuantity(quantity),
      price: roundPrice(stopLimitPrice),
      stopPrice: roundPrice(stopPrice),
      timeInForce: "GTC",
      newClientOrderId: planId ? generateClientOrderId(planId, "oco_stop") : undefined,
    };

    const stopOrder = await client.placeOrder(stopParams);
    placedOrderIds.push(stopOrder.orderId.toString());

    logger.info(`${logPrefix}OCO stop-loss leg placed`, {
      orderId: stopOrder.orderId,
      stopPrice,
    });

    // Leg 2: Take-profit limit order
    const tpParams: OrderParams = {
      symbol,
      side,
      type: "LIMIT",
      quantity: roundQuantity(quantity),
      price: roundPrice(takeProfitPrice),
      timeInForce: "GTC",
      newClientOrderId: planId ? generateClientOrderId(planId, "oco_tp") : undefined,
    };

    let tpOrder: Order;
    try {
      tpOrder = await client.placeOrder(tpParams);
      placedOrderIds.push(tpOrder.orderId.toString());

      logger.info(`${logPrefix}OCO take-profit leg placed`, {
        orderId: tpOrder.orderId,
        takeProfitPrice,
      });
    } catch (error) {
      // TP leg failed — roll back the stop leg
      logger.warn(`${logPrefix}OCO TP leg failed, rolling back stop leg`, { stopOrderId: placedOrderIds[0] });
      await safelyCancelOrder(client, symbol, placedOrderIds[0]!, planId ?? "");

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      auditLog.failure(userId, "PLACE_OCO_ORDER", { symbol, native: false }, errorMessage, planId ? { planId } : undefined);

      return {
        success: false,
        orderIds: [],
        native: false,
        error: `OCO take-profit leg failed: ${errorMessage}. Stop leg rolled back.`,
      };
    }

    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "OCO_PLACED",
        native: false,
        symbol,
        side,
        quantity,
        stopPrice,
        takeProfitPrice,
        orderIds: placedOrderIds,
      },
      planId,
    });

    auditLog.success(userId, "PLACE_OCO_ORDER", {
      symbol,
      orderIds: placedOrderIds,
      native: false,
    }, planId ? { planId } : undefined);

    return {
      success: true,
      orderIds: placedOrderIds,
      native: false,
    };
  } catch (error) {
    // Roll back any placed orders
    for (const oid of placedOrderIds) {
      await safelyCancelOrder(client, symbol, oid, planId ?? "");
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(`${logPrefix}OCO fallback failed`, error as Error, { symbol });

    auditLog.failure(userId, "PLACE_OCO_ORDER", { symbol, native: false }, errorMessage, planId ? { planId } : undefined);

    return {
      success: false,
      orderIds: [],
      native: false,
      error: `OCO fallback failed: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Plan Expiration Management
// ============================================================================

/**
 * Check if a plan has expired
 *
 * @param plan - The plan to check
 * @returns true if plan has expired
 */
export function isPlanExpired(plan: Plan): boolean {
  // Check if plan has expiresAt field (extended plan type)
  const expiresAt = (plan as Plan & { expiresAt?: string }).expiresAt;

  if (!expiresAt) {
    // If no expiration set, check if plan is older than default expiration
    const createdAt = new Date(plan.createdAt).getTime();
    const now = Date.now();
    return now - createdAt > DEFAULT_PLAN_EXPIRATION_MS;
  }

  return new Date(expiresAt).getTime() < Date.now();
}

/**
 * Get default expiration date for a plan (24 hours from now)
 */
export function getDefaultPlanExpiration(): string {
  return new Date(Date.now() + DEFAULT_PLAN_EXPIRATION_MS).toISOString();
}

/**
 * Cleanup expired plans by marking them as CANCELLED
 * Should be called periodically (e.g., in monitor cycle)
 *
 * @returns Number of plans cleaned up
 */
export function cleanupExpiredPlans(): number {
  logger.debug("Running expired plan cleanup");

  // Get all plans that could be expired (DRAFT or APPROVED status)
  const draftPlans = listPlans({ status: "DRAFT" });
  const approvedPlans = listPlans({ status: "APPROVED" });
  const plansToCheck = [...draftPlans, ...approvedPlans];

  let cleanedCount = 0;

  for (const plan of plansToCheck) {
    if (isPlanExpired(plan)) {
      logger.info("Cleaning up expired plan", { planId: plan.id, symbol: plan.symbol });

      updatePlan(plan.id, { status: "CANCELLED" });

      logEvent({
        type: "ALERT",
        data: {
          action: "PLAN_EXPIRED",
          planId: plan.id,
          symbol: plan.symbol,
          createdAt: plan.createdAt,
        },
        planId: plan.id,
      });

      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.info("Expired plan cleanup complete", { cleanedCount });
  }

  return cleanedCount;
}

// ============================================================================
// Concurrent Trade Limit Management
// ============================================================================

/**
 * Result of concurrent trade limit check
 */
export interface ConcurrentTradeLimitResult {
  canOpen: boolean;
  activeCount: number;
  maxAllowed: number;
  remainingSlots: number;
}

/**
 * Get the count of currently active trades
 * Active trades are those with status "OPEN" or "PARTIAL"
 */
export function getActiveTradesCount(): number {
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  return openTrades.length + partialTrades.length;
}

/**
 * Check if a new trade can be opened based on concurrent trade limit
 *
 * @param config - Gordon configuration with preferences
 * @returns ConcurrentTradeLimitResult with check result and details
 */
export function checkConcurrentTradeLimit(
  config: GordonConfig
): ConcurrentTradeLimitResult {
  const maxConcurrentTrades =
    config.preferences?.maxConcurrentTrades ?? DEFAULT_MAX_CONCURRENT_TRADES;
  const activeCount = getActiveTradesCount();
  const remainingSlots = Math.max(0, maxConcurrentTrades - activeCount);

  return {
    canOpen: activeCount < maxConcurrentTrades,
    activeCount,
    maxAllowed: maxConcurrentTrades,
    remainingSlots,
  };
}

/**
 * Get detailed information about active trades
 * Useful for displaying to users when limit is reached
 */
export function getActiveTradesSummary(): Array<{
  tradeId: string;
  symbol: string;
  status: string;
  openedAt: string;
}> {
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const allActiveTrades = [...openTrades, ...partialTrades];

  return allActiveTrades.map((trade) => ({
    tradeId: trade.id,
    symbol: trade.symbol,
    status: trade.status,
    openedAt: trade.openedAt,
  }));
}

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

import type { Exchange, Order, OrderParams, OCOOrderParams } from "../../infra/exchange/index.ts";
import { validatePlan } from "./validator.ts";
import {
  createTrade,
  updateTrade,
  getTrade,
  listTrades,
} from "../../infra/storage/entities/trades.ts";
import { updatePlan, listPlans, getPlan } from "../../infra/storage/entities/plans.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import { isGordonError } from "../../errors/index.ts";
import { auditLog } from "../../infra/platform/audit/index.ts";
import { checkKillSwitchForOrder } from "../../infra/safety/killSwitchGate.ts";
import {
  getNativeOcoExchangeForTakeProfits,
  isManagedExitsAcknowledged,
  MANAGED_EXITS_ACK_FLAG,
  requiresProcessManagedTakeProfit,
} from "../../infra/safety/managedExits.ts";
import {
  assertConsentForExposure,
  assertLiveConsent,
  type ExposureEffect,
} from "../../infra/trading/execution/preflight.ts";
import type { Plan, Trade, GordonConfig, EntryFill, ExitFill } from "../../types/index.ts";
import { exchangePortfolioIdentity } from "../../infra/safety/portfolioIdentity.ts";
import { recordTradeClosureDebrief } from "../../infra/trading/ops/debriefMatrix.ts";

const logger = createModuleLogger("executor");

function recordConfirmedTradeClosure(
  client: Exchange,
  trade: Pick<Trade, "id" | "symbol">,
  pnlUsd: number,
  pnlPercent: number,
  reason: string,
): void {
  recordTradeClosureDebrief({
    tradeId: trade.id,
    symbol: trade.symbol,
    pnlUsd,
    pnlPercent,
    reason,
    portfolioIdentity: exchangePortfolioIdentity(client),
  });
}

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
  /** Whether the venue filled the full quantity requested by this call. */
  fullyFilled?: boolean;
  /** Whether the remaining position has confirmed protective coverage. */
  protectionRestored?: boolean;
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

// Trade-state updates are not transactional with venue dispatch. Serialize
// close mutations per trade inside one process so two monitor/manual paths
// cannot both account the same recovered venue fill. Cross-process recovery is
// handled by deterministic client-order IDs plus the persisted exit orderId.
const activeTradeCloseClaims = new Set<string>();

/**
 * Generate a unique client order ID for tracking
 */
export function generateClientOrderId(planId: string, type: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `gordon_${planId.slice(4, 12)}_${type}_${timestamp}_${random}`;
}

/**
 * Deterministic client order ID for plan-scoped orders (entry/stop/tp/grid),
 * each placed exactly once per execution. Same (planId, type) always yields
 * the same id — so a retry of executePlan (e.g. after a partial failure or a
 * network timeout that left the plan APPROVED) is idempotent: the exchange
 * dedupes on the stable clientOrderId and placeOrderIdempotent finds the prior
 * order in history instead of placing a duplicate. Keeps the exact
 * `gordon_<planFragment>_<type>` prefix so order-recovery + reconciliation
 * matching are unaffected; only the entropy suffix of generateClientOrderId is
 * dropped (that suffix is retained for orders that legitimately repeat, e.g.
 * partial closes / OCO re-arms).
 */
export function generateDeterministicClientOrderId(planId: string, type: string): string {
  return `gordon_${planId.slice(4, 12)}_${type}`;
}

/**
 * Round quantity to appropriate precision for exchange orders
 * Default to 8 decimal places, which is safe for most pairs
 */
export function roundQuantity(quantity: number, precision: number = 8): number {
  const multiplier = 10 ** precision;
  return Math.floor(quantity * multiplier) / multiplier;
}

export function resolveTradeRemainingQuantity(trade: Pick<Trade, "entries" | "exits">): number {
  const entered = trade.entries.reduce((sum, fill) => sum + fill.quantity, 0);
  const exited = trade.exits.reduce((sum, fill) => sum + fill.quantity, 0);
  return roundQuantity(Math.max(0, entered - exited));
}

/**
 * Round price to appropriate precision
 */
export function roundPrice(price: number, precision: number = 8): number {
  const multiplier = 10 ** precision;
  return Math.round(price * multiplier) / multiplier;
}

/** Stop-limit price for exit orders: below trigger for SELL exits, above for BUY exits (shorts). */
export function stopLimitPriceForExit(stopPrice: number, exitSide: "BUY" | "SELL"): number {
  return exitSide === "SELL" ? roundPrice(stopPrice * 0.995) : roundPrice(stopPrice * 1.005);
}

export function exitSideForPlan(plan: Pick<Plan, "direction">): "BUY" | "SELL" {
  return plan.direction === "short" ? "BUY" : "SELL";
}

export function entrySideForPlan(plan: Pick<Plan, "direction">): "BUY" | "SELL" {
  return plan.direction === "short" ? "SELL" : "BUY";
}

export function pnlMultiplierForPlan(plan: Pick<Plan, "direction"> | null | undefined): number {
  return plan?.direction === "short" ? -1 : 1;
}

async function validateTradePermissions(
  exchange: Exchange,
): Promise<{ allowed: boolean; error?: string }> {
  // Interface-based permission check — every venue is now backed by CcxtAdapter,
  // which reports canTrade via the unified getAccountInfo(). (Previously a
  // Binance-specific branch reached into the raw client; that adapter is gone.)
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
  planId: string,
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
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
  planId: string,
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
  userId: string = "system",
): Promise<ExecutionResult> {
  const placedOrders: PlacedOrder[] = [];

  logger.info("Executing plan", { planId: plan.id, symbol: plan.symbol });

  const killBlock = checkKillSwitchForOrder(
    { userId, exchange: client },
    { instrument: plan.symbol, strategyId: plan.strategy, venue: client.exchangeId },
  );
  if (killBlock.blocked) {
    auditLog.blocked(userId, "EXECUTE_PLAN", { planId: plan.id }, killBlock.error, {
      planId: plan.id,
    });
    return {
      success: false,
      error: killBlock.error,
      orders: [],
      trade: undefined,
    };
  }

  // Audit: Record execution attempt
  auditLog.record(
    userId,
    "EXECUTE_PLAN",
    {
      planId: plan.id,
      symbol: plan.symbol,
      allocation: plan.allocation.amount,
      strategy: plan.strategy,
    },
    "PENDING",
    { planId: plan.id },
  );

  // Step 0: Validate trading permissions
  const permissionCheck = await validateTradePermissions(client);
  if (!permissionCheck.allowed) {
    auditLog.blocked(
      userId,
      "EXECUTE_PLAN",
      { planId: plan.id },
      permissionCheck.error || "Permission denied",
      { planId: plan.id },
    );
    return {
      success: false,
      error: permissionCheck.error,
      orders: [],
    };
  }

  // Step 1: Check permissionMode allows trade execution
  if (config.permissionMode === "strict") {
    logger.warn("Execution blocked - permissionMode is strict");
    return {
      success: false,
      error:
        "Cannot execute: permissionMode is 'strict' (read-only). Use '/auto' or '/ask' to enable trading.",
      orders: [],
    };
  }

  // Step 2: Run validator one more time with fresh data
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

  const usesProcessManagedTakeProfit = requiresProcessManagedTakeProfit(
    client,
    plan.takeProfit.length,
  );
  if (
    !(client.isSandbox ?? false) &&
    usesProcessManagedTakeProfit &&
    !isManagedExitsAcknowledged()
  ) {
    return {
      success: false,
      error:
        `Live take-profits without venue-native OCO require the process-managed exit reconciler. ` +
        `Acknowledge that Gordon must remain running by enabling ${MANAGED_EXITS_ACK_FLAG}, ` +
        "or use a venue-native OCO take-profit.",
      orders: [],
    };
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to get price", error as Error, { symbol: plan.symbol });
    return {
      success: false,
      error: `Failed to get current price for ${plan.symbol}: ${errorMessage}`,
      orders: [],
    };
  }

  // Step 5: Calculate quantity based on allocation and current price
  const priceForCalculation =
    plan.entry.type === "market" || plan.entry.price === null ? currentPrice : plan.entry.price;

  const totalQuantity = roundQuantity(plan.allocation.amount / priceForCalculation);

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
    const entrySide = entrySideForPlan(plan);
    const exitSide = exitSideForPlan(plan);

    const entryOrderParams: OrderParams = {
      symbol: plan.symbol,
      side: entrySide,
      type: plan.entry.type === "market" ? "MARKET" : "LIMIT",
      quantity: totalQuantity,
      newClientOrderId: generateDeterministicClientOrderId(plan.id, "entry"),
    };

    if (plan.entry.type === "limit" && plan.entry.price !== null) {
      entryOrderParams.price = roundPrice(plan.entry.price);
      entryOrderParams.timeInForce = "GTC";
    }

    let entryOrder: Order;
    try {
      entryOrder = await placeOrderIdempotent(client, entryOrderParams);
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

    if (entryOrder.status !== "FILLED") {
      const fillResult = await waitForFill(client, plan.symbol, entryOrder.orderId.toString(), {
        onPartialFill: "cancel",
      });
      if (fillResult.fillStatus.filledQuantity <= 0) {
        await safelyCancelOrder(client, plan.symbol, entryOrder.orderId.toString(), plan.id);
        return {
          success: false,
          error:
            fillResult.error ??
            "Entry order was acknowledged but no execution was confirmed; protective orders were not placed.",
          orders: placedOrders,
        };
      }
      entryOrder = await client.getOrderStatus(plan.symbol, entryOrder.orderId);
    }

    const entryPrice =
      entryOrder.executedQty > 0 && entryOrder.cummulativeQuoteQty > 0
        ? entryOrder.cummulativeQuoteQty / entryOrder.executedQty
        : entryOrder.price > 0
          ? entryOrder.price
          : (plan.entry.price ?? currentPrice);

    const exitQuantity = roundQuantity(entryOrder.executedQty);

    if (exitQuantity <= 0) {
      return {
        success: false,
        error: "Entry order has no filled quantity — cannot place protective exits.",
        orders: placedOrders,
      };
    }

    placedOrders.push({
      type: "entry",
      orderId: entryOrder.orderId.toString(),
      price: entryPrice,
      quantity: exitQuantity,
    });

    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "ENTRY",
        orderId: entryOrder.orderId.toString(),
        symbol: plan.symbol,
        side: entrySide,
        type: entryOrderParams.type,
        price: entryPrice,
        quantity: exitQuantity,
      },
      planId: plan.id,
    });

    const stopLimitPrice = stopLimitPriceForExit(plan.stopLoss.price, exitSide);

    // 6b + 6c. Place exit orders (stop-loss + take-profit)
    //
    // Optimization: When there is exactly one take-profit level AND the
    // exchange supports native OCO, place an atomic OCO order that pairs
    // the stop-loss with the take-profit. This guarantees one cancels the
    // other without relying on the monitor.
    //
    // For multiple take-profit levels (tiered exits), we fall back to
    // placing separate orders because OCO is a 1:1 pairing.

    const ocoExchange = getNativeOcoExchangeForTakeProfits(client, plan.takeProfit.length);

    if (ocoExchange) {
      // --- OCO path: single atomic order for SL + TP ---
      const tp = plan.takeProfit[0]!;

      const ocoResult = await placeOCOOrders(
        client,
        plan.symbol,
        exitSide,
        exitQuantity,
        plan.stopLoss.price,
        stopLimitPrice,
        tp.price,
        plan.id,
        userId,
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
          quantity: exitQuantity,
        });
      }
      if (ocoResult.orderIds[1]) {
        placedOrders.push({
          type: "take_profit",
          orderId: ocoResult.orderIds[1],
          price: tp.price,
          quantity: exitQuantity,
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
          quantity: exitQuantity,
          orderIds: ocoResult.orderIds,
        },
        planId: plan.id,
      });
    } else {
      // --- Standard path: separate stop-loss + take-profit orders ---

      // 6b. Place stop-loss order
      const stopOrderParams: OrderParams = {
        symbol: plan.symbol,
        side: exitSide,
        type: "STOP_LOSS_LIMIT",
        quantity: exitQuantity,
        price: stopLimitPrice,
        stopPrice: roundPrice(plan.stopLoss.price),
        timeInForce: "GTC",
        newClientOrderId: generateDeterministicClientOrderId(plan.id, "stop"),
      };

      let stopOrder: Order;
      try {
        stopOrder = await placeOrderIdempotent(
          client,
          stopOrderParams,
          protectiveReduction(exitSide, exitQuantity, exitQuantity),
        );
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
        quantity: exitQuantity,
      });

      logEvent({
        type: "ORDER_PLACED",
        data: {
          action: "STOP_LOSS",
          orderId: stopOrder.orderId.toString(),
          symbol: plan.symbol,
          side: exitSide,
          type: "STOP_LOSS_LIMIT",
          stopPrice: plan.stopLoss.price,
          quantity: exitQuantity,
        },
        planId: plan.id,
      });

      // Independent TP and stop orders cannot provide OCO semantics. Keep the
      // protective stop at the venue; the monitor executes each TP as a
      // confirmed, position-bounded close and then re-arms the stop for the
      logger.info("Take profits delegated to the managed exit reconciler", {
        planId: plan.id,
        levels: plan.takeProfit.length,
      });
    }

    // Step 7: Create Trade record with order IDs
    const entryFill: EntryFill = {
      orderId: entryOrder.orderId.toString(),
      price: entryPrice,
      quantity: exitQuantity,
      filledAt: entryOrder.updateTime
        ? new Date(entryOrder.updateTime).toISOString()
        : new Date().toISOString(),
    };

    const entryFilled =
      plan.entry.type === "market" ||
      entryOrder.status === "FILLED" ||
      entryOrder.status === "PARTIALLY_FILLED";

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
      status: entryFilled
        ? entryOrder.status === "PARTIALLY_FILLED" ||
          (entryOrder.executedQty > 0 && entryOrder.executedQty < totalQuantity)
          ? "PARTIAL"
          : "OPEN"
        : "PARTIAL",
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
    auditLog.success(
      userId,
      "EXECUTE_PLAN",
      {
        planId: plan.id,
        symbol: plan.symbol,
        tradeId: trade.id,
        orderCount: placedOrders.length,
      },
      { planId: plan.id, tradeId: trade.id },
    );

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

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

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
    auditLog.failure(userId, "EXECUTE_PLAN", { planId: plan.id }, errorMessage, {
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
  _config: GordonConfig,
  _portfolio: PortfolioState,
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

    // Step 2: Place limit entries for each grid level
    const gridEntrySide = entrySideForPlan(plan);
    for (const gridOrder of gridOrders) {
      const orderParams: OrderParams = {
        symbol: plan.symbol,
        side: gridEntrySide,
        type: "LIMIT",
        quantity: gridOrder.quantity,
        price: roundPrice(gridOrder.price),
        timeInForce: "GTC",
        newClientOrderId: generateDeterministicClientOrderId(
          plan.id,
          `grid${gridOrder.levelIndex}`,
        ),
      };

      let order: Order;
      try {
        order = await placeOrderIdempotent(client, orderParams);
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
          side: gridEntrySide,
          type: "LIMIT",
          price: gridOrder.price,
          quantity: gridOrder.quantity,
        },
        planId: plan.id,
      });
    }

    // Step 3: Stop-loss is deferred until grid levels fill — repairProtectiveOrders
    // and the monitor place/resize the stop from exchange-reported fill qty.
    logger.info("Grid stop deferred until fills", {
      planId: plan.id,
      plannedQuantity: totalQuantity,
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

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

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
export async function cancelTrade(client: Exchange, trade: Trade): Promise<CancelResult> {
  logger.info("Cancelling trade", { tradeId: trade.id, symbol: trade.symbol });

  if (trade.status === "CLOSED") {
    return {
      success: false,
      error: "Cannot cancel a closed trade.",
    };
  }

  try {
    const remainingQuantity = resolveTradeRemainingQuantity(trade);
    if (remainingQuantity > 0) {
      return {
        success: false,
        error: `Cannot cancel a trade with ${remainingQuantity} units of open exposure; use closeTrade so the venue confirms an exit fill.`,
      };
    }

    const openOrders = await client.getOpenOrders(trade.symbol);
    const planOrderPrefix = `gordon_${trade.planId.slice(4, 12)}_`;
    const planOpenOrders = openOrders.filter((order) =>
      order.clientOrderId?.startsWith(planOrderPrefix),
    );

    const cancelPromises = planOpenOrders.map(async (order) => {
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
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

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
 *
 * Deliberately skips kill-switch checks: kill switches gate NEW exposure,
 * not exits — closing a position reduces risk, by design.
 */
export async function closeTrade(
  client: Exchange,
  trade: Trade,
  reason: CloseReason,
  userId: string = "system",
): Promise<CloseResult> {
  if (activeTradeCloseClaims.has(trade.id)) {
    return {
      success: false,
      error: `A close operation is already in progress for trade ${trade.id}.`,
    };
  }
  activeTradeCloseClaims.add(trade.id);
  try {
    return await closeTradeUnlocked(client, trade, reason, userId);
  } finally {
    activeTradeCloseClaims.delete(trade.id);
  }
}

async function closeTradeUnlocked(
  client: Exchange,
  trade: Trade,
  reason: CloseReason,
  userId: string,
): Promise<CloseResult> {
  logger.info("Closing trade", { tradeId: trade.id, symbol: trade.symbol, reason });

  // Audit: Record close attempt
  auditLog.record(
    userId,
    "CLOSE_TRADE",
    {
      tradeId: trade.id,
      symbol: trade.symbol,
      reason,
    },
    "PENDING",
    { tradeId: trade.id, planId: trade.planId },
  );

  if (trade.status === "CLOSED") {
    auditLog.failure(userId, "CLOSE_TRADE", { tradeId: trade.id }, "Trade is already closed", {
      tradeId: trade.id,
    });
    return {
      success: false,
      error: "Trade is already closed.",
    };
  }

  try {
    const plan = getPlan(trade.planId);
    if (!plan) {
      return {
        success: false,
        error: "Cannot safely close a trade whose plan is missing; exit direction is unknown.",
      };
    }

    // First, cancel this plan's open orders to prevent double execution. Do
    // not cancel another plan's protection merely because it trades the same
    // symbol, and do not proceed when a cancellation is unconfirmed.
    const openOrders = await client.getOpenOrders(trade.symbol);
    const planOrderPrefix = `gordon_${trade.planId.slice(4, 12)}_`;
    const planOpenOrders = openOrders.filter((order) =>
      order.clientOrderId?.startsWith(planOrderPrefix),
    );
    const cancellationFailures: string[] = [];
    for (const order of planOpenOrders) {
      try {
        await client.cancelOrder(trade.symbol, order.orderId.toString());
      } catch (error) {
        cancellationFailures.push(
          `${order.orderId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (cancellationFailures.length > 0) {
      const repairFailure = await protectionRepairFailure(trade.planId, client);
      return {
        success: false,
        error: `Refused to close while ${cancellationFailures.length} plan order(s) could not be cancelled: ${cancellationFailures.join("; ")}${repairFailure}`,
      };
    }

    // Calculate remaining quantity to sell
    const totalEntryQuantity = (trade.entries ?? []).reduce((sum, e) => sum + e.quantity, 0);
    const totalExitQuantity = (trade.exits ?? []).reduce((sum, e) => sum + e.quantity, 0);
    const remainingQuantity = roundQuantity(totalEntryQuantity - totalExitQuantity);

    if (remainingQuantity <= 0) {
      updateTrade(trade.id, {
        status: "CLOSED",
        closedAt: new Date().toISOString(),
      });
      updatePlan(trade.planId, { status: "CLOSED" });

      recordConfirmedTradeClosure(
        client,
        trade,
        trade.realizedPnl,
        trade.realizedPnlPercent,
        reason,
      );

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

    const exitSide = exitSideForPlan(plan);
    const pnlMult = pnlMultiplierForPlan(plan);

    const closeOrderParams: OrderParams = {
      symbol: trade.symbol,
      side: exitSide,
      type: "MARKET",
      quantity: remainingQuantity,
      newClientOrderId: generateDeterministicClientOrderId(
        trade.planId,
        repeatableOrderType("close", trade, remainingQuantity),
      ),
    };

    let sellOrder: Order;
    try {
      sellOrder = await placeOrderIdempotent(client, closeOrderParams, {
        direction: "REDUCES_EXPOSURE",
        reduction: {
          side: closeOrderParams.side,
          quantity: remainingQuantity,
          exitSide,
          remainingQuantity,
        },
      });
      logger.info("Close order placed", {
        orderId: sellOrder.orderId,
        quantity: remainingQuantity,
      });
    } catch (error) {
      const errorMessage = isGordonError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown error";

      logger.error("Close order failed", error as Error, { params: closeOrderParams });
      logEvent({
        type: "ERROR",
        data: {
          action: "CLOSE_ORDER_FAILED",
          params: closeOrderParams,
          error: errorMessage,
        },
        tradeId: trade.id,
        planId: trade.planId,
      });

      const repairFailure = await protectionRepairFailure(trade.planId, client);
      return {
        success: false,
        error: `Failed to close position: ${errorMessage}${repairFailure}`,
      };
    }

    const confirmedFill = await confirmedExecutedFill(client, sellOrder);
    const executedQuantity = Math.min(remainingQuantity, confirmedFill.filledQuantity);
    const exitPrice = confirmedFill.averagePrice;

    // Create exit fill record
    const exitFill: ExitFill = {
      orderId: sellOrder.orderId.toString(),
      price: exitPrice,
      quantity: executedQuantity,
      filledAt: new Date().toISOString(),
      reason,
    };

    const exitValue = exitPrice * executedQuantity;
    const entryValue = trade.averageEntry * executedQuantity;
    const pnlFromThisExit = pnlMult * (exitValue - entryValue);
    const totalRealizedPnl = trade.realizedPnl + pnlFromThisExit;

    const totalInvested = trade.averageEntry * totalEntryQuantity;
    const realizedPnlPercent = totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0;

    // Update trade with exit info
    const updatedExits = [...trade.exits, exitFill];
    updateTrade(trade.id, {
      exits: updatedExits,
      realizedPnl: totalRealizedPnl,
      realizedPnlPercent,
      status: executedQuantity >= remainingQuantity - 1e-8 ? "CLOSED" : "PARTIAL",
      closedAt: executedQuantity >= remainingQuantity - 1e-8 ? new Date().toISOString() : null,
    });

    const fullyClosed = executedQuantity >= remainingQuantity - 1e-8;
    let repairFailure = "";
    if (fullyClosed) updatePlan(trade.planId, { status: "CLOSED" });
    else repairFailure = await protectionRepairFailure(trade.planId, client);

    const updatedTrade = {
      ...trade,
      exits: updatedExits,
      realizedPnl: totalRealizedPnl,
      realizedPnlPercent,
      status: fullyClosed ? ("CLOSED" as const) : ("PARTIAL" as const),
    };
    if (fullyClosed) {
      recordConfirmedTradeClosure(
        client,
        updatedTrade,
        totalRealizedPnl,
        realizedPnlPercent,
        reason,
      );
      await emitEvent("trade:closed", {
        trade: updatedTrade,
        reason,
        pnl: totalRealizedPnl,
        pnlPercent: realizedPnlPercent,
      });
    } else {
      await emitEvent("trade:partial_close", {
        tradeId: trade.id,
        trade: updatedTrade,
        symbol: trade.symbol,
        reason,
        closedQuantity: executedQuantity,
        remainingQuantity: remainingQuantity - executedQuantity,
        pnl: pnlFromThisExit,
      });
    }

    logger.info(fullyClosed ? "Trade closed" : "Trade close partially filled", {
      tradeId: trade.id,
      reason,
      pnl: totalRealizedPnl,
      pnlPercent: realizedPnlPercent,
    });

    logEvent({
      type: "ORDER_FILLED",
      data: {
        action: fullyClosed ? "TRADE_CLOSED" : "TRADE_PARTIALLY_CLOSED",
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

    const auditDetails = {
      tradeId: trade.id,
      symbol: trade.symbol,
      reason,
      pnl: totalRealizedPnl,
      pnlPercent: realizedPnlPercent,
      executedQuantity,
      requestedQuantity: remainingQuantity,
    };
    if (fullyClosed) {
      auditLog.success(userId, "CLOSE_TRADE", auditDetails, {
        tradeId: trade.id,
        planId: trade.planId,
        resultDetails: `PnL: ${totalRealizedPnl.toFixed(2)}`,
      });
    } else {
      auditLog.failure(
        userId,
        "CLOSE_TRADE",
        auditDetails,
        `Only ${executedQuantity} of ${remainingQuantity} was filled${repairFailure}`,
        { tradeId: trade.id, planId: trade.planId },
      );
    }

    return fullyClosed
      ? { success: true, pnl: totalRealizedPnl }
      : {
          success: false,
          pnl: totalRealizedPnl,
          error: `Close order only executed ${executedQuantity} of ${remainingQuantity}; the remainder stays open${repairFailure || " and protection was re-armed"}.`,
        };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

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
    auditLog.failure(userId, "CLOSE_TRADE", { tradeId: trade.id, reason }, errorMessage, {
      tradeId: trade.id,
      planId: trade.planId,
    });

    const repairFailure = await protectionRepairFailure(trade.planId, client);
    return {
      success: false,
      error: `Failed to close trade: ${errorMessage}${repairFailure}`,
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
  async getStatus(client: Exchange, symbol: string, orderId: string): Promise<FillStatus> {
    const order = await client.getOrderStatus(symbol, orderId);
    const executedQty = order.executedQty;
    const origQty = order.quantity;
    const quoteDerivedPrice =
      executedQty > 0 && order.cummulativeQuoteQty > 0
        ? order.cummulativeQuoteQty / executedQty
        : 0;
    const avgPrice =
      Number.isFinite(quoteDerivedPrice) && quoteDerivedPrice > 0 ? quoteDerivedPrice : order.price;

    return {
      orderId: order.orderId.toString(),
      status: order.status as FillStatus["status"],
      filledQuantity: executedQty,
      remainingQuantity: origQty - executedQty,
      averagePrice: avgPrice,
      isComplete:
        order.status === "FILLED" ||
        order.status === "CANCELED" ||
        order.status === "EXPIRED" ||
        order.status === "REJECTED",
    };
  },

  /**
   * Check if an order is fully filled
   */
  async isFilled(client: Exchange, symbol: string, orderId: string): Promise<boolean> {
    const status = await this.getStatus(client, symbol, orderId);
    return status.status === "FILLED";
  },

  /**
   * Check if an order is partially filled
   */
  async isPartiallyFilled(client: Exchange, symbol: string, orderId: string): Promise<boolean> {
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
  options: WaitForFillOptions = {},
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
const TERMINAL_ORDER_STATUSES = new Set(["CANCELED", "EXPIRED", "REJECTED"]);
const MAX_CLIENT_ORDER_ID_LENGTH = 36;

function retryClientOrderId(base: string, attempt: number): string {
  const suffix = `_r${attempt.toString(36)}`;
  return `${base.slice(0, MAX_CLIENT_ORDER_ID_LENGTH - suffix.length)}${suffix}`;
}

export async function getExistingOrder(
  client: Exchange,
  symbol: string,
  clientOrderId: string,
): Promise<Order | null> {
  try {
    // Get all orders for the symbol and find by clientOrderId
    const orders = await client.getOrderHistory(symbol, 100);
    const existingOrder = orders.find((order) => order.clientOrderId === clientOrderId);

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
    const existingOpenOrder = openOrders.find((order) => order.clientOrderId === clientOrderId);

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
    throw new Error(
      `Cannot verify idempotency for ${clientOrderId}: ${error instanceof Error ? error.message : String(error)}`,
    );
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
  params: OrderParams,
  effect: ExposureEffect = { direction: "INCREASES_EXPOSURE" },
): Promise<Order> {
  let dispatchParams = params;
  if (params.newClientOrderId) {
    // Reading an existing order is not a capital mutation. Check first so an
    // acknowledgement retry can recover its exchange truth even if live
    // consent expired after the original dispatch.
    const baseClientOrderId = params.newClientOrderId;
    let foundFreeGeneration = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const clientOrderId =
        attempt === 0 ? baseClientOrderId : retryClientOrderId(baseClientOrderId, attempt);
      const existingOrder = await getExistingOrder(client, params.symbol, clientOrderId);

      if (!existingOrder) {
        dispatchParams = { ...params, newClientOrderId: clientOrderId };
        foundFreeGeneration = true;
        break;
      }

      if (TERMINAL_ORDER_STATUSES.has(existingOrder.status) && existingOrder.executedQty <= 0) {
        // Most venues permanently reserve a client-order id even after a
        // zero-fill cancellation. Reusing it is not a retry; it is a request
        // the venue will reject. Advance to a deterministic generation while
        // preserving recovery for any partially/fully executed order.
        continue;
      }

      logger.info("Order already exists, returning existing order", {
        clientOrderId,
        orderId: existingOrder.orderId,
      });
      return existingOrder;
    }

    // The loop is deliberately bounded. A hundred zero-fill generations is
    // an operational fault, not a reason to keep issuing venue requests.
    if (!foundFreeGeneration) {
      throw new Error(`No free retry generation for client order ${baseClientOrderId}`);
    }
  }

  assertConsentForExposure(client, "executor.place_order_idempotent", effect);
  try {
    return await client.placeOrder(dispatchParams);
  } catch (error) {
    // A timeout or a concurrent caller can make placement succeed remotely
    // while this process sees an error. Recover the exact candidate before
    // propagating; if it is absent, the failure is real.
    if (dispatchParams.newClientOrderId) {
      const recovered = await getExistingOrder(
        client,
        dispatchParams.symbol,
        dispatchParams.newClientOrderId,
      );
      if (recovered) return recovered;
    }
    throw error;
  }
}

function repeatableOrderType(kind: string, trade: Pick<Trade, "exits">, quantity: number): string {
  // A retry before the trade record is updated gets the same key; a later,
  // legitimate partial close gets a different key. Keep the suffix compact
  // for venues with short client-order-id limits.
  const ordinal = trade.exits.length.toString(36);
  const quantityKey = Math.round(quantity * 1e8)
    .toString(36)
    .slice(-7);
  return `${kind}_${ordinal}_${quantityKey}`;
}

function validateConfirmedFill(fill: FillStatus): FillStatus {
  if (!Number.isFinite(fill.filledQuantity) || fill.filledQuantity <= 0) {
    throw new Error(`Order ${fill.orderId} has no positive confirmed execution quantity.`);
  }
  if (!Number.isFinite(fill.averagePrice) || fill.averagePrice <= 0) {
    throw new Error(`Order ${fill.orderId} has an invalid confirmed execution price.`);
  }
  return fill;
}

export async function confirmedExecutedFill(client: Exchange, order: Order): Promise<FillStatus> {
  if (order.status === "FILLED" && order.executedQty > 0) {
    return validateConfirmedFill({
      orderId: order.orderId.toString(),
      status: "FILLED",
      filledQuantity: order.executedQty,
      remainingQuantity: Math.max(0, order.quantity - order.executedQty),
      averagePrice:
        order.cummulativeQuoteQty > 0 ? order.cummulativeQuoteQty / order.executedQty : order.price,
      isComplete: true,
    });
  }

  const result = await waitForFill(client, order.symbol, order.orderId.toString(), {
    onPartialFill: "cancel",
  });
  if (result.fillStatus.filledQuantity <= 0) {
    throw new Error(
      result.error ??
        `Order ${order.orderId} was acknowledged but no execution was confirmed (status ${result.fillStatus.status}).`,
    );
  }
  return validateConfirmedFill(result.fillStatus);
}

async function protectionRepairFailure(planId: string, client: Exchange): Promise<string> {
  try {
    const repair = await repairProtectiveOrders(planId, client);
    if (repair.repaired || repair.reason === "protective_orders_intact") return "";
    return `; protection was not restored (${repair.reason})`;
  } catch (error) {
    return `; protection repair failed (${error instanceof Error ? error.message : String(error)})`;
  }
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
  reason: "TP1" | "TP2" | "TP3" | "MANUAL" = "MANUAL",
): Promise<PartialCloseResult> {
  if (activeTradeCloseClaims.has(tradeId)) {
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity: 0,
      exitPrice: 0,
      pnl: 0,
      error: `A close operation is already in progress for trade ${tradeId}.`,
    };
  }
  activeTradeCloseClaims.add(tradeId);
  try {
    return await closePartialPositionUnlocked(client, tradeId, percentage, reason);
  } finally {
    activeTradeCloseClaims.delete(tradeId);
  }
}

async function closePartialPositionUnlocked(
  client: Exchange,
  tradeId: string,
  percentage: number,
  reason: "TP1" | "TP2" | "TP3" | "MANUAL",
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

  const plan = getPlan(trade.planId);
  if (!plan) {
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity,
      exitPrice: 0,
      pnl: 0,
      error: "Cannot safely close a trade whose plan is missing; exit direction is unknown.",
    };
  }
  const exitSide = exitSideForPlan(plan);
  const pnlMult = pnlMultiplierForPlan(plan);

  const closeOrderParams: OrderParams = {
    symbol: trade.symbol,
    side: exitSide,
    type: "MARKET",
    quantity: quantityToClose,
    newClientOrderId: generateDeterministicClientOrderId(
      trade.planId,
      repeatableOrderType(`partial_${reason.toLowerCase()}`, trade, quantityToClose),
    ),
  };

  const cancelledProtection = await cancelPlanProtectiveOrders(client, trade.symbol, trade.planId);
  if (!cancelledProtection.success) {
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity,
      exitPrice: 0,
      pnl: 0,
      error: `Cannot partially close while sibling protection remains live: ${cancelledProtection.failures.join("; ")}`,
    };
  }

  let sellOrder: Order;
  try {
    sellOrder = await placeOrderIdempotent(client, closeOrderParams, {
      direction: "REDUCES_EXPOSURE",
      reduction: {
        side: closeOrderParams.side,
        quantity: quantityToClose,
        exitSide,
        remainingQuantity,
      },
    });
    logger.info("Partial close order placed", {
      orderId: sellOrder.orderId,
      quantity: quantityToClose,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Partial close order failed", error as Error, { params: closeOrderParams });

    logEvent({
      type: "ERROR",
      data: {
        action: "PARTIAL_CLOSE_FAILED",
        params: closeOrderParams,
        error: errorMessage,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });

    const repairFailure = await protectionRepairFailure(trade.planId, client);
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity,
      exitPrice: 0,
      pnl: 0,
      error: `Failed to place partial close order: ${errorMessage}${repairFailure}`,
    };
  }

  let confirmedFill: FillStatus;
  try {
    confirmedFill = await confirmedExecutedFill(client, sellOrder);
  } catch (error) {
    const repairFailure = await protectionRepairFailure(trade.planId, client);
    return {
      success: false,
      closedQuantity: 0,
      remainingQuantity,
      exitPrice: 0,
      pnl: 0,
      error: `${error instanceof Error ? error.message : String(error)}${repairFailure}`,
    };
  }

  const executedQuantity = Math.min(quantityToClose, confirmedFill.filledQuantity);
  const exitPrice = confirmedFill.averagePrice;
  const newRemainingQuantity = roundQuantity(remainingQuantity - executedQuantity);

  // Calculate PnL for this partial close
  const exitValue = exitPrice * executedQuantity;
  const entryValue = trade.averageEntry * executedQuantity;
  const pnl = pnlMult * (exitValue - entryValue);

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

  let repairFailure = "";
  if (newStatus !== "CLOSED") {
    repairFailure = await protectionRepairFailure(trade.planId, client);
  } else {
    updatePlan(trade.planId, { status: "CLOSED" });
    recordConfirmedTradeClosure(client, trade, totalRealizedPnl, realizedPnlPercent, reason);
  }

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

  const fullyFilled = executedQuantity >= quantityToClose - 1e-8;
  return {
    // A confirmed fill is a successful capital mutation even when it is
    // partial or protection repair subsequently fails. Returning false here
    // invited generic callers to repeat the requested percentage and account
    // a second, larger close against the now-smaller position.
    success: true,
    closedQuantity: executedQuantity,
    remainingQuantity: newRemainingQuantity,
    exitPrice,
    pnl,
    fullyFilled,
    protectionRestored: newStatus === "CLOSED" || repairFailure.length === 0,
    error:
      repairFailure.length > 0
        ? `The close filled${repairFailure}`
        : fullyFilled
          ? undefined
          : `The venue filled ${executedQuantity} of ${quantityToClose}; the remainder was cancelled and protection was re-armed.`,
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
  tier: 1 | 2 | 3,
): Promise<PartialCloseResult> {
  // Standard tier percentages (of remaining position)
  const tierPercentages: Record<1 | 2 | 3, number> = {
    1: 0.5, // TP1: 50% of position
    2: 0.6, // TP2: 60% of remaining (30% of original)
    3: 1.0, // TP3: 100% of remaining (20% of original)
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
 * Place an OCO (One-Cancels-Other) order combining stop-loss and take-profit.
 *
 * For Binance-family exchanges that support native OCO, this uses the atomic
 * /api/v3/orderList/oco endpoint so both legs are guaranteed to be coordinated.
 *
 * Exchanges without native OCO are refused without placing either leg. Two
 * independent orders do not provide OCO atomicity, so process-managed exits use
 * the protected-stop path after the operator acknowledges that dependency.
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
  userId: string = "system",
): Promise<OCOResult> {
  const logPrefix = planId ? `[${planId}] ` : "";
  logger.info(`${logPrefix}Placing OCO order`, {
    symbol,
    side,
    quantity,
    stopPrice,
    takeProfitPrice,
  });

  // The native-OCO path dispatches to the venue. Gated: `side` and `quantity`
  // are caller-supplied and unrelated to any open position, so a BUY OCO opens
  // or grows one. Not verifiably reducing.
  try {
    assertLiveConsent(client, "executor.place_oco_orders");
  } catch (error) {
    return {
      success: false,
      orderIds: [],
      native: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Audit: Record OCO attempt
  auditLog.record(
    userId,
    "PLACE_OCO_ORDER",
    {
      symbol,
      side,
      quantity,
      stopPrice,
      stopLimitPrice,
      takeProfitPrice,
      planId,
    },
    "PENDING",
    planId ? { planId } : undefined,
  );

  // -----------------------------------------------------------------------
  // Path A: Native OCO (Binance-family)
  // -----------------------------------------------------------------------
  const ocoExchange = getNativeOcoExchangeForTakeProfits(client, 1);
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
        ...(planId
          ? {
              listClientOrderId: generateDeterministicClientOrderId(planId, "oco"),
              stopClientOrderId: generateDeterministicClientOrderId(planId, "oco_stop"),
              limitClientOrderId: generateDeterministicClientOrderId(planId, "oco_tp"),
            }
          : {}),
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

      auditLog.success(
        userId,
        "PLACE_OCO_ORDER",
        {
          symbol,
          orderListId: result.orderListId,
          orderIds,
          native: true,
        },
        planId ? { planId } : undefined,
      );

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

      auditLog.failure(
        userId,
        "PLACE_OCO_ORDER",
        { symbol, native: true },
        errorMessage,
        planId ? { planId } : undefined,
      );

      return {
        success: false,
        orderIds: [],
        native: true,
        error: `Native OCO failed: ${errorMessage}`,
      };
    }
  }

  // Two independent orders are not OCO: after either fills, the sibling can
  // remain live and trade through flat before a polling monitor cancels it.
  // Refuse the atomicity claim on venues that cannot provide it.
  const error = "Native OCO is not supported by this exchange; no orders were placed.";
  auditLog.failure(
    userId,
    "PLACE_OCO_ORDER",
    { symbol, native: false },
    error,
    planId ? { planId } : undefined,
  );
  return { success: false, orderIds: [], native: false, error };
}

// ============================================================================
// Protective Order Repair (daemon startup)
// ============================================================================

export interface ProtectiveOrderRepairResult {
  repaired: boolean;
  placed: string[];
  reason: string;
}

const ACTIVE_ORDER_STATUSES = new Set(["NEW", "PARTIALLY_FILLED"]);

function isActiveProtectiveOrder(order: Order): boolean {
  return ACTIVE_ORDER_STATUSES.has(order.status);
}

async function findPlanScopedOrders(
  client: Exchange,
  symbol: string,
  planId: string,
): Promise<Order[]> {
  const prefix = `gordon_${planId.slice(4, 12)}_`;
  const [history, openOrders] = await Promise.all([
    client.getOrderHistory(symbol, 200),
    client.getOpenOrders(symbol),
  ]);
  const byOrderId = new Map<string, Order>();
  for (const order of [...history, ...openOrders]) {
    if (order.clientOrderId?.startsWith(prefix)) {
      byOrderId.set(order.orderId.toString(), order);
    }
  }
  return [...byOrderId.values()];
}

function isProtectivePlanOrder(order: Order): boolean {
  const id = order.clientOrderId ?? "";
  return (
    id.includes("_stop") ||
    id.includes("_oco_stop") ||
    id.includes("_oco_tp") ||
    /_(?:grid_)?tp\d/.test(id)
  );
}

export async function cancelPlanProtectiveOrders(
  client: Exchange,
  symbol: string,
  planId: string,
): Promise<{ success: boolean; cancelled: string[]; failures: string[] }> {
  let planOrders: Order[];
  try {
    planOrders = await findPlanScopedOrders(client, symbol, planId);
  } catch (error) {
    return {
      success: false,
      cancelled: [],
      failures: [
        `Could not enumerate plan orders: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const activeProtective = planOrders.filter(
    (order) => isActiveProtectiveOrder(order) && isProtectivePlanOrder(order),
  );
  const cancelled: string[] = [];
  const failures: string[] = [];

  for (const order of activeProtective) {
    const orderId = order.orderId.toString();
    try {
      const didCancel = await safelyCancelOrder(client, symbol, orderId, planId);
      if (didCancel) {
        cancelled.push(orderId);
      } else {
        failures.push(`${orderId}: venue cancellation failed`);
      }
    } catch (error) {
      failures.push(`${orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { success: failures.length === 0, cancelled, failures };
}

function resolvePositionQuantity(plan: Plan, planOrders: Order[], trades: Trade[]): number {
  const activeTrade = trades.find(
    (t) => t.planId === plan.id && (t.status === "OPEN" || t.status === "PARTIAL"),
  );

  if (activeTrade && activeTrade.entries.length > 0) {
    const fromEntries = activeTrade.entries.reduce((sum, e) => sum + e.quantity, 0);
    const fromExits = activeTrade.exits.reduce((sum, e) => sum + e.quantity, 0);
    const remaining = Math.max(0, fromEntries - fromExits);
    if (remaining > 0) {
      return roundQuantity(remaining);
    }
  }

  if (plan.strategy === "grid_entry") {
    const filledGridQty = planOrders
      .filter(
        (o) =>
          o.clientOrderId?.includes("grid") &&
          (o.status === "FILLED" || o.status === "PARTIALLY_FILLED"),
      )
      .reduce((sum, o) => sum + o.executedQty, 0);
    if (filledGridQty > 0) {
      return roundQuantity(filledGridQty);
    }
  }

  const entryOrder =
    planOrders.find((o) => o.clientOrderId?.endsWith("_entry")) ??
    planOrders.find((o) => o.clientOrderId?.includes("entry"));

  if (
    entryOrder &&
    (entryOrder.status === "FILLED" || entryOrder.status === "PARTIALLY_FILLED") &&
    entryOrder.executedQty > 0
  ) {
    return roundQuantity(entryOrder.executedQty);
  }

  return 0;
}

function findActiveStopLeg(planOrders: Order[]): Order | undefined {
  return planOrders.find(
    (o) =>
      isActiveProtectiveOrder(o) &&
      (o.clientOrderId?.includes("stop") ?? false) &&
      !(o.clientOrderId?.includes("tp") ?? false) &&
      !(o.clientOrderId?.includes("oco") ?? false),
  );
}

function hasActiveStopLeg(planOrders: Order[]): boolean {
  return findActiveStopLeg(planOrders) !== undefined;
}

const QTY_MISMATCH_EPSILON = 1e-8;

function stopQuantityMismatch(orderQty: number, positionQty: number): boolean {
  return Math.abs(roundQuantity(orderQty) - roundQuantity(positionQty)) > QTY_MISMATCH_EPSILON;
}

function nextProtectiveClientOrderId(planId: string, kind: string, planOrders: Order[]): string {
  const priorGenerations = planOrders.filter((order) =>
    order.clientOrderId?.includes(`_${kind}`),
  ).length;
  return generateDeterministicClientOrderId(planId, `${kind}_r${priorGenerations.toString(36)}`);
}

function protectiveReduction(
  exitSide: "BUY" | "SELL",
  quantity: number,
  remainingQuantity: number,
): ExposureEffect {
  return {
    direction: "REDUCES_EXPOSURE",
    reduction: {
      side: exitSide,
      quantity,
      exitSide,
      remainingQuantity,
    },
  };
}

/**
 * After a daemon crash mid-execution, re-place any missing stop/TP orders for
 * EXECUTING plans that still have open exposure. Idempotent via deterministic
 * client order IDs + placeOrderIdempotent.
 */
export async function repairProtectiveOrders(
  planId: string,
  client: Exchange,
): Promise<ProtectiveOrderRepairResult> {
  const plan = getPlan(planId);
  if (!plan) {
    return { repaired: false, placed: [], reason: "plan_not_found" };
  }
  if (plan.status !== "EXECUTING") {
    return { repaired: false, placed: [], reason: "plan_not_executing" };
  }

  const planOrders = await findPlanScopedOrders(client, plan.symbol, planId);
  const activeTrades = listTrades().filter(
    (t) => t.planId === planId && (t.status === "OPEN" || t.status === "PARTIAL"),
  );

  const positionQty = resolvePositionQuantity(plan, planOrders, activeTrades);
  if (positionQty <= 0) {
    return { repaired: false, placed: [], reason: "no_open_position" };
  }

  const exitSide = exitSideForPlan(plan);
  const stopLimitPrice = stopLimitPriceForExit(plan.stopLoss.price, exitSide);
  const placed: string[] = [];

  const activeStop = findActiveStopLeg(planOrders);
  let stopNeedsPlacement = !hasActiveStopLeg(planOrders);
  if (activeStop && stopQuantityMismatch(activeStop.quantity, positionQty)) {
    try {
      const didCancel = await safelyCancelOrder(
        client,
        plan.symbol,
        activeStop.orderId.toString(),
        planId,
      );
      if (!didCancel) {
        return {
          repaired: false,
          placed,
          reason: "stop_resize_cancel_failed: venue cancellation failed",
        };
      }
      stopNeedsPlacement = true;
      logger.info("Cancelled undersized/oversized stop for protective resize", {
        planId,
        orderId: activeStop.orderId,
        orderQty: activeStop.quantity,
        positionQty,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to cancel stop for protective resize", error as Error, { planId });
      return {
        repaired: false,
        placed,
        reason: `stop_resize_cancel_failed: ${errorMessage}`,
      };
    }
  }

  if (stopNeedsPlacement) {
    const stopParams: OrderParams = {
      symbol: plan.symbol,
      side: exitSide,
      type: "STOP_LOSS_LIMIT",
      quantity: positionQty,
      price: stopLimitPrice,
      stopPrice: roundPrice(plan.stopLoss.price),
      timeInForce: "GTC",
      newClientOrderId: nextProtectiveClientOrderId(planId, "stop", planOrders),
    };

    try {
      const stopOrder = await placeOrderIdempotent(
        client,
        stopParams,
        protectiveReduction(exitSide, positionQty, positionQty),
      );
      placed.push("stop");
      logger.info("Repaired missing stop-loss", {
        planId,
        orderId: stopOrder.orderId,
        quantity: positionQty,
      });
      logEvent({
        type: "ORDER_PLACED",
        data: {
          action: "PROTECTIVE_REPAIR_STOP",
          orderId: stopOrder.orderId.toString(),
          quantity: positionQty,
        },
        planId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to repair stop-loss", error as Error, { planId });
      return {
        repaired: placed.length > 0,
        placed,
        reason: `stop_repair_failed: ${errorMessage}`,
      };
    }
  }

  // Take profits are managed exits unless the original placement used a
  // native atomic OCO. Recovery therefore restores the protective stop only;
  // recreating independent TP limits would reintroduce the sibling-order race.

  if (placed.length === 0) {
    return { repaired: false, placed: [], reason: "protective_orders_intact" };
  }

  return { repaired: true, placed, reason: "protective_orders_repaired" };
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
export function checkConcurrentTradeLimit(config: GordonConfig): ConcurrentTradeLimitResult {
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

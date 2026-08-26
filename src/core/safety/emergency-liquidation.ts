/**
 * Emergency Liquidation
 *
 * When circuit breakers trip, this module stops strategy creation, cancels
 * exposure-increasing Gordon orders, closes open positions via market orders,
 * then removes protective exits only after their position is confirmed closed.
 * This is the nuclear option — only triggered by critical circuit breaker trips.
 */

import type { Exchange } from "../../infra/exchange/types.ts";
import { listTrades, updateTrade } from "../../infra/storage/entities/trades.ts";
import { getPlan } from "../../infra/storage/entities/plans.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { StrategyRuntime } from "../runtime/engine.ts";
import type { CircuitBreakerTrigger } from "../../gateway/circuit-breakers/baseline.ts";
import { assertConsentForExposure } from "../../infra/trading/execution/preflight.ts";

const logger = createModuleLogger("emergency-liquidation");

export interface EmergencyLiquidationResult {
  ordersCancelled: number;
  positionsClosed: number;
  slotsPaused: number;
  errors: string[];
  triggeredBy: string[];
  timestamp: string;
}

/**
 * Execute emergency liquidation without creating an unprotected interval when
 * a close fails.
 */
export async function executeEmergencyLiquidation(
  exchange: Exchange,
  triggers: CircuitBreakerTrigger[],
): Promise<EmergencyLiquidationResult> {
  const result: EmergencyLiquidationResult = {
    ordersCancelled: 0,
    positionsClosed: 0,
    slotsPaused: 0,
    errors: [],
    triggeredBy: triggers.map((t) => t.name),
    timestamp: new Date().toISOString(),
  };

  logger.warn("EMERGENCY LIQUIDATION INITIATED", {
    triggers: triggers.map((t) => `${t.name}: ${t.current} >= ${t.threshold}`),
  });

  // Phase 1: stop strategies before touching their resting orders, otherwise a
  // live slot can recreate an order while liquidation is in progress.
  pauseAllSlots(result);

  // Phase 2: cancel only orders whose fill could open or increase exposure.
  // Protective exits remain live until the replacement market close succeeds.
  await cancelExposureIncreasingOrders(exchange, result);

  // Phase 3: close positions. A failed close deliberately leaves its protective
  // exits resting rather than turning a liquidation failure into naked risk.
  const closedSymbols = await closeAllOpenPositions(exchange, result);

  // Phase 4: after every active trade for a symbol closed successfully, remove
  // the now-stale exits before they can reverse the flat position.
  await cancelOrdersForSymbols(exchange, result, closedSymbols);

  logEvent({
    type: "SYSTEM",
    data: {
      action: "EMERGENCY_LIQUIDATION_COMPLETE",
      ...result,
    },
  });

  logger.warn("EMERGENCY LIQUIDATION COMPLETE", {
    ordersCancelled: result.ordersCancelled,
    positionsClosed: result.positionsClosed,
    slotsPaused: result.slotsPaused,
    errors: result.errors.length,
  });

  return result;
}

type ActiveTrade = ReturnType<typeof listTrades>[number];

function isGordonOrder(clientOrderId: string | undefined): boolean {
  // Explicit call sites use the underscore form; the CCXT adapter's automatic
  // idempotency key uses the hyphen form. Both are Gordon-owned orders and must
  // participate in emergency cleanup.
  return (
    clientOrderId?.startsWith("gordon_") === true || clientOrderId?.startsWith("gordon-") === true
  );
}

function protectiveOrderPriority(type: string): number {
  // If mutually exclusive exits collectively exceed the remaining position,
  // preserve downside protection first. The later cleanup removes whichever
  // protective order remains after the market close succeeds.
  if (type === "STOP_LOSS" || type === "STOP_LOSS_LIMIT") return 0;
  if (type === "TAKE_PROFIT" || type === "TAKE_PROFIT_LIMIT") return 1;
  return 2;
}

function remainingQuantity(trade: ActiveTrade): number {
  const entered = trade.entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const exited = trade.exits.reduce((sum, exit) => sum + exit.quantity, 0);
  return Math.max(0, entered - exited);
}

function protectiveCapacityBySide(trades: ActiveTrade[]): Map<"BUY" | "SELL", number> {
  const capacity = new Map<"BUY" | "SELL", number>([
    ["BUY", 0],
    ["SELL", 0],
  ]);
  for (const trade of trades) {
    const plan = getPlan(trade.planId);
    const side: "BUY" | "SELL" = plan?.direction === "short" ? "BUY" : "SELL";
    capacity.set(side, (capacity.get(side) ?? 0) + remainingQuantity(trade));
  }
  return capacity;
}

async function cancelExposureIncreasingOrders(
  exchange: Exchange,
  result: EmergencyLiquidationResult,
): Promise<void> {
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const tradesBySymbol = new Map<string, ActiveTrade[]>();
  for (const trade of [...openTrades, ...partialTrades]) {
    const trades = tradesBySymbol.get(trade.symbol) ?? [];
    trades.push(trade);
    tradesBySymbol.set(trade.symbol, trades);
  }

  for (const [symbol, trades] of tradesBySymbol) {
    try {
      const openOrders = await exchange.getOpenOrders(symbol);
      const capacity = protectiveCapacityBySide(trades);
      const protectedSoFar = new Map<"BUY" | "SELL", number>([
        ["BUY", 0],
        ["SELL", 0],
      ]);

      const gordonOrders = openOrders
        .filter((order) => isGordonOrder(order.clientOrderId))
        .sort(
          (left, right) => protectiveOrderPriority(left.type) - protectiveOrderPriority(right.type),
        );

      for (const order of gordonOrders) {
        const side = order.side;
        const quantity = Number(order.quantity);
        const nextProtected = (protectedSoFar.get(side) ?? 0) + quantity;
        const isProtective =
          Number.isFinite(quantity) && quantity > 0 && nextProtected <= (capacity.get(side) ?? 0);
        if (isProtective) {
          protectedSoFar.set(side, nextProtected);
          logger.info("Preserved protective exit until emergency close confirms", {
            symbol,
            orderId: order.orderId,
            side,
            quantity,
          });
          continue;
        }
        try {
          await exchange.cancelOrder(symbol, order.orderId.toString());
          result.ordersCancelled++;
          logger.info("Cancelled exposure-increasing order", {
            symbol,
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Cancel order ${order.orderId} failed: ${msg}`);
          logger.warn("Failed to cancel order during emergency", {
            orderId: order.orderId,
            error: msg,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Cancel orders for ${symbol} failed: ${msg}`);
    }
  }
}

async function cancelOrdersForSymbols(
  exchange: Exchange,
  result: EmergencyLiquidationResult,
  symbols: ReadonlySet<string>,
): Promise<void> {
  for (const symbol of symbols) {
    try {
      const openOrders = await exchange.getOpenOrders(symbol);
      for (const order of openOrders) {
        if (!isGordonOrder(order.clientOrderId)) continue;
        try {
          await exchange.cancelOrder(symbol, order.orderId.toString());
          result.ordersCancelled++;
          logger.info("Cancelled stale exit after emergency close", {
            symbol,
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Cancel order ${order.orderId} failed: ${msg}`);
          logger.warn("Failed to cancel stale order after emergency close", {
            orderId: order.orderId,
            error: msg,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Cancel orders for ${symbol} failed: ${msg}`);
    }
  }
}

async function closeAllOpenPositions(
  exchange: Exchange,
  result: EmergencyLiquidationResult,
): Promise<Set<string>> {
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const activeTrades = [...openTrades, ...partialTrades];
  const attemptedBySymbol = new Map<string, number>();
  const closedBySymbol = new Map<string, number>();

  for (const trade of activeTrades) {
    attemptedBySymbol.set(trade.symbol, (attemptedBySymbol.get(trade.symbol) ?? 0) + 1);
    try {
      const remainingQty = remainingQuantity(trade);

      if (remainingQty <= 0) {
        closedBySymbol.set(trade.symbol, (closedBySymbol.get(trade.symbol) ?? 0) + 1);
        continue;
      }

      // Determine exit side from the plan's direction
      const plan = getPlan(trade.planId);
      const exitSide: "BUY" | "SELL" = plan?.direction === "short" ? "BUY" : "SELL";

      const closeOrder = {
        symbol: trade.symbol,
        side: exitSide,
        type: "MARKET" as const,
        quantity: remainingQty,
        newClientOrderId: `gordon_emergency_${trade.id.slice(0, 8)}_${Date.now()}`,
      };

      // Exposure-reducing: not gated on live consent, but the reduction is
      // verified against what the order actually carries, so a close that
      // could open or grow a position falls back to the gate.
      assertConsentForExposure(exchange, "emergency_liquidation.close_position", {
        direction: "REDUCES_EXPOSURE",
        reduction: {
          side: closeOrder.side,
          quantity: closeOrder.quantity,
          exitSide,
          remainingQuantity: remainingQty,
        },
      });

      const orderResult = await exchange.placeOrder(closeOrder);

      // Update trade record
      const exitPrice =
        orderResult.executedQty > 0
          ? orderResult.cummulativeQuoteQty / orderResult.executedQty
          : orderResult.price;

      const updatedTrade = { ...trade };
      updatedTrade.exits = [
        ...updatedTrade.exits,
        {
          orderId: orderResult.orderId.toString(),
          price: exitPrice,
          quantity: orderResult.executedQty ?? remainingQty,
          filledAt: new Date().toISOString(),
          reason: "STOP" as const,
        },
      ];
      updatedTrade.status = "CLOSED";
      updatedTrade.closedAt = new Date().toISOString();

      // Recalculate PnL (invert for shorts: short profits when price drops)
      const avgEntry = trade.averageEntry || 0;
      const pnlMultiplier = plan?.direction === "short" ? -1 : 1;
      updatedTrade.realizedPnl =
        (trade.realizedPnl ?? 0) +
        pnlMultiplier * (exitPrice - avgEntry) * (orderResult.executedQty ?? remainingQty);

      updateTrade(trade.id, updatedTrade);
      result.positionsClosed++;
      closedBySymbol.set(trade.symbol, (closedBySymbol.get(trade.symbol) ?? 0) + 1);

      logger.info("Emergency closed position", {
        tradeId: trade.id,
        symbol: trade.symbol,
        exitPrice,
        quantity: remainingQty,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Close position ${trade.id} (${trade.symbol}) failed: ${msg}`);
      logger.error("Failed to close position during emergency", {
        tradeId: trade.id,
        error: msg,
      });
    }
  }

  return new Set(
    [...attemptedBySymbol]
      .filter(([symbol, count]) => (closedBySymbol.get(symbol) ?? 0) === count)
      .map(([symbol]) => symbol),
  );
}

function pauseAllSlots(result: EmergencyLiquidationResult): void {
  try {
    const runtime = StrategyRuntime.getInstance();
    const activeSlots = runtime.getActiveSlots().filter((s) => s.status === "active");

    for (const slot of activeSlots) {
      try {
        runtime.pauseStrategy(slot.slot_id, "circuit_breaker");
        result.slotsPaused++;
      } catch {
        // Slot may already be paused
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Pause slots failed: ${msg}`);
  }
}

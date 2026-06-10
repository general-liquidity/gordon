/**
 * Emergency Liquidation
 *
 * When circuit breakers trip, this module cancels all open Gordon orders
 * and closes all open positions via market orders. This is the nuclear
 * option — only triggered by critical circuit breaker trips.
 */

import type { Exchange } from "../../infra/exchange/types.ts";
import { listTrades, updateTrade } from "../../infra/storage/entities/trades.ts";
import { getPlan } from "../../infra/storage/entities/plans.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { StrategyRuntime } from "../runtime/engine.ts";
import type { CircuitBreakerTrigger } from "../../gateway/circuit-breakers/baseline.ts";

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
 * Execute emergency liquidation: cancel all orders, close all positions,
 * pause all strategy slots.
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

  // Phase 1: Cancel all open Gordon orders
  await cancelAllGordonOrders(exchange, result);

  // Phase 2: Close all open positions via market orders
  await closeAllOpenPositions(exchange, result);

  // Phase 3: Pause all active strategy slots
  pauseAllSlots(result);

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

async function cancelAllGordonOrders(
  exchange: Exchange,
  result: EmergencyLiquidationResult,
): Promise<void> {
  // Get all symbols with active trades
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const symbols = new Set([
    ...openTrades.map((t) => t.symbol),
    ...partialTrades.map((t) => t.symbol),
  ]);

  for (const symbol of symbols) {
    try {
      const openOrders = await exchange.getOpenOrders(symbol);
      const gordonOrders = openOrders.filter(
        (o) => o.clientOrderId?.startsWith("gordon_"),
      );

      for (const order of gordonOrders) {
        try {
          await exchange.cancelOrder(symbol, order.orderId.toString());
          result.ordersCancelled++;
          logger.info("Cancelled order", {
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

async function closeAllOpenPositions(
  exchange: Exchange,
  result: EmergencyLiquidationResult,
): Promise<void> {
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const activeTrades = [...openTrades, ...partialTrades];

  for (const trade of activeTrades) {
    try {
      // Calculate remaining quantity to close
      const totalEntryQty = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
      const totalExitQty = trade.exits.reduce((sum, e) => sum + e.quantity, 0);
      const remainingQty = totalEntryQty - totalExitQty;

      if (remainingQty <= 0) continue;

      // Determine exit side from the plan's direction
      const plan = getPlan(trade.planId);
      const exitSide = plan?.direction === "short" ? "BUY" : "SELL";

      const orderResult = await exchange.placeOrder({
        symbol: trade.symbol,
        side: exitSide,
        type: "MARKET",
        quantity: remainingQty,
        newClientOrderId: `gordon_emergency_${trade.id.slice(0, 8)}_${Date.now()}`,
      });

      // Update trade record
      const exitPrice = orderResult.executedQty > 0
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
        (trade.realizedPnl ?? 0) + pnlMultiplier * (exitPrice - avgEntry) * (orderResult.executedQty ?? remainingQty);

      updateTrade(trade.id, updatedTrade);
      result.positionsClosed++;

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
}

function pauseAllSlots(result: EmergencyLiquidationResult): void {
  try {
    const runtime = StrategyRuntime.getInstance();
    const activeSlots = runtime.getActiveSlots().filter(
      (s) => s.status === "active",
    );

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

/**
 * Reconciliation Service
 *
 * Reconciles local trade state with Binance exchange state on startup.
 * This ensures that any orders that filled while the app was offline
 * are properly recorded in the local database.
 */

import { BinanceClient } from "../infra/venues/exchange/clients/binance/index.ts";
import { listTrades, updateTrade } from "../infra/storage/trades.ts";
import { getPlan } from "../infra/storage/plans.ts";
import { logEvent } from "../infra/storage/events.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import type { Trade, EntryFill, ExitFill } from "../types/index.ts";
import { extractOrderOwnerKey } from "../core/order-recovery.ts";

const logger = createModuleLogger("reconciliation");

function getIdSuffix(id: string): string {
  const separatorIndex = id.indexOf("_");
  return separatorIndex >= 0 ? id.slice(separatorIndex + 1) : id;
}

function buildKnownOrderOwnerKeys(activeTrades: Trade[]): Set<string> {
  const keys = new Set<string>();

  for (const trade of activeTrades) {
    const tradeSuffix = getIdSuffix(trade.id);
    const planSuffix = getIdSuffix(trade.planId);

    keys.add(trade.id);
    keys.add(tradeSuffix);
    keys.add(trade.planId);
    keys.add(planSuffix);

    if (planSuffix.length >= 8) {
      keys.add(planSuffix.slice(0, 8));
    }
  }

  return keys;
}

export interface ReconciliationResult {
  success: boolean;
  tradesReconciled: number;
  ordersUpdated: number;
  errors: string[];
  warnings: string[];
}

/**
 * Reconcile local trade state with Binance on startup
 *
 * This function:
 * 1. Gets all open/partial trades from the database
 * 2. For each trade, queries Binance for order status
 * 3. Updates local state to match Binance reality
 * 4. Detects orphaned orders (orders on Binance not in our DB)
 */
export async function reconcileWithBinance(
  client: BinanceClient
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    success: true,
    tradesReconciled: 0,
    ordersUpdated: 0,
    errors: [],
    warnings: [],
  };

  logger.info("Starting reconciliation with Binance");

  try {
    // Get all active trades
    const openTrades = listTrades({ status: "OPEN" });
    const partialTrades = listTrades({ status: "PARTIAL" });
    const activeTrades = [...openTrades, ...partialTrades];

    logger.debug("Active trades found", { count: activeTrades.length });

    if (activeTrades.length === 0) {
      logger.info("No active trades to reconcile");
      return result;
    }

    // Process each trade
    for (const trade of activeTrades) {
      try {
        const tradeResult = await reconcileTrade(client, trade);
        result.tradesReconciled++;
        result.ordersUpdated += tradeResult.ordersUpdated;

        if (tradeResult.warnings.length > 0) {
          result.warnings.push(...tradeResult.warnings);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Trade ${trade.id}: ${errorMessage}`);
        logger.error("Failed to reconcile trade", error as Error, { tradeId: trade.id });
      }
    }

    // Check for orphaned orders (orders on Binance that we don't have records for)
    await checkOrphanedOrders(client, activeTrades, result);

    logger.info("Reconciliation complete", {
      tradesReconciled: result.tradesReconciled,
      ordersUpdated: result.ordersUpdated,
      errors: result.errors.length,
      warnings: result.warnings.length,
    });

    logEvent({
      type: "SYSTEM",
      data: {
        action: "RECONCILIATION_COMPLETE",
        tradesReconciled: result.tradesReconciled,
        ordersUpdated: result.ordersUpdated,
        errors: result.errors,
        warnings: result.warnings,
      },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    result.success = false;
    result.errors.push(`Reconciliation failed: ${errorMessage}`);
    logger.error("Reconciliation failed", error as Error);
  }

  return result;
}

interface TradeReconciliationResult {
  ordersUpdated: number;
  warnings: string[];
}

/**
 * Reconcile a single trade with Binance
 */
async function reconcileTrade(
  client: BinanceClient,
  trade: Trade
): Promise<TradeReconciliationResult> {
  const result: TradeReconciliationResult = {
    ordersUpdated: 0,
    warnings: [],
  };

  const plan = getPlan(trade.planId);
  if (!plan) {
    result.warnings.push(`Plan not found for trade ${trade.id}`);
    return result;
  }

  // Get all orders for this symbol from Binance (last 500 orders)
  const allOrders = await client.getOrderHistory(trade.symbol, 500);

  // Filter orders that belong to this trade (by clientOrderId pattern)
  const tradeOrderPattern = `gordon_${trade.planId.slice(4, 12)}`;
  const tradeOrders = allOrders.filter(order =>
    order.clientOrderId?.startsWith(tradeOrderPattern)
  );

  logger.debug("Trade orders found on Binance", {
    tradeId: trade.id,
    orderCount: tradeOrders.length,
  });

  let needsUpdate = false;
  const updatedTrade = { ...trade };

  // Check each order for fills
  for (const order of tradeOrders) {
    const orderStatus = order.status;
    const orderId = order.orderId.toString();
    const clientOrderId = order.clientOrderId || "";

    // Check if this is an entry order that filled
    if (clientOrderId.includes("entry") || clientOrderId.includes("grid")) {
      if (orderStatus === "FILLED") {
        // Check if we already have this fill recorded
        const existingFill = trade.entries.find(e => e.orderId === orderId);

        if (!existingFill) {
          // Record the fill
          const fillPrice = parseFloat(order.cummulativeQuoteQty) / parseFloat(order.executedQty);
          const fillQuantity = parseFloat(order.executedQty);

          const newFill: EntryFill = {
            orderId,
            price: fillPrice,
            quantity: fillQuantity,
            filledAt: order.updateTime ? new Date(order.updateTime).toISOString() : new Date().toISOString(),
          };

          updatedTrade.entries = [...updatedTrade.entries, newFill];
          needsUpdate = true;
          result.ordersUpdated++;

          logger.info("Reconciled entry fill", {
            tradeId: trade.id,
            orderId,
            price: fillPrice,
            quantity: fillQuantity,
          });
        }
      }
    }

    // Check if this is an exit order (stop or TP) that filled
    if (clientOrderId.includes("stop") || clientOrderId.includes("tp")) {
      if (orderStatus === "FILLED") {
        // Check if we already have this exit recorded
        const existingExit = trade.exits.find(e => e.orderId === orderId);

        if (!existingExit) {
          // Determine the reason based on clientOrderId
          let reason: "STOP" | "TP1" | "TP2" | "TP3" | "MANUAL" = "MANUAL";
          if (clientOrderId.includes("stop")) {
            reason = "STOP";
          } else if (clientOrderId.includes("tp1")) {
            reason = "TP1";
          } else if (clientOrderId.includes("tp2")) {
            reason = "TP2";
          } else if (clientOrderId.includes("tp3")) {
            reason = "TP3";
          }

          const exitPrice = parseFloat(order.cummulativeQuoteQty) / parseFloat(order.executedQty);
          const exitQuantity = parseFloat(order.executedQty);

          const newExit: ExitFill = {
            orderId,
            price: exitPrice,
            quantity: exitQuantity,
            filledAt: order.updateTime ? new Date(order.updateTime).toISOString() : new Date().toISOString(),
            reason,
          };

          updatedTrade.exits = [...updatedTrade.exits, newExit];
          needsUpdate = true;
          result.ordersUpdated++;

          logger.info("Reconciled exit fill", {
            tradeId: trade.id,
            orderId,
            reason,
            price: exitPrice,
            quantity: exitQuantity,
          });
        }
      }
    }
  }

  // Recalculate trade metrics if updated
  if (needsUpdate) {
    // Recalculate average entry
    if (updatedTrade.entries.length > 0) {
      let totalValue = 0;
      let totalQty = 0;
      for (const entry of updatedTrade.entries) {
        totalValue += entry.price * entry.quantity;
        totalQty += entry.quantity;
      }
      updatedTrade.averageEntry = totalQty > 0 ? totalValue / totalQty : 0;
    }

    // Recalculate realized PnL
    if (updatedTrade.exits.length > 0 && updatedTrade.averageEntry > 0) {
      let totalPnl = 0;
      let totalExitQty = 0;
      for (const exit of updatedTrade.exits) {
        totalPnl += (exit.price - updatedTrade.averageEntry) * exit.quantity;
        totalExitQty += exit.quantity;
      }
      updatedTrade.realizedPnl = totalPnl;

      const totalEntryQty = updatedTrade.entries.reduce((sum, e) => sum + e.quantity, 0);
      const entryValue = updatedTrade.averageEntry * Math.min(totalExitQty, totalEntryQty);
      updatedTrade.realizedPnlPercent = entryValue > 0 ? (totalPnl / entryValue) * 100 : 0;
    }

    // Check if trade should be closed
    const totalEntryQty = updatedTrade.entries.reduce((sum, e) => sum + e.quantity, 0);
    const totalExitQty = updatedTrade.exits.reduce((sum, e) => sum + e.quantity, 0);

    if (totalExitQty >= totalEntryQty * 0.99) {
      updatedTrade.status = "CLOSED";
      updatedTrade.closedAt = new Date().toISOString();
    } else if (updatedTrade.entries.length > 0 && totalExitQty > 0) {
      updatedTrade.status = "PARTIAL";
    } else if (updatedTrade.entries.length > 0) {
      updatedTrade.status = "OPEN";
    }

    // Save the updated trade
    updateTrade(trade.id, updatedTrade);

    logEvent({
      type: "SYSTEM",
      data: {
        action: "TRADE_RECONCILED",
        tradeId: trade.id,
        entriesAdded: updatedTrade.entries.length - trade.entries.length,
        exitsAdded: updatedTrade.exits.length - trade.exits.length,
        newStatus: updatedTrade.status,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });
  }

  return result;
}

/**
 * Check for orders on Binance that we don't have records for
 * (orphaned orders from crashed sessions)
 */
async function checkOrphanedOrders(
  client: BinanceClient,
  activeTrades: Trade[],
  result: ReconciliationResult
): Promise<void> {
  // Get unique symbols from active trades
  const symbols = new Set(activeTrades.map(t => t.symbol));
  const knownOrderOwnerKeys = buildKnownOrderOwnerKeys(activeTrades);

  for (const symbol of symbols) {
    try {
      const openOrders = await client.getOpenOrders(symbol);

      // Check each open order
      for (const order of openOrders) {
        const clientOrderId = order.clientOrderId || "";

        // Check if this is a Gordon order
        if (clientOrderId.startsWith("gordon_")) {
          const ownerKey = extractOrderOwnerKey(clientOrderId);
          const matchingTrade = ownerKey ? knownOrderOwnerKeys.has(ownerKey) : false;

          if (!matchingTrade) {
            result.warnings.push(
              `Orphaned order found: ${order.orderId} for ${symbol} (clientOrderId: ${clientOrderId})`
            );

            logger.warn("Orphaned order detected", {
              symbol,
              orderId: order.orderId,
              clientOrderId,
              side: order.side,
              type: order.type,
            });
          }
        }
      }
    } catch (error) {
      logger.error("Failed to check orphaned orders for symbol", error as Error, { symbol });
    }
  }
}

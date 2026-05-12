/**
 * Exchange-Agnostic Reconciliation Service
 *
 * Reconciles local trade state with any configured exchange on startup
 * and periodically via the daemon reconciliation loop. Uses the abstract
 * Exchange interface — works with Binance, Coinbase, Kraken, Bitfinex,
 * Hyperliquid, and any future adapter.
 *
 * When trades close, feeds results back to the StrategyRuntime so slot
 * capital accounting stays in sync.
 */

import type { Exchange } from "../infra/exchange/types.ts";
import { listTrades, updateTrade } from "../infra/storage/trades.ts";
import { getPlan } from "../infra/storage/plans.ts";
import { logEvent } from "../infra/storage/events.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import type { Trade, EntryFill, ExitFill } from "../types/index.ts";
import { extractOrderOwnerKey } from "../core/orders/order-recovery.ts";
import { StrategyRuntime } from "../core/runtime/engine.ts";
import { FeedbackLoop } from "../core/learning/feedback-loop.ts";
import type { ReconciliationResult } from "./reconciliation.service.ts";

const logger = createModuleLogger("reconciliation-exchange");

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

/**
 * Reconcile local trade state with any exchange adapter.
 *
 * 1. Gets all open/partial trades from the database
 * 2. For each trade, queries the exchange for order status
 * 3. Updates local state to match exchange reality
 * 4. Feeds trade closures back to StrategyRuntime
 * 5. Detects orphaned orders
 */
export async function reconcileWithExchange(
  exchange: Exchange,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    success: true,
    tradesReconciled: 0,
    ordersUpdated: 0,
    errors: [],
    warnings: [],
  };

  logger.info("Starting reconciliation", { exchange: exchange.exchangeId });

  try {
    const openTrades = listTrades({ status: "OPEN" });
    const partialTrades = listTrades({ status: "PARTIAL" });
    const activeTrades = [...openTrades, ...partialTrades];

    logger.debug("Active trades found", { count: activeTrades.length });

    if (activeTrades.length === 0) {
      logger.info("No active trades to reconcile");
      return result;
    }

    for (const trade of activeTrades) {
      try {
        const tradeResult = await reconcileTrade(exchange, trade);
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

    await checkOrphanedOrders(exchange, activeTrades, result);

    logger.info("Reconciliation complete", {
      exchange: exchange.exchangeId,
      tradesReconciled: result.tradesReconciled,
      ordersUpdated: result.ordersUpdated,
      errors: result.errors.length,
      warnings: result.warnings.length,
    });

    logEvent({
      type: "SYSTEM",
      data: {
        action: "RECONCILIATION_COMPLETE",
        exchange: exchange.exchangeId,
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

async function reconcileTrade(
  exchange: Exchange,
  trade: Trade,
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

  const allOrders = await exchange.getOrderHistory(trade.symbol, 500);

  // Match orders by clientOrderId pattern (primary) or orderId (fallback)
  const tradeOrderPattern = `gordon_${trade.planId.slice(4, 12)}`;
  const tradeOrders = allOrders.filter((order) =>
    order.clientOrderId?.startsWith(tradeOrderPattern),
  );

  logger.debug("Trade orders found on exchange", {
    tradeId: trade.id,
    exchange: exchange.exchangeId,
    orderCount: tradeOrders.length,
  });

  let needsUpdate = false;
  const updatedTrade = { ...trade };
  const previousStatus = trade.status;

  for (const order of tradeOrders) {
    const orderStatus = order.status;
    const orderId = order.orderId.toString();
    const clientOrderId = order.clientOrderId || "";

    // Entry orders
    if (clientOrderId.includes("entry") || clientOrderId.includes("grid")) {
      if (orderStatus === "FILLED") {
        const existingFill = trade.entries.find((e) => e.orderId === orderId);

        if (!existingFill) {
          const fillPrice =
            order.executedQty > 0
              ? order.cummulativeQuoteQty / order.executedQty
              : order.price;
          const fillQuantity = order.executedQty;

          const newFill: EntryFill = {
            orderId,
            price: fillPrice,
            quantity: fillQuantity,
            filledAt: order.updateTime
              ? new Date(order.updateTime).toISOString()
              : new Date().toISOString(),
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

    // Exit orders (stop or take-profit)
    if (clientOrderId.includes("stop") || clientOrderId.includes("tp")) {
      if (orderStatus === "FILLED") {
        const existingExit = trade.exits.find((e) => e.orderId === orderId);

        if (!existingExit) {
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

          const exitPrice =
            order.executedQty > 0
              ? order.cummulativeQuoteQty / order.executedQty
              : order.price;
          const exitQuantity = order.executedQty;

          const newExit: ExitFill = {
            orderId,
            price: exitPrice,
            quantity: exitQuantity,
            filledAt: order.updateTime
              ? new Date(order.updateTime).toISOString()
              : new Date().toISOString(),
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

  // Recalculate trade metrics
  if (needsUpdate) {
    if (updatedTrade.entries.length > 0) {
      let totalValue = 0;
      let totalQty = 0;
      for (const entry of updatedTrade.entries) {
        totalValue += entry.price * entry.quantity;
        totalQty += entry.quantity;
      }
      updatedTrade.averageEntry = totalQty > 0 ? totalValue / totalQty : 0;
    }

    if (updatedTrade.exits.length > 0 && updatedTrade.averageEntry > 0) {
      // Determine direction for correct PnL sign (shorts profit when price drops)
      // plan is already fetched and validated non-null at line 146
      const pnlMultiplier = plan.direction === "short" ? -1 : 1;

      let totalPnl = 0;
      let totalExitQty = 0;
      for (const exit of updatedTrade.exits) {
        totalPnl += pnlMultiplier * (exit.price - updatedTrade.averageEntry) * exit.quantity;
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

    updateTrade(trade.id, updatedTrade);

    logEvent({
      type: "SYSTEM",
      data: {
        action: "TRADE_RECONCILED",
        tradeId: trade.id,
        exchange: exchange.exchangeId,
        entriesAdded: updatedTrade.entries.length - trade.entries.length,
        exitsAdded: updatedTrade.exits.length - trade.exits.length,
        newStatus: updatedTrade.status,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });

    // Gap 5: Feed trade closure back to StrategyRuntime
    if (updatedTrade.status === "CLOSED" && previousStatus !== "CLOSED") {
      feedbackToStrategyRuntime(updatedTrade);

      // v0.75: Counterfactual learning — fire-and-forget
      triggerCounterfactualAnalysis(updatedTrade, exchange).catch(() => {});
    }
  }

  return result;
}

/**
 * Feed a closed trade's PnL back to the StrategyRuntime so slot
 * capital accounting stays in sync.
 */
function feedbackToStrategyRuntime(trade: Trade): void {
  try {
    const runtime = StrategyRuntime.getInstance();
    const activeSlots = runtime.getActiveSlots();

    if (activeSlots.length === 0) return;

    if (activeSlots.length > 1) {
      logger.warn("Multiple active slots — PnL attributed to first slot (heuristic)", {
        tradeId: trade.id,
        slotCount: activeSlots.length,
      });
    }

    // Best-effort match: use first active slot.
    // A future enhancement can add a tradeId→slotId mapping table.
    const matchingSlot = activeSlots[0];

    if (matchingSlot) {
      runtime.recordTradeResult(matchingSlot.slot_id, {
        pnl: trade.realizedPnl,
        fees: 0,
      });
      logger.info("StrategyRuntime feedback recorded", {
        tradeId: trade.id,
        slotId: matchingSlot.slot_id,
        pnl: trade.realizedPnl,
      });
    }
  } catch (err) {
    logger.warn("Could not feed trade result to StrategyRuntime", {
      tradeId: trade.id,
      error: (err as Error).message,
    });
  }
}

async function triggerCounterfactualAnalysis(
  trade: Trade,
  exchange: Exchange,
): Promise<void> {
  try {
    const feedbackLoop = FeedbackLoop.getInstance();
    await feedbackLoop.onTradeClosed(trade, exchange);
  } catch (err) {
    logger.debug("Counterfactual analysis skipped", {
      tradeId: trade.id,
      error: (err as Error).message,
    });
  }
}

async function checkOrphanedOrders(
  exchange: Exchange,
  activeTrades: Trade[],
  result: ReconciliationResult,
): Promise<void> {
  const symbols = new Set(activeTrades.map((t) => t.symbol));
  const knownOrderOwnerKeys = buildKnownOrderOwnerKeys(activeTrades);

  for (const symbol of symbols) {
    try {
      const openOrders = await exchange.getOpenOrders(symbol);

      for (const order of openOrders) {
        const clientOrderId = order.clientOrderId || "";

        if (clientOrderId.startsWith("gordon_")) {
          const ownerKey = extractOrderOwnerKey(clientOrderId);
          const matchingTrade = ownerKey ? knownOrderOwnerKeys.has(ownerKey) : false;

          if (!matchingTrade) {
            // Auto-cancel orphaned Gordon orders
            try {
              await exchange.cancelOrder(symbol, order.orderId.toString());
              result.warnings.push(
                `Orphaned order auto-cancelled: ${order.orderId} for ${symbol} (clientOrderId: ${clientOrderId})`,
              );
              logger.info("Orphaned order auto-cancelled", {
                symbol,
                exchange: exchange.exchangeId,
                orderId: order.orderId,
                clientOrderId,
                side: order.side,
                type: order.type,
              });

              logEvent({
                type: "SYSTEM",
                data: {
                  action: "ORPHANED_ORDER_CANCELLED",
                  symbol,
                  orderId: order.orderId,
                  clientOrderId,
                },
              });
            } catch (cancelErr) {
              result.warnings.push(
                `Orphaned order found but cancel failed: ${order.orderId} for ${symbol} — ${(cancelErr as Error).message}`,
              );
              logger.warn("Failed to cancel orphaned order", {
                symbol,
                orderId: order.orderId,
                error: (cancelErr as Error).message,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error("Failed to check orphaned orders for symbol", error as Error, { symbol });
    }
  }
}

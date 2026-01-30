/**
 * Monitor module for Gordon CLI
 *
 * Tracks open positions and detects events.
 * Fully deterministic (no AI involved).
 *
 * The monitor runs every 15 minutes while the CLI is open.
 */

import { BinanceClient } from "../infra/binance/index.ts";
import type { OrderParams } from "../infra/binance/index.ts";
import { listTrades, updateTrade } from "../infra/storage/trades.ts";
import { logEvent } from "../infra/storage/events.ts";
import { getPlan } from "../infra/storage/plans.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import { emitEvent } from "../events/index.ts";
import type { Trade, Plan, ExitFill, EntryFill } from "../types/index.ts";

const logger = createModuleLogger("monitor");

// ============================================================================
// Types
// ============================================================================

export interface MonitorUpdate {
  trade: Trade;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  distanceToStop: number;      // percentage
  distanceToNextTP: number;    // percentage
  status: "healthy" | "warning" | "critical";
}

export interface Alert {
  type: "price_near_stop" | "price_near_tp" | "volume_spike" | "flash_crash" | "order_filled";
  tradeId?: string;
  message: string;
  severity: "info" | "warning" | "critical";
  data: Record<string, unknown>;
}

export interface MonitorResult {
  updates: MonitorUpdate[];
  alerts: Alert[];
  timestamp: string;
}

// ============================================================================
// Constants
// ============================================================================

const CRITICAL_THRESHOLD_PERCENT = 1;
const WARNING_THRESHOLD_PERCENT = 3;
const TP_APPROACH_THRESHOLD_PERCENT = 2;
const VOLUME_SPIKE_MULTIPLIER = 3;
const FLASH_CRASH_THRESHOLD_PERCENT = 5;
const VOLUME_AVERAGE_PERIODS = 20;
const GRID_REVERSAL_THRESHOLD = 0.01; // 1% reversal triggers deferred TP placement

// ============================================================================
// Utility Functions (duplicated from executor for independence)
// ============================================================================

/**
 * Round quantity to appropriate precision for Binance
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
 * Generate a unique client order ID for tracking
 */
function generateClientOrderId(planId: string, type: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `gordon_${planId.slice(4, 12)}_${type}_${timestamp}_${random}`;
}

// ============================================================================
// Main Monitor Function
// ============================================================================

/**
 * Run a complete monitor cycle
 */
export async function runMonitorCycle(
  client: BinanceClient
): Promise<MonitorResult> {
  const timestamp = new Date().toISOString();
  const updates: MonitorUpdate[] = [];
  const alerts: Alert[] = [];

  logger.debug("Starting monitor cycle");

  // 1. Get all open trades
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const allActiveTrades = [...openTrades, ...partialTrades];

  logger.debug("Active trades found", { count: allActiveTrades.length });

  const symbolsToCheck = new Set<string>();

  // 2. Process each active trade
  for (const trade of allActiveTrades) {
    try {
      const update = await processTradeUpdate(client, trade, alerts);
      if (update) {
        updates.push(update);
        symbolsToCheck.add(trade.symbol);
      }
    } catch (error) {
      logger.error("Monitor error for trade", error as Error, { tradeId: trade.id });
      logEvent({
        type: "ERROR",
        data: {
          error: error instanceof Error ? error.message : "Unknown error",
          context: "monitor_cycle",
          tradeId: trade.id,
        },
        tradeId: trade.id,
      });
    }
  }

  // 3. Check for market anomalies
  for (const symbol of symbolsToCheck) {
    try {
      const anomalyAlerts = await checkMarketAnomalies(client, symbol);
      alerts.push(...anomalyAlerts);
    } catch (error) {
      logger.error("Anomaly check error", error as Error, { symbol });
    }
  }

  logger.debug("Monitor cycle complete", {
    updates: updates.length,
    alerts: alerts.length,
  });

  return {
    updates,
    alerts,
    timestamp,
  };
}

// ============================================================================
// Trade Processing
// ============================================================================

async function processTradeUpdate(
  client: BinanceClient,
  trade: Trade,
  alerts: Alert[]
): Promise<MonitorUpdate | null> {
  const plan = getPlan(trade.planId);
  if (!plan) {
    logger.error("Plan not found for trade", undefined, { tradeId: trade.id, planId: trade.planId });
    return null;
  }

  const currentPrice = await client.getPrice(trade.symbol);

  const fillAlerts = await checkOrderFills(client, trade, plan);
  alerts.push(...fillAlerts);

  const { unrealizedPnl, unrealizedPnlPercent } = calculateUnrealizedPnl(
    trade,
    currentPrice
  );

  const distanceToStop = calculateDistanceToStop(currentPrice, plan);
  const distanceToNextTP = calculateDistanceToNextTP(trade, currentPrice, plan);
  const status = determineHealthStatus(distanceToStop);

  // Generate alerts for approaching stop or TP
  if (status === "warning" || status === "critical") {
    const alert: Alert = {
      type: "price_near_stop",
      tradeId: trade.id,
      message: `${trade.symbol}: Price approaching stop loss (${distanceToStop.toFixed(2)}% away)`,
      severity: status,
      data: {
        symbol: trade.symbol,
        currentPrice,
        stopPrice: plan.stopLoss.price,
        distancePercent: distanceToStop,
      },
    };
    alerts.push(alert);

    // Emit event
    await emitEvent("alert:stop_approaching", {
      tradeId: trade.id,
      symbol: trade.symbol,
      currentPrice,
      stopPrice: plan.stopLoss.price,
      distance: distanceToStop,
    });

    logEvent({
      type: "ALERT",
      data: {
        alertType: "price_near_stop",
        status,
        currentPrice,
        stopPrice: plan.stopLoss.price,
        distancePercent: distanceToStop,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });
  }

  if (distanceToNextTP <= TP_APPROACH_THRESHOLD_PERCENT && distanceToNextTP > 0) {
    alerts.push({
      type: "price_near_tp",
      tradeId: trade.id,
      message: `${trade.symbol}: Price approaching take profit (${distanceToNextTP.toFixed(2)}% away)`,
      severity: "info",
      data: {
        symbol: trade.symbol,
        currentPrice,
        distancePercent: distanceToNextTP,
      },
    });
  }

  return {
    trade,
    currentPrice,
    unrealizedPnl,
    unrealizedPnlPercent,
    distanceToStop,
    distanceToNextTP,
    status,
  };
}

async function checkOrderFills(
  client: BinanceClient,
  trade: Trade,
  plan: Plan
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // Check if this is a grid entry plan
  if (plan.strategy === "grid_entry" && plan.grid) {
    return await checkGridFills(client, trade, plan, alerts);
  }

  try {
    const openOrders = await client.getOpenOrders(trade.symbol);
    const openOrderIds = new Set(openOrders.map((o) => String(o.orderId)));

    let tradeUpdated = false;
    const updatedTrade = { ...trade };

    const stopPrice = plan.stopLoss.price;
    const currentPrice = await client.getPrice(trade.symbol);

    // If price has crossed below stop loss
    if (currentPrice <= stopPrice && trade.status !== "CLOSED") {
      const stopFill: ExitFill = {
        orderId: `stop_${trade.id}`,
        price: stopPrice,
        quantity: calculateRemainingQuantity(trade),
        filledAt: new Date().toISOString(),
        reason: "STOP",
      };

      updatedTrade.exits = [...trade.exits, stopFill];
      updatedTrade.status = "CLOSED";
      updatedTrade.closedAt = new Date().toISOString();

      const { realizedPnl, realizedPnlPercent } = calculateRealizedPnl(updatedTrade);
      updatedTrade.realizedPnl = realizedPnl;
      updatedTrade.realizedPnlPercent = realizedPnlPercent;

      tradeUpdated = true;

      alerts.push({
        type: "order_filled",
        tradeId: trade.id,
        message: `${trade.symbol}: Stop loss triggered at ${stopPrice}`,
        severity: "critical",
        data: {
          orderType: "STOP",
          fillPrice: stopPrice,
          realizedPnl,
          realizedPnlPercent,
        },
      });

      logger.warn("Stop loss triggered", {
        tradeId: trade.id,
        symbol: trade.symbol,
        stopPrice,
        pnl: realizedPnl,
      });

      logEvent({
        type: "ORDER_FILLED",
        data: {
          orderType: "STOP",
          fillPrice: stopPrice,
          realizedPnl,
          realizedPnlPercent,
        },
        tradeId: trade.id,
        planId: trade.planId,
      });
    }

    // Check take profit fills
    for (let i = 0; i < plan.takeProfit.length; i++) {
      const tp = plan.takeProfit[i];
      if (!tp) {
        continue;
      }
      const tpLabel = `TP${i + 1}` as "TP1" | "TP2" | "TP3";

      const alreadyFilled = trade.exits.some((exit) => exit.reason === tpLabel);
      if (alreadyFilled) {
        continue;
      }

      if (currentPrice >= tp.price && trade.status !== "CLOSED") {
        const remainingQty = calculateRemainingQuantity(updatedTrade);
        const tpQuantity = remainingQty * tp.percentToSell;

        const tpFill: ExitFill = {
          orderId: `tp${i + 1}_${trade.id}`,
          price: tp.price,
          quantity: tpQuantity,
          filledAt: new Date().toISOString(),
          reason: tpLabel,
        };

        updatedTrade.exits = [...updatedTrade.exits, tpFill];

        const totalExitPercent = calculateTotalExitPercent(updatedTrade);
        if (totalExitPercent >= 0.99) {
          updatedTrade.status = "CLOSED";
          updatedTrade.closedAt = new Date().toISOString();
        } else {
          updatedTrade.status = "PARTIAL";
        }

        const { realizedPnl, realizedPnlPercent } = calculateRealizedPnl(updatedTrade);
        updatedTrade.realizedPnl = realizedPnl;
        updatedTrade.realizedPnlPercent = realizedPnlPercent;

        tradeUpdated = true;

        alerts.push({
          type: "order_filled",
          tradeId: trade.id,
          message: `${trade.symbol}: ${tpLabel} triggered at ${tp.price}`,
          severity: "info",
          data: {
            orderType: tpLabel,
            fillPrice: tp.price,
            quantity: tpQuantity,
            percentSold: tp.percentToSell * 100,
          },
        });

        // Emit TP hit event
        await emitEvent("alert:tp_hit", {
          tradeId: trade.id,
          symbol: trade.symbol,
          level: (i + 1) as 1 | 2 | 3,
          price: tp.price,
        });

        logger.info("Take profit triggered", {
          tradeId: trade.id,
          symbol: trade.symbol,
          level: tpLabel,
          price: tp.price,
        });

        logEvent({
          type: "ORDER_FILLED",
          data: {
            orderType: tpLabel,
            fillPrice: tp.price,
            quantity: tpQuantity,
            percentSold: tp.percentToSell * 100,
          },
          tradeId: trade.id,
          planId: trade.planId,
        });
      }
    }

    if (tradeUpdated) {
      updateTrade(trade.id, updatedTrade);
    }
  } catch (error) {
    logger.error("Error checking order fills", error as Error, { symbol: trade.symbol });
  }

  return alerts;
}

// ============================================================================
// Grid Fill Monitoring
// ============================================================================

/**
 * Check grid entry fills and manage deferred take profits
 *
 * Grid entry strategy works by placing multiple limit buy orders at descending
 * price levels. As price falls through each level, orders fill incrementally.
 * Take profits are deferred until either:
 * 1. All grid levels have filled, OR
 * 2. Price reverses 1% above the highest filled level
 */
async function checkGridFills(
  client: BinanceClient,
  trade: Trade,
  plan: Plan,
  alerts: Alert[]
): Promise<Alert[]> {
  if (!plan.grid) {
    return alerts;
  }

  try {
    const currentPrice = await client.getPrice(trade.symbol);
    const openOrders = await client.getOpenOrders(trade.symbol);
    const stopPrice = plan.stopLoss.price;

    let tradeUpdated = false;
    const updatedTrade = { ...trade };

    // Track which grid levels have filled based on entries
    const filledLevelPrices = new Set(trade.entries.map(e => e.price));
    const gridLevels = plan.grid.levels;

    // Check each grid level for fills (price <= level price means fill)
    for (let i = 0; i < gridLevels.length; i++) {
      const level = gridLevels[i]!;
      const levelLabel = `GRID_${i + 1}`;

      // Skip if already filled
      if (filledLevelPrices.has(level.price)) {
        continue;
      }

      // Check if current price has crossed below this grid level
      if (currentPrice <= level.price) {
        // Calculate quantity for this level
        const levelQuantity = roundQuantity(
          (plan.allocation.amount * level.percentOfAllocation) / level.price
        );

        // Create entry fill for this grid level
        const gridFill: EntryFill = {
          orderId: `grid_${i + 1}_${trade.id}`,
          price: level.price,
          quantity: levelQuantity,
          filledAt: new Date().toISOString(),
        };

        updatedTrade.entries = [...updatedTrade.entries, gridFill];
        tradeUpdated = true;

        // Recalculate weighted average entry
        const newAvgEntry = calculateWeightedAverageEntry(updatedTrade.entries);
        updatedTrade.averageEntry = newAvgEntry;

        alerts.push({
          type: "order_filled",
          tradeId: trade.id,
          message: `${trade.symbol}: Grid level ${i + 1} filled at ${level.price}`,
          severity: "info",
          data: {
            orderType: levelLabel,
            fillPrice: level.price,
            quantity: levelQuantity,
            newAverageEntry: newAvgEntry,
            gridLevelsFilled: updatedTrade.entries.length,
            totalGridLevels: gridLevels.length,
          },
        });

        logger.info("Grid level filled", {
          tradeId: trade.id,
          symbol: trade.symbol,
          level: i + 1,
          price: level.price,
          quantity: levelQuantity,
          newAvgEntry,
        });

        logEvent({
          type: "ORDER_FILLED",
          data: {
            orderType: levelLabel,
            fillPrice: level.price,
            quantity: levelQuantity,
            newAverageEntry: newAvgEntry,
          },
          tradeId: trade.id,
          planId: trade.planId,
        });
      }
    }

    // Check if stop loss has been hit
    if (currentPrice <= stopPrice && updatedTrade.status !== "CLOSED") {
      const remainingQty = calculateRemainingQuantity(updatedTrade);

      if (remainingQty > 0) {
        const stopFill: ExitFill = {
          orderId: `stop_${trade.id}`,
          price: stopPrice,
          quantity: remainingQty,
          filledAt: new Date().toISOString(),
          reason: "STOP",
        };

        updatedTrade.exits = [...updatedTrade.exits, stopFill];
        updatedTrade.status = "CLOSED";
        updatedTrade.closedAt = new Date().toISOString();

        const { realizedPnl, realizedPnlPercent } = calculateRealizedPnl(updatedTrade);
        updatedTrade.realizedPnl = realizedPnl;
        updatedTrade.realizedPnlPercent = realizedPnlPercent;
        tradeUpdated = true;

        alerts.push({
          type: "order_filled",
          tradeId: trade.id,
          message: `${trade.symbol}: Grid stop loss triggered at ${stopPrice}`,
          severity: "critical",
          data: {
            orderType: "STOP",
            fillPrice: stopPrice,
            quantity: remainingQty,
            realizedPnl,
            realizedPnlPercent,
          },
        });

        logger.warn("Grid stop loss triggered", {
          tradeId: trade.id,
          symbol: trade.symbol,
          stopPrice,
          pnl: realizedPnl,
        });

        logEvent({
          type: "ORDER_FILLED",
          data: {
            orderType: "STOP",
            fillPrice: stopPrice,
            realizedPnl,
            realizedPnlPercent,
          },
          tradeId: trade.id,
          planId: trade.planId,
        });
      }
    }

    // Check if we should place deferred take profits
    if (updatedTrade.status !== "CLOSED" && updatedTrade.entries.length > 0) {
      const filledLevels = updatedTrade.entries.length;
      const totalLevels = gridLevels.length;
      const allLevelsFilled = filledLevels >= totalLevels;

      // Find the highest filled level price
      const highestFilledPrice = Math.max(...updatedTrade.entries.map(e => e.price));

      // Check for price reversal (1% above highest filled level)
      const reversalThreshold = highestFilledPrice * (1 + GRID_REVERSAL_THRESHOLD);
      const priceReversed = currentPrice >= reversalThreshold;

      // Check if TPs have already been placed (by checking for existing TP exits or TP orders)
      const hasTakeProfitOrders = openOrders.some(o =>
        o.side === "SELL" && o.type === "LIMIT"
      );

      // Place deferred TPs if: (all levels filled OR price reversed) AND no TPs placed yet
      if ((allLevelsFilled || priceReversed) && !hasTakeProfitOrders && updatedTrade.exits.length === 0) {
        const totalQuantity = updatedTrade.entries.reduce((sum, e) => sum + e.quantity, 0);

        logger.info("Placing deferred take profits", {
          tradeId: trade.id,
          symbol: trade.symbol,
          reason: allLevelsFilled ? "all_levels_filled" : "price_reversal",
          totalQuantity,
          filledLevels,
          currentPrice,
        });

        await placeDeferredTakeProfits(client, updatedTrade, plan, totalQuantity, alerts);

        alerts.push({
          type: "order_filled",
          tradeId: trade.id,
          message: `${trade.symbol}: Deferred take profits placed (${allLevelsFilled ? "all levels filled" : "price reversal"})`,
          severity: "info",
          data: {
            reason: allLevelsFilled ? "all_levels_filled" : "price_reversal",
            filledLevels,
            totalLevels,
            currentPrice,
            reversalThreshold,
          },
        });
      }
    }

    if (tradeUpdated) {
      updateTrade(trade.id, updatedTrade);
    }
  } catch (error) {
    logger.error("Error checking grid fills", error as Error, {
      tradeId: trade.id,
      symbol: trade.symbol
    });
  }

  return alerts;
}

/**
 * Calculate weighted average entry from entries array
 */
function calculateWeightedAverageEntry(entries: EntryFill[]): number {
  if (entries.length === 0) return 0;

  let totalValue = 0;
  let totalQuantity = 0;

  for (const entry of entries) {
    totalValue += entry.price * entry.quantity;
    totalQuantity += entry.quantity;
  }

  return totalQuantity > 0 ? roundPrice(totalValue / totalQuantity) : 0;
}

/**
 * Place deferred take profit orders after grid entries have filled
 *
 * This is called when either all grid levels have filled or price has
 * reversed above the highest filled level, indicating the dip-buying
 * phase is complete.
 */
async function placeDeferredTakeProfits(
  client: BinanceClient,
  trade: Trade,
  plan: Plan,
  totalQuantity: number,
  alerts: Alert[]
): Promise<void> {
  let remainingQuantity = totalQuantity;

  for (let i = 0; i < plan.takeProfit.length; i++) {
    const tp = plan.takeProfit[i];
    if (!tp) continue;

    const isLastTP = i === plan.takeProfit.length - 1;

    // Calculate quantity for this TP level
    const tpQuantity = isLastTP
      ? roundQuantity(remainingQuantity)
      : roundQuantity(totalQuantity * tp.percentToSell);

    remainingQuantity = roundQuantity(remainingQuantity - tpQuantity);

    if (tpQuantity <= 0) continue;

    const tpOrderParams: OrderParams = {
      symbol: trade.symbol,
      side: "SELL",
      type: "LIMIT",
      quantity: tpQuantity,
      price: roundPrice(tp.price),
      timeInForce: "GTC",
      newClientOrderId: generateClientOrderId(trade.planId, `tp${i + 1}`),
    };

    try {
      const tpOrder = await client.placeOrder(tpOrderParams);

      logger.info("Deferred take profit order placed", {
        tradeId: trade.id,
        level: i + 1,
        orderId: tpOrder.orderId,
        price: tp.price,
        quantity: tpQuantity,
      });

      logEvent({
        type: "ORDER_PLACED",
        data: {
          action: `DEFERRED_TP_${i + 1}`,
          orderId: tpOrder.orderId.toString(),
          symbol: trade.symbol,
          side: "SELL",
          type: "LIMIT",
          price: tp.price,
          quantity: tpQuantity,
        },
        tradeId: trade.id,
        planId: trade.planId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to place deferred TP order", error as Error, {
        tradeId: trade.id,
        level: i + 1,
        params: tpOrderParams,
      });

      logEvent({
        type: "ERROR",
        data: {
          action: "DEFERRED_TP_FAILED",
          tpLevel: i + 1,
          params: tpOrderParams,
          error: errorMessage,
        },
        tradeId: trade.id,
        planId: trade.planId,
      });

      alerts.push({
        type: "order_filled",
        tradeId: trade.id,
        message: `${trade.symbol}: Failed to place deferred TP${i + 1}: ${errorMessage}`,
        severity: "warning",
        data: {
          orderType: `DEFERRED_TP_${i + 1}`,
          error: errorMessage,
        },
      });
    }
  }
}

// ============================================================================
// PnL Calculations
// ============================================================================

function calculateUnrealizedPnl(
  trade: Trade,
  currentPrice: number
): { unrealizedPnl: number; unrealizedPnlPercent: number } {
  const avgEntry = trade.averageEntry;
  const remainingQty = calculateRemainingQuantity(trade);

  if (avgEntry === 0 || remainingQty === 0) {
    return { unrealizedPnl: 0, unrealizedPnlPercent: 0 };
  }

  const unrealizedPnl = (currentPrice - avgEntry) * remainingQty;
  const unrealizedPnlPercent = ((currentPrice - avgEntry) / avgEntry) * 100;

  return { unrealizedPnl, unrealizedPnlPercent };
}

function calculateRealizedPnl(
  trade: Trade
): { realizedPnl: number; realizedPnlPercent: number } {
  const avgEntry = trade.averageEntry;

  if (avgEntry === 0 || trade.exits.length === 0) {
    return { realizedPnl: 0, realizedPnlPercent: 0 };
  }

  let totalRealizedPnl = 0;
  let totalExitQty = 0;

  for (const exit of trade.exits) {
    const exitPnl = (exit.price - avgEntry) * exit.quantity;
    totalRealizedPnl += exitPnl;
    totalExitQty += exit.quantity;
  }

  const entryValue = avgEntry * totalExitQty;
  const realizedPnlPercent = entryValue > 0
    ? (totalRealizedPnl / entryValue) * 100
    : 0;

  return { realizedPnl: totalRealizedPnl, realizedPnlPercent };
}

function calculateRemainingQuantity(trade: Trade): number {
  const totalEntryQty = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalExitQty = trade.exits.reduce((sum, e) => sum + e.quantity, 0);
  return totalEntryQty - totalExitQty;
}

function calculateTotalExitPercent(trade: Trade): number {
  const totalEntryQty = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalExitQty = trade.exits.reduce((sum, e) => sum + e.quantity, 0);
  return totalEntryQty > 0 ? totalExitQty / totalEntryQty : 0;
}

// ============================================================================
// Distance Calculations
// ============================================================================

function calculateDistanceToStop(currentPrice: number, plan: Plan): number {
  const stopPrice = plan.stopLoss.price;
  if (currentPrice === 0) return 0;
  return ((currentPrice - stopPrice) / currentPrice) * 100;
}

function calculateDistanceToNextTP(
  trade: Trade,
  currentPrice: number,
  plan: Plan
): number {
  if (currentPrice === 0) return 0;

  const filledTPs = new Set(
    trade.exits
      .filter((e) => e.reason.startsWith("TP"))
      .map((e) => e.reason)
  );

  for (let i = 0; i < plan.takeProfit.length; i++) {
    const tpLabel = `TP${i + 1}` as "TP1" | "TP2" | "TP3";
    const tp = plan.takeProfit[i];
    if (!filledTPs.has(tpLabel) && tp) {
      const tpPrice = tp.price;
      return ((tpPrice - currentPrice) / currentPrice) * 100;
    }
  }

  return 0;
}

// ============================================================================
// Health Status
// ============================================================================

function determineHealthStatus(distanceToStop: number): "healthy" | "warning" | "critical" {
  if (distanceToStop <= CRITICAL_THRESHOLD_PERCENT) {
    return "critical";
  } else if (distanceToStop <= WARNING_THRESHOLD_PERCENT) {
    return "warning";
  }
  return "healthy";
}

// ============================================================================
// Anomaly Detection
// ============================================================================

async function checkMarketAnomalies(
  client: BinanceClient,
  symbol: string
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  try {
    const candles = await client.getCandles(symbol, "15m", VOLUME_AVERAGE_PERIODS + 1);

    if (candles.length < 2) {
      return alerts;
    }

    const currentCandle = candles[candles.length - 1];
    const previousCandles = candles.slice(0, -1);

    if (!currentCandle) {
      return alerts;
    }

    const volumeSpikeAlert = checkVolumeSpike(symbol, currentCandle, previousCandles);
    if (volumeSpikeAlert) {
      alerts.push(volumeSpikeAlert);
      logger.warn("Volume spike detected", { symbol, ratio: volumeSpikeAlert.data.ratio });
      logEvent({
        type: "ALERT",
        data: {
          alertType: "volume_spike",
          symbol,
          currentVolume: currentCandle.volume,
          averageVolume: volumeSpikeAlert.data.averageVolume,
          ratio: volumeSpikeAlert.data.ratio,
        },
      });
    }

    const flashCrashAlert = checkFlashCrash(symbol, currentCandle);
    if (flashCrashAlert) {
      alerts.push(flashCrashAlert);
      logger.warn("Flash crash detected", { symbol, dropPercent: flashCrashAlert.data.dropPercent });
      logEvent({
        type: "ALERT",
        data: {
          alertType: "flash_crash",
          symbol,
          open: currentCandle.open,
          close: currentCandle.close,
          dropPercent: flashCrashAlert.data.dropPercent,
        },
      });
    }
  } catch (error) {
    logger.error("Error checking anomalies", error as Error, { symbol });
  }

  return alerts;
}

function checkVolumeSpike(
  symbol: string,
  currentCandle: { volume: number },
  previousCandles: { volume: number }[]
): Alert | null {
  if (previousCandles.length === 0) return null;

  const averageVolume =
    previousCandles.reduce((sum, c) => sum + c.volume, 0) / previousCandles.length;

  if (averageVolume === 0) return null;

  const ratio = currentCandle.volume / averageVolume;

  if (ratio >= VOLUME_SPIKE_MULTIPLIER) {
    return {
      type: "volume_spike",
      message: `${symbol}: Volume spike detected (${ratio.toFixed(1)}x average)`,
      severity: "warning",
      data: {
        symbol,
        currentVolume: currentCandle.volume,
        averageVolume,
        ratio,
      },
    };
  }

  return null;
}

function checkFlashCrash(
  symbol: string,
  currentCandle: { open: number; close: number; low: number }
): Alert | null {
  if (currentCandle.open === 0) return null;

  const dropPercent = ((currentCandle.open - currentCandle.close) / currentCandle.open) * 100;
  const maxDropPercent = ((currentCandle.open - currentCandle.low) / currentCandle.open) * 100;

  if (dropPercent >= FLASH_CRASH_THRESHOLD_PERCENT || maxDropPercent >= FLASH_CRASH_THRESHOLD_PERCENT) {
    return {
      type: "flash_crash",
      message: `${symbol}: Flash crash detected (${Math.max(dropPercent, maxDropPercent).toFixed(1)}% drop)`,
      severity: "critical",
      data: {
        symbol,
        open: currentCandle.open,
        close: currentCandle.close,
        low: currentCandle.low,
        dropPercent: Math.max(dropPercent, maxDropPercent),
      },
    };
  }

  return null;
}

// ============================================================================
// Formatting
// ============================================================================

export function formatTradeStatus(update: MonitorUpdate): string {
  const { trade, currentPrice, unrealizedPnl, unrealizedPnlPercent, distanceToStop, distanceToNextTP, status } = update;

  const statusIndicator = status === "critical" ? "[!!!]" :
                          status === "warning" ? "[!]" :
                          "[OK]";

  const pnlSign = unrealizedPnl >= 0 ? "+" : "";
  const pnlFormatted = `${pnlSign}$${unrealizedPnl.toFixed(2)} (${pnlSign}${unrealizedPnlPercent.toFixed(2)}%)`;

  const lines = [
    `${statusIndicator} ${trade.symbol}`,
    `  Status: ${trade.status}`,
    `  Entry: $${trade.averageEntry.toFixed(4)}`,
    `  Current: $${currentPrice.toFixed(4)}`,
    `  Unrealized PnL: ${pnlFormatted}`,
    `  Distance to Stop: ${distanceToStop.toFixed(2)}%`,
    `  Distance to Next TP: ${distanceToNextTP.toFixed(2)}%`,
  ];

  if (trade.exits.length > 0) {
    const realizedSign = trade.realizedPnl >= 0 ? "+" : "";
    lines.push(`  Realized PnL: ${realizedSign}$${trade.realizedPnl.toFixed(2)} (${realizedSign}${trade.realizedPnlPercent.toFixed(2)}%)`);
  }

  return lines.join("\n");
}

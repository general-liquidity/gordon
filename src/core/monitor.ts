/**
 * Monitor module for Gordon CLI
 *
 * Tracks open positions and detects events.
 * Fully deterministic (no AI involved).
 *
 * The monitor runs every 15 minutes while the CLI is open.
 */

import { BinanceClient } from "../infra/binance/index.ts";
import { listTrades, updateTrade } from "../infra/storage/trades.ts";
import { logEvent } from "../infra/storage/events.ts";
import { getPlan } from "../infra/storage/plans.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import { emitEvent } from "../events/index.ts";
import type { Trade, Plan, ExitFill } from "../types/index.ts";

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

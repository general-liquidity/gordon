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
import type { Trade, Plan, ExitFill } from "../types/index.ts";

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
  data: Record<string, any>;
}

export interface MonitorResult {
  updates: MonitorUpdate[];
  alerts: Alert[];
  timestamp: string;
}

// ============================================================================
// Constants
// ============================================================================

// Health status thresholds (distance to stop loss)
const CRITICAL_THRESHOLD_PERCENT = 1;  // Within 1% of stop = critical
const WARNING_THRESHOLD_PERCENT = 3;   // Within 3% of stop = warning

// TP approach threshold for alerts
const TP_APPROACH_THRESHOLD_PERCENT = 2;  // Within 2% of TP = generate info alert

// Anomaly detection thresholds
const VOLUME_SPIKE_MULTIPLIER = 3;       // Current volume > 3x average = spike
const FLASH_CRASH_THRESHOLD_PERCENT = 5; // Price dropped > 5% in last candle = crash

// Candle settings for anomaly detection
const VOLUME_AVERAGE_PERIODS = 20;

// ============================================================================
// Main Monitor Function
// ============================================================================

/**
 * Run a complete monitor cycle
 *
 * 1. Get all open trades from storage
 * 2. For each trade: fetch price, check fills, calculate PnL, determine health
 * 3. Check for market anomalies (volume spikes, flash crashes)
 * 4. Generate alerts for significant events
 * 5. Log events and return results
 *
 * @param client - BinanceClient instance for fetching market data
 * @returns MonitorResult with updates and alerts
 */
export async function runMonitorCycle(
  client: BinanceClient
): Promise<MonitorResult> {
  const timestamp = new Date().toISOString();
  const updates: MonitorUpdate[] = [];
  const alerts: Alert[] = [];

  // 1. Get all open trades (OPEN or PARTIAL status)
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const allActiveTrades = [...openTrades, ...partialTrades];

  // Track unique symbols for anomaly checking
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
      console.error(`Monitor error for trade ${trade.id}:`, error);
      // Log error event but continue with other trades
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

  // 3. Check for market anomalies on all symbols with active trades
  for (const symbol of symbolsToCheck) {
    try {
      const anomalyAlerts = await checkMarketAnomalies(client, symbol);
      alerts.push(...anomalyAlerts);
    } catch (error) {
      console.error(`Anomaly check error for ${symbol}:`, error);
    }
  }

  return {
    updates,
    alerts,
    timestamp,
  };
}

// ============================================================================
// Trade Processing
// ============================================================================

/**
 * Process a single trade and generate its update
 */
async function processTradeUpdate(
  client: BinanceClient,
  trade: Trade,
  alerts: Alert[]
): Promise<MonitorUpdate | null> {
  // Get the associated plan for stop loss and take profit levels
  const plan = getPlan(trade.planId);
  if (!plan) {
    console.error(`Plan not found for trade ${trade.id}`);
    return null;
  }

  // a. Fetch current price from Binance
  const currentPrice = await client.getPrice(trade.symbol);

  // b. Check if any orders have filled
  const fillAlerts = await checkOrderFills(client, trade, plan);
  alerts.push(...fillAlerts);

  // c. Calculate unrealized PnL
  const { unrealizedPnl, unrealizedPnlPercent } = calculateUnrealizedPnl(
    trade,
    currentPrice
  );

  // d. Calculate distances to stop and next TP
  const distanceToStop = calculateDistanceToStop(currentPrice, plan);
  const distanceToNextTP = calculateDistanceToNextTP(trade, currentPrice, plan);

  // e. Determine health status based on distance to stop
  const status = determineHealthStatus(distanceToStop);

  // Generate alerts for approaching stop or TP
  if (status === "warning" || status === "critical") {
    alerts.push({
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
    });

    // Log event for price approaching stop
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

  // Alert if approaching TP
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

/**
 * Check if any orders have filled on Binance
 */
async function checkOrderFills(
  client: BinanceClient,
  trade: Trade,
  plan: Plan
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  try {
    // Get all open orders for this symbol
    const openOrders = await client.getOpenOrders(trade.symbol);
    const openOrderIds = new Set(openOrders.map((o) => String(o.orderId)));

    // Track if we need to update the trade
    let tradeUpdated = false;
    const updatedTrade = { ...trade };

    // Check entry orders - if they were open but no longer are, they may have filled
    // Note: In a real implementation, we would query specific order status
    // For now, we detect fills by checking if previously known orders are no longer open

    // Check stop loss fill
    const stopPrice = plan.stopLoss.price;
    const currentPrice = await client.getPrice(trade.symbol);

    // If price has crossed below stop loss, the stop was likely triggered
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

      // Calculate realized PnL
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

      // Log the fill event
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

      // Check if this TP level has already been filled
      const alreadyFilled = trade.exits.some((exit) => exit.reason === tpLabel);
      if (alreadyFilled) {
        continue;
      }

      // If price has crossed above TP level, it may have been triggered
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

        // Check if all TPs have been filled (100% sold)
        const totalExitPercent = calculateTotalExitPercent(updatedTrade);
        if (totalExitPercent >= 0.99) {
          updatedTrade.status = "CLOSED";
          updatedTrade.closedAt = new Date().toISOString();
        } else {
          updatedTrade.status = "PARTIAL";
        }

        // Calculate realized PnL
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

        // Log the fill event
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

    // f. Update trade record if fills detected
    if (tradeUpdated) {
      updateTrade(trade.id, updatedTrade);
    }
  } catch (error) {
    console.error(`Error checking order fills for ${trade.symbol}:`, error);
  }

  return alerts;
}

// ============================================================================
// PnL Calculations
// ============================================================================

/**
 * Calculate unrealized PnL for an open trade
 */
function calculateUnrealizedPnl(
  trade: Trade,
  currentPrice: number
): { unrealizedPnl: number; unrealizedPnlPercent: number } {
  const avgEntry = trade.averageEntry;
  const remainingQty = calculateRemainingQuantity(trade);

  if (avgEntry === 0 || remainingQty === 0) {
    return { unrealizedPnl: 0, unrealizedPnlPercent: 0 };
  }

  // Unrealized PnL = (current price - average entry) * remaining quantity
  const unrealizedPnl = (currentPrice - avgEntry) * remainingQty;
  const unrealizedPnlPercent = ((currentPrice - avgEntry) / avgEntry) * 100;

  return { unrealizedPnl, unrealizedPnlPercent };
}

/**
 * Calculate realized PnL from closed exits
 */
function calculateRealizedPnl(
  trade: Trade
): { realizedPnl: number; realizedPnlPercent: number } {
  const avgEntry = trade.averageEntry;

  if (avgEntry === 0 || trade.exits.length === 0) {
    return { realizedPnl: 0, realizedPnlPercent: 0 };
  }

  let totalRealizedPnl = 0;
  let totalExitValue = 0;
  let totalExitQty = 0;

  for (const exit of trade.exits) {
    const exitPnl = (exit.price - avgEntry) * exit.quantity;
    totalRealizedPnl += exitPnl;
    totalExitValue += exit.price * exit.quantity;
    totalExitQty += exit.quantity;
  }

  const entryValue = avgEntry * totalExitQty;
  const realizedPnlPercent = entryValue > 0
    ? (totalRealizedPnl / entryValue) * 100
    : 0;

  return { realizedPnl: totalRealizedPnl, realizedPnlPercent };
}

/**
 * Calculate the remaining quantity that hasn't been sold yet
 */
function calculateRemainingQuantity(trade: Trade): number {
  const totalEntryQty = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalExitQty = trade.exits.reduce((sum, e) => sum + e.quantity, 0);
  return totalEntryQty - totalExitQty;
}

/**
 * Calculate total exit percentage
 */
function calculateTotalExitPercent(trade: Trade): number {
  const totalEntryQty = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalExitQty = trade.exits.reduce((sum, e) => sum + e.quantity, 0);
  return totalEntryQty > 0 ? totalExitQty / totalEntryQty : 0;
}

// ============================================================================
// Distance Calculations
// ============================================================================

/**
 * Calculate distance to stop loss as a percentage
 */
function calculateDistanceToStop(currentPrice: number, plan: Plan): number {
  const stopPrice = plan.stopLoss.price;

  if (currentPrice === 0) {
    return 0;
  }

  // Distance = how far price is above stop (for long positions)
  // Positive = safe, Negative = below stop (already triggered)
  return ((currentPrice - stopPrice) / currentPrice) * 100;
}

/**
 * Calculate distance to the next unfilled take profit level
 */
function calculateDistanceToNextTP(
  trade: Trade,
  currentPrice: number,
  plan: Plan
): number {
  if (currentPrice === 0) {
    return 0;
  }

  // Find the next TP that hasn't been filled yet
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
      // Distance = how far price needs to go to reach TP
      // Positive = price is below TP (hasn't reached)
      return ((tpPrice - currentPrice) / currentPrice) * 100;
    }
  }

  // All TPs filled
  return 0;
}

// ============================================================================
// Health Status
// ============================================================================

/**
 * Determine health status based on distance to stop loss
 */
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

/**
 * Check for market anomalies on a symbol
 */
async function checkMarketAnomalies(
  client: BinanceClient,
  symbol: string
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  try {
    // Fetch recent candles for anomaly detection (15-minute timeframe)
    const candles = await client.getCandles(symbol, "15m", VOLUME_AVERAGE_PERIODS + 1);

    if (candles.length < 2) {
      return alerts;
    }

    const currentCandle = candles[candles.length - 1];
    const previousCandles = candles.slice(0, -1);

    if (!currentCandle) {
      return alerts;
    }

    // a. Check for volume spike
    const volumeSpikeAlert = checkVolumeSpike(symbol, currentCandle, previousCandles);
    if (volumeSpikeAlert) {
      alerts.push(volumeSpikeAlert);
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

    // b. Check for flash crash
    const flashCrashAlert = checkFlashCrash(symbol, currentCandle);
    if (flashCrashAlert) {
      alerts.push(flashCrashAlert);
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
    console.error(`Error checking anomalies for ${symbol}:`, error);
  }

  return alerts;
}

/**
 * Check if current volume is a spike (> 3x average)
 */
function checkVolumeSpike(
  symbol: string,
  currentCandle: { volume: number },
  previousCandles: { volume: number }[]
): Alert | null {
  if (previousCandles.length === 0) {
    return null;
  }

  const averageVolume =
    previousCandles.reduce((sum, c) => sum + c.volume, 0) / previousCandles.length;

  if (averageVolume === 0) {
    return null;
  }

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

/**
 * Check if current candle represents a flash crash (> 5% drop)
 */
function checkFlashCrash(
  symbol: string,
  currentCandle: { open: number; close: number; low: number }
): Alert | null {
  if (currentCandle.open === 0) {
    return null;
  }

  // Check if price dropped more than threshold from open to close
  const dropPercent = ((currentCandle.open - currentCandle.close) / currentCandle.open) * 100;

  // Also check the low - if the wick went much lower
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

/**
 * Format a trade status update as a human-readable string
 *
 * @param update - The MonitorUpdate to format
 * @returns A formatted string summarizing the trade status
 */
export function formatTradeStatus(update: MonitorUpdate): string {
  const { trade, currentPrice, unrealizedPnl, unrealizedPnlPercent, distanceToStop, distanceToNextTP, status } = update;

  // Status emoji/indicator
  const statusIndicator = status === "critical" ? "[!!!]" :
                          status === "warning" ? "[!]" :
                          "[OK]";

  // PnL formatting with sign
  const pnlSign = unrealizedPnl >= 0 ? "+" : "";
  const pnlFormatted = `${pnlSign}$${unrealizedPnl.toFixed(2)} (${pnlSign}${unrealizedPnlPercent.toFixed(2)}%)`;

  // Build the status string
  const lines = [
    `${statusIndicator} ${trade.symbol}`,
    `  Status: ${trade.status}`,
    `  Entry: $${trade.averageEntry.toFixed(4)}`,
    `  Current: $${currentPrice.toFixed(4)}`,
    `  Unrealized PnL: ${pnlFormatted}`,
    `  Distance to Stop: ${distanceToStop.toFixed(2)}%`,
    `  Distance to Next TP: ${distanceToNextTP.toFixed(2)}%`,
  ];

  // Add realized PnL if there are any exits
  if (trade.exits.length > 0) {
    const realizedSign = trade.realizedPnl >= 0 ? "+" : "";
    lines.push(`  Realized PnL: ${realizedSign}$${trade.realizedPnl.toFixed(2)} (${realizedSign}${trade.realizedPnlPercent.toFixed(2)}%)`);
  }

  return lines.join("\n");
}

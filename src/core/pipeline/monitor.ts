/**
 * Monitor module for Gordon CLI
 *
 * Tracks open positions and detects events.
 * Fully deterministic (no AI involved).
 *
 * The monitor runs every 15 minutes while the CLI is open.
 * Optionally supports real-time WebSocket updates for faster detection.
 */

import type { Exchange, OrderParams } from "../../infra/exchange/index.ts";
import { ccxtIdToNativeVenue } from "../../infra/exchange/types.ts";
import { listTrades, updateTrade } from "../../infra/storage/entities/trades.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { getPlan } from "../../infra/storage/entities/plans.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import type { Trade, Plan, ExitFill, EntryFill } from "../../types/index.ts";
import {
  BinanceWebSocket,
  type TickerUpdate,
} from "../../infra/venues/exchange/clients/binance/websocket.ts";
import { cleanupExpiredPlans } from "./executor.ts";
import { getTrailingStopTracker } from "../orders/trailing-stop.ts";

const logger = createModuleLogger("monitor");

// Real-time price cache updated by WebSocket
const realtimePriceCache: Map<string, { price: number; timestamp: number }> = new Map();

// WebSocket instance for real-time monitoring
let wsClient: BinanceWebSocket | null = null;

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

export interface TrailingStopUpdate {
  tradeId: string;
  updated: boolean;
  previousStop: number;
  newStop: number;
  highestPrice: number;
  shouldTrigger: boolean;
  currentPrice: number;
}

export interface MonitorResult {
  updates: MonitorUpdate[];
  alerts: Alert[];
  trailingStopUpdates: TrailingStopUpdate[];
  expiredPlansCleanedUp: number;
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
const GRID_TP_MIN_FILL_PERCENT = 0.2; // At least 20% of grid must be filled before placing TPs

// Multi-metric baseline anomaly detection constants
const BASELINE_CALIBRATION_CYCLES = 6; // Need 6 monitor cycles (~90 min at 15min interval) to calibrate
const BASELINE_ANOMALY_MULTIPLIER = 2.0; // Flag when metric exceeds 2x baseline
const BASELINE_MULTI_METRIC_THRESHOLD = 2; // Need 2+ metrics spiking simultaneously

// ============================================================================
// Multi-Metric Baseline Tracker
// ============================================================================

interface BaselineMetrics {
  avgVolume: number;
  avgPriceVelocity: number; // absolute % change per candle
  avgRange: number; // (high - low) / close as percentage
}

interface SymbolBaseline {
  samples: { volume: number; priceVelocity: number; range: number }[];
  calibrated: boolean;
  baseline: BaselineMetrics;
}

/** Rolling baseline per symbol — persists across monitor cycles */
const symbolBaselines: Map<string, SymbolBaseline> = new Map();

function getOrCreateBaseline(symbol: string): SymbolBaseline {
  let sb = symbolBaselines.get(symbol);
  if (!sb) {
    sb = {
      samples: [],
      calibrated: false,
      baseline: { avgVolume: 0, avgPriceVelocity: 0, avgRange: 0 },
    };
    symbolBaselines.set(symbol, sb);
  }
  return sb;
}

function updateBaseline(
  symbol: string,
  currentVolume: number,
  priceVelocity: number,
  range: number
): void {
  const sb = getOrCreateBaseline(symbol);

  sb.samples.push({ volume: currentVolume, priceVelocity, range });

  // Calibrate once we have enough samples
  if (!sb.calibrated && sb.samples.length >= BASELINE_CALIBRATION_CYCLES) {
    const n = sb.samples.length;
    sb.baseline.avgVolume = sb.samples.reduce((s, x) => s + x.volume, 0) / n;
    sb.baseline.avgPriceVelocity = sb.samples.reduce((s, x) => s + x.priceVelocity, 0) / n;
    sb.baseline.avgRange = sb.samples.reduce((s, x) => s + x.range, 0) / n;
    sb.calibrated = true;

    logger.info("Baseline calibrated for symbol", {
      symbol,
      avgVolume: sb.baseline.avgVolume.toFixed(0),
      avgPriceVelocity: sb.baseline.avgPriceVelocity.toFixed(4),
      avgRange: sb.baseline.avgRange.toFixed(4),
      samplesUsed: n,
    });
  }

  // Rolling update after calibration — exponential moving average with alpha=0.1
  if (sb.calibrated) {
    const alpha = 0.1;
    sb.baseline.avgVolume = sb.baseline.avgVolume * (1 - alpha) + currentVolume * alpha;
    sb.baseline.avgPriceVelocity = sb.baseline.avgPriceVelocity * (1 - alpha) + priceVelocity * alpha;
    sb.baseline.avgRange = sb.baseline.avgRange * (1 - alpha) + range * alpha;
  }
}

function checkMultiMetricAnomaly(
  symbol: string,
  currentVolume: number,
  priceVelocity: number,
  range: number
): Alert | null {
  const sb = getOrCreateBaseline(symbol);
  if (!sb.calibrated) return null;

  const b = sb.baseline;
  const spiking: string[] = [];
  const multipliers: Record<string, number> = {};

  // Check each metric against baseline
  if (b.avgVolume > 0) {
    const volMult = currentVolume / b.avgVolume;
    multipliers.volume = volMult;
    if (volMult >= BASELINE_ANOMALY_MULTIPLIER) {
      spiking.push(`volume ${volMult.toFixed(1)}x`);
    }
  }

  if (b.avgPriceVelocity > 0) {
    const velMult = priceVelocity / b.avgPriceVelocity;
    multipliers.priceVelocity = velMult;
    if (velMult >= BASELINE_ANOMALY_MULTIPLIER) {
      spiking.push(`price velocity ${velMult.toFixed(1)}x`);
    }
  }

  if (b.avgRange > 0) {
    const rangeMult = range / b.avgRange;
    multipliers.range = rangeMult;
    if (rangeMult >= BASELINE_ANOMALY_MULTIPLIER) {
      spiking.push(`candle range ${rangeMult.toFixed(1)}x`);
    }
  }

  // Only alert when multiple metrics spike simultaneously
  if (spiking.length >= BASELINE_MULTI_METRIC_THRESHOLD) {
    return {
      type: "volume_spike",
      message: `${symbol}: Multi-metric anomaly — ${spiking.join(", ")} vs baseline`,
      severity: "warning",
      data: {
        symbol,
        spikingMetrics: spiking.length,
        details: spiking.join("; "),
        multipliers,
      },
    };
  }

  return null;
}

// ============================================================================
// Utility Functions (duplicated from executor for independence)
// ============================================================================

/**
 * Round quantity to appropriate precision for exchange orders
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
  client: Exchange
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

  // 3. Process grid take profit placements
  try {
    await processGridTakeProfits(client, alerts);
  } catch (error) {
    logger.error("Grid TP processing error", error as Error);
  }

  // 4. Check for market anomalies
  for (const symbol of symbolsToCheck) {
    try {
      const anomalyAlerts = await checkMarketAnomalies(client, symbol);
      alerts.push(...anomalyAlerts);
    } catch (error) {
      logger.error("Anomaly check error", error as Error, { symbol });
    }
  }

  // 5. Update trailing stops
  const trailingStopUpdates: TrailingStopUpdate[] = [];
  try {
    const tracker = getTrailingStopTracker();
    const tsResults = await tracker.updateAllTrailingStops(client);

    for (const [tradeId, result] of tsResults) {
      trailingStopUpdates.push({
        tradeId,
        updated: result.updated,
        previousStop: result.previousStopPrice,
        newStop: result.newStopPrice,
        highestPrice: result.highestPrice,
        shouldTrigger: result.shouldTrigger,
        currentPrice: result.currentPrice,
      });

      // Execute trailing stop if triggered
      if (result.shouldTrigger) {
        logger.warn("Executing trailing stop", { tradeId });
        const execResult = await tracker.executeTrailingStop(client, tradeId);

        if (execResult.success) {
          alerts.push({
            type: "order_filled",
            tradeId,
            message: `Trailing stop executed for trade ${tradeId}. PnL: $${execResult.pnl?.toFixed(2)}`,
            severity: "warning",
            data: {
              action: "TRAILING_STOP_EXECUTED",
              pnl: execResult.pnl,
            },
          });
        } else {
          alerts.push({
            type: "order_filled",
            tradeId,
            message: `Failed to execute trailing stop: ${execResult.error}`,
            severity: "critical",
            data: {
              action: "TRAILING_STOP_FAILED",
              error: execResult.error,
            },
          });
        }
      }
    }

    if (trailingStopUpdates.length > 0) {
      logger.debug("Trailing stops updated", {
        count: trailingStopUpdates.length,
        triggered: trailingStopUpdates.filter((u) => u.shouldTrigger).length,
      });
    }
  } catch (error) {
    logger.error("Trailing stop update error", error as Error);
  }

  // 6. Cleanup expired plans
  let expiredPlansCleanedUp = 0;
  try {
    expiredPlansCleanedUp = cleanupExpiredPlans();
    if (expiredPlansCleanedUp > 0) {
      logger.info("Expired plans cleaned up", { count: expiredPlansCleanedUp });
    }
  } catch (error) {
    logger.error("Expired plan cleanup error", error as Error);
  }

  logger.debug("Monitor cycle complete", {
    updates: updates.length,
    alerts: alerts.length,
    trailingStopUpdates: trailingStopUpdates.length,
    expiredPlansCleanedUp,
  });

  return {
    updates,
    alerts,
    trailingStopUpdates,
    expiredPlansCleanedUp,
    timestamp,
  };
}

// ============================================================================
// Trade Processing
// ============================================================================

async function processTradeUpdate(
  client: Exchange,
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
  client: Exchange,
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
  client: Exchange,
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
 *
 * Fixed: Now properly tracks successful placements to calculate remaining
 * quantity correctly even if some TP orders fail.
 */
async function placeDeferredTakeProfits(
  client: Exchange,
  trade: Trade,
  plan: Plan,
  totalQuantity: number,
  alerts: Alert[]
): Promise<void> {
  // Track successfully placed quantities to properly calculate remaining
  let placedQuantity = 0;
  const tpResults: { level: number; success: boolean; quantity: number }[] = [];

  // First pass: attempt to place all TP orders
  for (let i = 0; i < plan.takeProfit.length; i++) {
    const tp = plan.takeProfit[i];
    if (!tp) continue;

    const isLastTP = i === plan.takeProfit.length - 1;

    // Calculate quantity for this TP level
    // For the last TP, use whatever quantity remains after previous successful placements
    const tpQuantity = isLastTP
      ? roundQuantity(totalQuantity - placedQuantity)
      : roundQuantity(totalQuantity * tp.percentToSell);

    if (tpQuantity <= 0) {
      tpResults.push({ level: i + 1, success: false, quantity: 0 });
      continue;
    }

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

      // Only increment placedQuantity on successful placement
      placedQuantity += tpQuantity;
      tpResults.push({ level: i + 1, success: true, quantity: tpQuantity });

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

      // Don't increment placedQuantity on failure - the quantity is still available
      tpResults.push({ level: i + 1, success: false, quantity: 0 });

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

  // Log summary of TP placement
  const successCount = tpResults.filter(r => r.success).length;
  const failCount = tpResults.filter(r => !r.success && r.quantity === 0).length;

  if (failCount > 0) {
    logger.warn("Some deferred TPs failed to place", {
      tradeId: trade.id,
      successCount,
      failCount,
      placedQuantity,
      totalQuantity,
      unplacedQuantity: totalQuantity - placedQuantity,
    });
  }
}

// ============================================================================
// Grid Take Profit Placement
// ============================================================================

/**
 * Result of grid TP placement operation
 */
export interface GridTPPlacementResult {
  success: boolean;
  placedCount: number;
  failedCount: number;
  skippedReason?: string;
  alerts: Alert[];
}

/**
 * Information about which grid levels have been filled
 */
interface GridLevelStatus {
  levelIndex: number;
  price: number;
  isFilled: boolean;
  fillQuantity: number;
  fillTime?: string;
}

/**
 * Place Grid Take Profit orders for a trade
 *
 * This function handles the placement of take profit orders for grid entry trades.
 * It is designed to be called during the monitor cycle and handles:
 * - Detecting grid trades without TP orders
 * - Calculating TP price based on grid configuration and average entry
 * - Placing limit sell orders at each TP level
 * - Tracking which grid levels have been filled
 * - Handling partial fills of grid entries
 *
 * @param trade - The trade to place TPs for
 * @param binance - Authenticated Binance client
 * @returns GridTPPlacementResult with status and any alerts generated
 */
export async function placeGridTakeProfits(
  trade: Trade,
  binance: Exchange
): Promise<GridTPPlacementResult> {
  const alerts: Alert[] = [];

  // Get the plan for this trade
  const plan = getPlan(trade.planId);
  if (!plan) {
    logger.warn("Cannot place grid TPs - plan not found", { tradeId: trade.id, planId: trade.planId });
    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: "Plan not found",
      alerts,
    };
  }

  // Verify this is a grid entry trade
  if (plan.strategy !== "grid_entry" || !plan.grid) {
    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: "Not a grid entry trade",
      alerts,
    };
  }

  // Skip if trade is already closed
  if (trade.status === "CLOSED") {
    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: "Trade is closed",
      alerts,
    };
  }

  // Check if any grid entries have filled
  if (trade.entries.length === 0) {
    logger.debug("No grid entries filled yet", { tradeId: trade.id });
    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: "No grid entries filled yet",
      alerts,
    };
  }

  try {
    // Get current price and open orders
    const currentPrice = await binance.getPrice(trade.symbol);
    const openOrders = await binance.getOpenOrders(trade.symbol);

    // Check if TP orders already exist
    const existingTpOrders = openOrders.filter(o =>
      o.side === "SELL" && o.type === "LIMIT"
    );

    if (existingTpOrders.length > 0) {
      logger.debug("Grid TPs already placed", {
        tradeId: trade.id,
        existingTpCount: existingTpOrders.length
      });
      return {
        success: true,
        placedCount: 0,
        failedCount: 0,
        skippedReason: "TP orders already exist",
        alerts,
      };
    }

    // Check if any exits have already occurred (partial TP fills)
    if (trade.exits.length > 0) {
      const tpExits = trade.exits.filter(e => e.reason.startsWith("TP"));
      if (tpExits.length > 0) {
        logger.debug("Trade already has TP exits", {
          tradeId: trade.id,
          tpExitCount: tpExits.length
        });
        return {
          success: true,
          placedCount: 0,
          failedCount: 0,
          skippedReason: "TPs already partially filled",
          alerts,
        };
      }
    }

    // Analyze grid fill status
    const gridLevels = plan.grid.levels;
    const filledLevelPrices = new Set(trade.entries.map(e => e.price));
    const gridLevelStatus: GridLevelStatus[] = gridLevels.map((level, index) => {
      const matchingEntry = trade.entries.find(e => e.price === level.price);
      return {
        levelIndex: index + 1,
        price: level.price,
        isFilled: filledLevelPrices.has(level.price),
        fillQuantity: matchingEntry?.quantity ?? 0,
        fillTime: matchingEntry?.filledAt,
      };
    });

    const filledLevels = gridLevelStatus.filter(l => l.isFilled);
    const totalLevels = gridLevels.length;
    const fillPercent = filledLevels.length / totalLevels;

    logger.debug("Grid fill status", {
      tradeId: trade.id,
      filledLevels: filledLevels.length,
      totalLevels,
      fillPercent: (fillPercent * 100).toFixed(1) + "%",
    });

    // Determine if we should place TPs
    const allLevelsFilled = filledLevels.length >= totalLevels;

    // Find the highest filled level price for reversal detection
    const highestFilledPrice = Math.max(...trade.entries.map(e => e.price));
    const reversalThreshold = highestFilledPrice * (1 + GRID_REVERSAL_THRESHOLD);
    const priceReversed = currentPrice >= reversalThreshold;

    // Check minimum fill threshold (at least 20% of grid should be filled)
    const minFillThresholdMet = fillPercent >= GRID_TP_MIN_FILL_PERCENT;

    // Determine if conditions are met for TP placement
    const shouldPlaceTPs = allLevelsFilled || (priceReversed && minFillThresholdMet);

    if (!shouldPlaceTPs) {
      const reason = !minFillThresholdMet
        ? `Insufficient fills (${(fillPercent * 100).toFixed(0)}% < ${GRID_TP_MIN_FILL_PERCENT * 100}% required)`
        : `Waiting for all levels or price reversal (current: ${currentPrice.toFixed(4)}, reversal at: ${reversalThreshold.toFixed(4)})`;

      logger.debug("Conditions not met for grid TP placement", {
        tradeId: trade.id,
        allLevelsFilled,
        priceReversed,
        minFillThresholdMet,
        currentPrice,
        reversalThreshold,
      });

      return {
        success: false,
        placedCount: 0,
        failedCount: 0,
        skippedReason: reason,
        alerts,
      };
    }

    // Calculate total quantity from filled entries
    const totalQuantity = trade.entries.reduce((sum, e) => sum + e.quantity, 0);

    if (totalQuantity <= 0) {
      return {
        success: false,
        placedCount: 0,
        failedCount: 0,
        skippedReason: "No quantity to place TPs for",
        alerts,
      };
    }

    logger.info("Placing grid take profit orders", {
      tradeId: trade.id,
      symbol: trade.symbol,
      reason: allLevelsFilled ? "all_levels_filled" : "price_reversal",
      filledLevels: filledLevels.length,
      totalLevels,
      totalQuantity,
      averageEntry: trade.averageEntry,
      currentPrice,
    });

    // Place TP orders
    let placedCount = 0;
    let failedCount = 0;
    let remainingQuantity = totalQuantity;

    for (let i = 0; i < plan.takeProfit.length; i++) {
      const tp = plan.takeProfit[i];
      if (!tp) continue;

      const isLastTP = i === plan.takeProfit.length - 1;

      // Calculate quantity for this TP level
      // For the last TP, use whatever quantity remains
      const tpQuantity = isLastTP
        ? roundQuantity(remainingQuantity)
        : roundQuantity(totalQuantity * tp.percentToSell);

      if (tpQuantity <= 0) {
        logger.debug("Skipping TP level - no quantity", { level: i + 1 });
        continue;
      }

      remainingQuantity = roundQuantity(remainingQuantity - tpQuantity);

      const tpOrderParams: OrderParams = {
        symbol: trade.symbol,
        side: "SELL",
        type: "LIMIT",
        quantity: tpQuantity,
        price: roundPrice(tp.price),
        timeInForce: "GTC",
        newClientOrderId: generateClientOrderId(trade.planId, `grid_tp${i + 1}`),
      };

      try {
        const tpOrder = await binance.placeOrder(tpOrderParams);
        placedCount++;

        logger.info("Grid TP order placed", {
          tradeId: trade.id,
          level: i + 1,
          orderId: tpOrder.orderId,
          price: tp.price,
          quantity: tpQuantity,
          percentToSell: tp.percentToSell * 100,
        });

        logEvent({
          type: "ORDER_PLACED",
          data: {
            action: `GRID_TP_${i + 1}`,
            orderId: tpOrder.orderId.toString(),
            symbol: trade.symbol,
            side: "SELL",
            type: "LIMIT",
            price: tp.price,
            quantity: tpQuantity,
            gridLevelsFilled: filledLevels.length,
            totalGridLevels: totalLevels,
            placementReason: allLevelsFilled ? "all_levels_filled" : "price_reversal",
          },
          tradeId: trade.id,
          planId: trade.planId,
        });

        alerts.push({
          type: "order_filled",
          tradeId: trade.id,
          message: `${trade.symbol}: Grid TP${i + 1} order placed at ${tp.price}`,
          severity: "info",
          data: {
            orderType: `GRID_TP_${i + 1}`,
            price: tp.price,
            quantity: tpQuantity,
            orderId: tpOrder.orderId.toString(),
          },
        });

      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        logger.error("Failed to place grid TP order", error as Error, {
          tradeId: trade.id,
          level: i + 1,
          params: tpOrderParams,
        });

        logEvent({
          type: "ERROR",
          data: {
            action: "GRID_TP_FAILED",
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
          message: `${trade.symbol}: Failed to place grid TP${i + 1}: ${errorMessage}`,
          severity: "warning",
          data: {
            orderType: `GRID_TP_${i + 1}`,
            error: errorMessage,
          },
        });
      }
    }

    // Log summary
    const success = placedCount > 0 && failedCount === 0;

    if (placedCount > 0) {
      logger.info("Grid TP placement complete", {
        tradeId: trade.id,
        symbol: trade.symbol,
        placedCount,
        failedCount,
        success,
      });

      alerts.push({
        type: "order_filled",
        tradeId: trade.id,
        message: `${trade.symbol}: Grid TPs placed (${placedCount}/${plan.takeProfit.length}) - ${allLevelsFilled ? "all levels filled" : "price reversal detected"}`,
        severity: "info",
        data: {
          placedCount,
          failedCount,
          reason: allLevelsFilled ? "all_levels_filled" : "price_reversal",
          filledGridLevels: filledLevels.length,
          totalGridLevels: totalLevels,
        },
      });
    }

    return {
      success,
      placedCount,
      failedCount,
      alerts,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    logger.error("Error in placeGridTakeProfits", error as Error, {
      tradeId: trade.id,
      symbol: trade.symbol,
    });

    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: `Error: ${errorMessage}`,
      alerts,
    };
  }
}

/**
 * Process all grid trades and place TPs where needed
 * Called from runMonitorCycle
 */
async function processGridTakeProfits(
  client: Exchange,
  alerts: Alert[]
): Promise<void> {
  // Get all active trades
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const allActiveTrades = [...openTrades, ...partialTrades];

  // Filter to grid trades only
  const gridTrades: Trade[] = [];
  for (const trade of allActiveTrades) {
    const plan = getPlan(trade.planId);
    if (plan?.strategy === "grid_entry" && plan.grid) {
      gridTrades.push(trade);
    }
  }

  if (gridTrades.length === 0) {
    return;
  }

  logger.debug("Processing grid TPs", { gridTradeCount: gridTrades.length });

  for (const trade of gridTrades) {
    try {
      const result = await placeGridTakeProfits(trade, client);

      // Add any alerts from the placement
      alerts.push(...result.alerts);

      if (result.placedCount > 0) {
        logger.info("Grid TPs placed for trade", {
          tradeId: trade.id,
          placedCount: result.placedCount,
        });
      } else if (result.skippedReason) {
        logger.debug("Grid TP placement skipped", {
          tradeId: trade.id,
          reason: result.skippedReason,
        });
      }
    } catch (error) {
      logger.error("Error processing grid TPs for trade", error as Error, {
        tradeId: trade.id,
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
  client: Exchange,
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

    // Multi-metric baseline anomaly detection
    const priceVelocity = currentCandle.open > 0
      ? Math.abs(currentCandle.close - currentCandle.open) / currentCandle.open
      : 0;
    const candleRange = currentCandle.close > 0
      ? (currentCandle.high - currentCandle.low) / currentCandle.close
      : 0;

    // Feed current metrics into the baseline tracker
    updateBaseline(symbol, currentCandle.volume, priceVelocity, candleRange);

    // Check for multi-metric anomaly (only fires after baseline is calibrated)
    const multiMetricAlert = checkMultiMetricAnomaly(
      symbol, currentCandle.volume, priceVelocity, candleRange
    );
    if (multiMetricAlert) {
      alerts.push(multiMetricAlert);
      logger.warn("Multi-metric anomaly detected", {
        symbol,
        details: multiMetricAlert.data.details,
      });
      logEvent({
        type: "ALERT",
        data: {
          alertType: "multi_metric_anomaly",
          symbol,
          ...multiMetricAlert.data,
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
// Real-Time WebSocket Integration
// ============================================================================

/**
 * Initialize WebSocket for real-time price monitoring
 * This enables faster detection of stop-loss and take-profit triggers
 * Only connects if there are active trades to monitor
 */
export async function initializeRealtimeMonitor(exchangeId: string = "binance"): Promise<void> {
  if (ccxtIdToNativeVenue(exchangeId) !== "binance") {
    logger.debug("Real-time monitor skipped for non-Binance exchange", { exchangeId });
    return;
  }
  if (wsClient) {
    logger.debug("WebSocket already initialized");
    return;
  }

  // Check if there are any trades to monitor BEFORE connecting
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const symbols = new Set([...openTrades, ...partialTrades].map((t) => t.symbol));

  if (symbols.size === 0) {
    logger.debug("No active trades to monitor - skipping WebSocket initialization");
    return;
  }

  wsClient = new BinanceWebSocket();

  wsClient.on("ticker", (update: TickerUpdate) => {
    // Update real-time price cache
    realtimePriceCache.set(update.symbol, {
      price: update.price,
      timestamp: update.timestamp,
    });

    // Check for critical price movements on open trades
    checkRealtimePriceAlert(update.symbol, update.price);
  });

  wsClient.on("connected", () => {
    logger.info("WebSocket connected for real-time monitoring");
  });

  wsClient.on("disconnected", (reason) => {
    logger.warn("WebSocket disconnected", { reason });
  });

  wsClient.on("error", (error) => {
    logger.error("WebSocket error", error);
  });

  // Pre-register subscriptions before connecting
  for (const symbol of symbols) {
    wsClient.subscribeTicker(symbol);
  }

  try {
    await wsClient.connect();
    logger.debug("Subscribed to real-time tickers", { symbols: Array.from(symbols) });
  } catch (error) {
    logger.error("Failed to initialize WebSocket", error instanceof Error ? error : undefined);
    wsClient = null;
  }
}

/**
 * Add a symbol to real-time monitoring (call when opening a new trade)
 */
export function subscribeSymbolRealtime(symbol: string): void {
  if (wsClient?.isConnected()) {
    wsClient.subscribeTicker(symbol);
    logger.debug("Added real-time subscription", { symbol });
  }
}

/**
 * Remove a symbol from real-time monitoring (call when closing a trade)
 */
export function unsubscribeSymbolRealtime(symbol: string): void {
  if (wsClient?.isConnected()) {
    // Only unsubscribe if no other trades use this symbol
    const openTrades = listTrades({ status: "OPEN" });
    const partialTrades = listTrades({ status: "PARTIAL" });
    const stillUsed = [...openTrades, ...partialTrades].some((t) => t.symbol === symbol);

    if (!stillUsed) {
      wsClient.unsubscribe("ticker", symbol);
      realtimePriceCache.delete(symbol);
      logger.debug("Removed real-time subscription", { symbol });
    }
  }
}

/**
 * Shutdown WebSocket connection
 */
export function shutdownRealtimeMonitor(): void {
  if (wsClient) {
    wsClient.disconnect();
    wsClient = null;
    realtimePriceCache.clear();
    logger.info("Real-time monitor shutdown");
  }
}

/**
 * Check if a price update triggers critical alerts
 * This runs on every WebSocket price update for subscribed symbols
 */
function checkRealtimePriceAlert(symbol: string, price: number): void {
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const tradesForSymbol = [...openTrades, ...partialTrades].filter((t) => t.symbol === symbol);

  for (const trade of tradesForSymbol) {
    const plan = getPlan(trade.planId);
    if (!plan) continue;

    const stopPrice = plan.stopLoss.price;
    const distanceToStop = ((price - stopPrice) / price) * 100;

    // Emit critical alert if price is within 1% of stop
    if (distanceToStop <= CRITICAL_THRESHOLD_PERCENT && distanceToStop > 0) {
      emitEvent("alert:stop_approaching", {
        tradeId: trade.id,
        symbol,
        currentPrice: price,
        stopPrice,
        distance: distanceToStop,
        realtime: true,
      });

      logger.warn("CRITICAL: Price near stop loss (real-time)", {
        tradeId: trade.id,
        symbol,
        price,
        stopPrice,
        distance: distanceToStop.toFixed(2),
      });
    }

    // Check if stop-loss was breached
    if (price <= stopPrice) {
      emitEvent("alert:stop_triggered", {
        tradeId: trade.id,
        symbol,
        currentPrice: price,
        stopPrice,
        realtime: true,
      });

      logger.error("STOP LOSS BREACHED (real-time)", {
        tradeId: trade.id,
        symbol,
        price,
        stopPrice,
      });
    }
  }
}

/**
 * Get cached real-time price (faster than API call)
 * Falls back to API if no cached price available
 */
export async function getRealtimePrice(
  client: Exchange,
  symbol: string
): Promise<number> {
  const cached = realtimePriceCache.get(symbol);

  // Use cache if fresh (within 5 seconds)
  if (cached && Date.now() - cached.timestamp < 5000) {
    return cached.price;
  }

  // Fallback to REST API
  return client.getPrice(symbol);
}

/**
 * Check if real-time monitoring is active
 */
export function isRealtimeMonitorActive(): boolean {
  return wsClient?.isConnected() ?? false;
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

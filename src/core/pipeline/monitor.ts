/**
 * Monitor module for Gordon CLI
 *
 * Tracks open positions and detects events.
 * Fully deterministic (no AI involved).
 *
 * The monitor runs every 15 minutes while the CLI is open.
 * Optionally supports real-time WebSocket updates for faster detection.
 */

import type { Exchange, Order } from "../../infra/exchange/index.ts";

import { getTrade, listTrades, updateTrade } from "../../infra/storage/entities/trades.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { getPlan, updatePlan } from "../../infra/storage/entities/plans.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import type { Trade, Plan, ExitFill, EntryFill } from "../../types/index.ts";
import type {
  MarketStream,
  MarketStreamTickerUpdate as TickerUpdate,
} from "../../infra/exchange/marketStream.ts";
import {
  cleanupExpiredPlans,
  cancelPlanProtectiveOrders,
  closePartialPosition,
  generateDeterministicClientOrderId,
  repairProtectiveOrders,
} from "./executor.ts";
import { getTrailingStopTracker } from "../orders/trailing-stop.ts";
import { exchangePortfolioIdentity } from "../../infra/safety/portfolioIdentity.ts";
import { recordTradeClosureDebrief } from "../../infra/trading/ops/debriefMatrix.ts";

const logger = createModuleLogger("monitor");

// Real-time price cache updated by WebSocket
const realtimePriceCache: Map<string, { price: number; timestamp: number }> = new Map();

// WebSocket instance for real-time monitoring
let wsClient: MarketStream | null = null;
let monitorHandlersWired = false;

export function setMonitorMarketStream(stream: MarketStream | null): void {
  wsClient = stream;
}

export function getMonitorMarketStream(): MarketStream | null {
  return wsClient;
}

export function wireMonitorTickerHandlers(stream: MarketStream): void {
  if (monitorHandlersWired) return;
  monitorHandlersWired = true;

  stream.on("ticker", (update: TickerUpdate) => {
    realtimePriceCache.set(update.symbol, {
      price: update.price,
      timestamp: update.timestamp,
    });
    checkRealtimePriceAlert(update.symbol, update.price);
  });

  stream.on("connected", () => {
    logger.info("Market stream connected for real-time monitoring");
  });

  stream.on("disconnected", (reason) => {
    logger.warn("Market stream disconnected", { reason });
  });

  stream.on("error", (error) => {
    logger.error("Market stream error", error);
  });
}

export async function subscribeMonitorTradeSymbols(): Promise<void> {
  if (!wsClient) return;
  const openTrades = listTrades({ status: "OPEN" });
  const partialTrades = listTrades({ status: "PARTIAL" });
  const symbols = new Set([...openTrades, ...partialTrades].map((t) => t.symbol));
  for (const symbol of symbols) {
    wsClient.subscribeTicker(symbol);
  }
}

// ============================================================================
// Types
// ============================================================================

export interface MonitorUpdate {
  trade: Trade;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  distanceToStop: number; // percentage
  distanceToNextTP: number; // percentage
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
  range: number,
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
    sb.baseline.avgPriceVelocity =
      sb.baseline.avgPriceVelocity * (1 - alpha) + priceVelocity * alpha;
    sb.baseline.avgRange = sb.baseline.avgRange * (1 - alpha) + range * alpha;
  }
}

function checkMultiMetricAnomaly(
  symbol: string,
  currentVolume: number,
  priceVelocity: number,
  range: number,
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
  const multiplier = 10 ** precision;
  return Math.floor(quantity * multiplier) / multiplier;
}

/**
 * Round price to appropriate precision
 */
function roundPrice(price: number, precision: number = 8): number {
  const multiplier = 10 ** precision;
  return Math.round(price * multiplier) / multiplier;
}

// ============================================================================
// Main Monitor Function
// ============================================================================

/**
 * Run a complete monitor cycle
 */
export async function runMonitorCycle(client: Exchange): Promise<MonitorResult> {
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

  // 4. Update trailing stops
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

  // 5. Cleanup expired plans
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
  alerts: Alert[],
): Promise<MonitorUpdate | null> {
  const plan = getPlan(trade.planId);
  if (!plan) {
    logger.error("Plan not found for trade", undefined, {
      tradeId: trade.id,
      planId: trade.planId,
    });
    return null;
  }

  const currentPrice = await client.getPrice(trade.symbol);

  const fillAlerts = await checkOrderFills(client, trade, plan);
  alerts.push(...fillAlerts);
  const reconciledTrade = getTrade(trade.id) ?? trade;

  const { unrealizedPnl, unrealizedPnlPercent } = calculateUnrealizedPnl(
    reconciledTrade,
    currentPrice,
    plan,
  );

  const distanceToStop = calculateDistanceToStop(currentPrice, plan);
  const distanceToNextTP = calculateDistanceToNextTP(reconciledTrade, currentPrice, plan);
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
    trade: reconciledTrade,
    currentPrice,
    unrealizedPnl,
    unrealizedPnlPercent,
    distanceToStop,
    distanceToNextTP,
    status,
  };
}

function protectiveReasonForOrder(order: Order, plan: Plan): ExitFill["reason"] | null {
  const id = order.clientOrderId ?? "";
  if (id.includes("_stop")) return "STOP";
  for (let i = 0; i < plan.takeProfit.length; i++) {
    if (id.includes(`_tp${i + 1}`) || (i === 0 && id.includes("_oco_tp"))) {
      return `TP${i + 1}` as ExitFill["reason"];
    }
  }
  return null;
}

function mergeOrders(history: Order[], openOrders: Order[]): Order[] {
  const byId = new Map<string, Order>();
  for (const order of [...history, ...openOrders]) {
    byId.set(order.orderId.toString(), order);
  }
  return [...byId.values()].sort(
    (a, b) => (a.updateTime ?? a.time ?? 0) - (b.updateTime ?? b.time ?? 0),
  );
}

async function loadPlanOrders(client: Exchange, symbol: string, planId: string): Promise<Order[]> {
  const prefix = `gordon_${planId.slice(4, 12)}_`;
  const [history, openOrders] = await Promise.all([
    client.getOrderHistory(symbol, 200),
    client.getOpenOrders(symbol),
  ]);
  return mergeOrders(history, openOrders).filter((order) =>
    order.clientOrderId?.startsWith(prefix),
  );
}

async function applyConfirmedProtectiveFills(
  client: Exchange,
  trade: Trade,
  plan: Plan,
  orders: Order[],
  alerts: Alert[],
): Promise<Trade> {
  const updatedTrade: Trade = { ...trade, exits: [...trade.exits] };
  let changed = false;

  for (const order of orders) {
    const reason = protectiveReasonForOrder(order, plan);
    if (!reason || order.executedQty <= 0) continue;
    if (order.status !== "FILLED" && order.status !== "PARTIALLY_FILLED") continue;

    const priorForOrder = updatedTrade.exits.filter(
      (exit) => exit.orderId === order.orderId.toString(),
    );
    const priorQuantity = priorForOrder.reduce((sum, exit) => sum + exit.quantity, 0);
    const deltaQuantity = roundQuantity(order.executedQty - priorQuantity);
    if (deltaQuantity <= 0) continue;

    const priorQuote = priorForOrder.reduce((sum, exit) => sum + exit.price * exit.quantity, 0);
    const deltaQuote = order.cummulativeQuoteQty - priorQuote;
    const fallbackPrice =
      reason === "STOP"
        ? plan.stopLoss.price
        : (plan.takeProfit[Number(reason.slice(2)) - 1]?.price ?? order.price);
    const fillPrice =
      deltaQuote > 0
        ? deltaQuote / deltaQuantity
        : order.executedQty > 0 && order.cummulativeQuoteQty > 0
          ? order.cummulativeQuoteQty / order.executedQty
          : fallbackPrice;
    const remainingBefore = calculateRemainingQuantity(updatedTrade);

    updatedTrade.exits.push({
      orderId: order.orderId.toString(),
      price: fillPrice,
      quantity: deltaQuantity,
      filledAt: order.updateTime
        ? new Date(order.updateTime).toISOString()
        : new Date().toISOString(),
      reason,
    });
    changed = true;

    if (deltaQuantity > remainingBefore + 1e-8) {
      alerts.push({
        type: "order_filled",
        tradeId: trade.id,
        message: `${trade.symbol}: protective orders overfilled the position by ${roundQuantity(deltaQuantity - remainingBefore)}`,
        severity: "critical",
        data: {
          orderType: reason,
          orderId: order.orderId.toString(),
          executedQuantity: deltaQuantity,
          remainingBefore,
        },
      });
    }

    alerts.push({
      type: "order_filled",
      tradeId: trade.id,
      message: `${trade.symbol}: exchange confirmed ${reason} fill at ${fillPrice}`,
      severity: reason === "STOP" ? "critical" : "info",
      data: {
        orderType: reason,
        orderId: order.orderId.toString(),
        fillPrice,
        quantity: deltaQuantity,
        status: order.status,
      },
    });

    if (reason.startsWith("TP")) {
      await emitEvent("alert:tp_hit", {
        tradeId: trade.id,
        symbol: trade.symbol,
        level: Number(reason.slice(2)) as 1 | 2 | 3,
        price: fillPrice,
      });
    }

    logEvent({
      type: "ORDER_FILLED",
      data: {
        orderType: reason,
        orderId: order.orderId.toString(),
        fillPrice,
        quantity: deltaQuantity,
        exchangeConfirmed: true,
      },
      tradeId: trade.id,
      planId: trade.planId,
    });
  }

  if (!changed) return trade;

  const remaining = calculateRemainingQuantity(updatedTrade);
  updatedTrade.status = remaining <= 1e-8 ? "CLOSED" : "PARTIAL";
  updatedTrade.closedAt = remaining <= 1e-8 ? new Date().toISOString() : null;
  const { realizedPnl, realizedPnlPercent } = calculateRealizedPnl(updatedTrade, plan);
  updatedTrade.realizedPnl = realizedPnl;
  updatedTrade.realizedPnlPercent = realizedPnlPercent;
  updateTrade(trade.id, updatedTrade);
  if (remaining <= 1e-8) {
    recordTradeClosureDebrief({
      tradeId: trade.id,
      symbol: trade.symbol,
      pnlUsd: realizedPnl,
      pnlPercent: realizedPnlPercent,
      reason: updatedTrade.exits.at(-1)?.reason ?? "MANUAL",
      portfolioIdentity: exchangePortfolioIdentity(client),
    });
  }

  const cancelled = await cancelPlanProtectiveOrders(client, trade.symbol, trade.planId);
  if (!cancelled.success) {
    alerts.push({
      type: "order_filled",
      tradeId: trade.id,
      message: `${trade.symbol}: fill confirmed, but sibling protection could not be fully cancelled`,
      severity: "critical",
      data: { failures: cancelled.failures },
    });
    return updatedTrade;
  }

  if (remaining <= 1e-8) {
    updatePlan(trade.planId, { status: "CLOSED" });
  } else {
    const repair = await repairProtectiveOrders(trade.planId, client);
    if (!repair.repaired && repair.reason !== "protective_orders_intact") {
      alerts.push({
        type: "order_filled",
        tradeId: trade.id,
        message: `${trade.symbol}: partial exit confirmed, but remaining protection was not restored`,
        severity: "critical",
        data: { reason: repair.reason },
      });
    }
  }

  return updatedTrade;
}

async function maybeExecuteManagedTakeProfit(
  client: Exchange,
  trade: Trade,
  plan: Plan,
  orders: Order[],
  currentPrice: number,
  alerts: Alert[],
): Promise<void> {
  if (trade.status === "CLOSED" || calculateRemainingQuantity(trade) <= 0) return;

  // A native OCO TP remains venue-managed. Managed exits are only for plans
  // with no active TP order, which prevents two independent exit mechanisms
  // from racing one another.
  const hasActiveVenueTp = orders.some(
    (order) =>
      (order.status === "NEW" || order.status === "PARTIALLY_FILLED") &&
      protectiveReasonForOrder(order, plan)?.startsWith("TP"),
  );
  if (hasActiveVenueTp) return;

  const enteredQuantity = trade.entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const remainingQuantity = calculateRemainingQuantity(trade);
  const pending = plan.takeProfit
    .map((tp, index) => {
      const reason = `TP${index + 1}` as ExitFill["reason"];
      const alreadyFilled = trade.exits
        .filter((exit) => exit.reason === reason)
        .reduce((sum, exit) => sum + exit.quantity, 0);
      return {
        tp,
        reason,
        remainingTarget: tp ? Math.max(0, enteredQuantity * tp.percentToSell - alreadyFilled) : 0,
      };
    })
    .filter(({ tp, remainingTarget }) => Boolean(tp) && remainingTarget > 1e-8);

  for (const level of pending) {
    const tp = level.tp!;
    const crossed =
      plan.direction === "short" ? currentPrice <= tp.price : currentPrice >= tp.price;
    if (!crossed) continue;

    const percentageOfRemainder = Math.min(1, level.remainingTarget / remainingQuantity);
    const result = await closePartialPosition(
      client,
      trade.id,
      percentageOfRemainder,
      level.reason === "TP1" || level.reason === "TP2" || level.reason === "TP3"
        ? level.reason
        : "MANUAL",
    );
    alerts.push({
      type: "order_filled",
      tradeId: trade.id,
      message: result.success
        ? result.protectionRestored === false
          ? `${trade.symbol}: managed ${level.reason} filled, but protection was not restored`
          : `${trade.symbol}: managed ${level.reason} executed at ${result.exitPrice}`
        : `${trade.symbol}: managed ${level.reason} could not be confirmed`,
      severity:
        !result.success || result.protectionRestored === false
          ? "critical"
          : result.fullyFilled === false
            ? "warning"
            : "info",
      data: result.success
        ? {
            orderType: level.reason,
            fillPrice: result.exitPrice,
            quantity: result.closedQuantity,
            exchangeConfirmed: true,
            fullyFilled: result.fullyFilled,
            protectionRestored: result.protectionRestored,
            warning: result.error,
          }
        : { orderType: level.reason, error: result.error },
    });
    // One exit per cycle. The trade and protection are reloaded on the next
    // cycle, avoiding decisions based on a stale pre-fill position snapshot.
    return;
  }
}

async function checkOrderFills(client: Exchange, trade: Trade, plan: Plan): Promise<Alert[]> {
  const alerts: Alert[] = [];
  if (plan.strategy === "grid_entry" && plan.grid) {
    return await checkGridFills(client, trade, plan, alerts);
  }

  try {
    const orders = await loadPlanOrders(client, trade.symbol, trade.planId);
    const reconciled = await applyConfirmedProtectiveFills(client, trade, plan, orders, alerts);
    const currentPrice = await client.getPrice(trade.symbol);
    await maybeExecuteManagedTakeProfit(client, reconciled, plan, orders, currentPrice, alerts);
  } catch (error) {
    // Exchange truth is mandatory. A price crossing is an alert condition, not
    // evidence that a resting order executed.
    logger.error("Error reconciling order fills", error as Error, { symbol: trade.symbol });
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
  alerts: Alert[],
): Promise<Alert[]> {
  if (!plan.grid) {
    return alerts;
  }

  try {
    const currentPrice = await client.getPrice(trade.symbol);
    const openOrders = await client.getOpenOrders(trade.symbol);
    let tradeUpdated = false;
    const updatedTrade = { ...trade };

    const gridLevels = plan.grid.levels;

    const orderHistory = await client.getOrderHistory(trade.symbol, 200);

    const ordersByClientId = new Map<string, (typeof orderHistory)[number]>();
    for (const order of [...orderHistory, ...openOrders]) {
      if (order.clientOrderId) {
        ordersByClientId.set(order.clientOrderId, order);
      }
    }

    for (let i = 0; i < gridLevels.length; i++) {
      const level = gridLevels[i]!;
      const levelLabel = `GRID_${i + 1}`;
      const clientOrderId = generateDeterministicClientOrderId(trade.planId, `grid${i + 1}`);
      const exchangeOrder = ordersByClientId.get(clientOrderId);

      if (!exchangeOrder) {
        continue;
      }

      const orderId = exchangeOrder.orderId.toString();
      const isFilled =
        exchangeOrder.status === "FILLED" || exchangeOrder.status === "PARTIALLY_FILLED";
      if (!isFilled || exchangeOrder.executedQty <= 0) {
        continue;
      }

      const priorForOrder = updatedTrade.entries.filter((entry) => entry.orderId === orderId);
      const priorQuantity = priorForOrder.reduce((sum, entry) => sum + entry.quantity, 0);
      const levelQuantity = roundQuantity(exchangeOrder.executedQty - priorQuantity);
      if (levelQuantity <= 0) continue;
      const priorQuote = priorForOrder.reduce(
        (sum, entry) => sum + entry.price * entry.quantity,
        0,
      );
      const deltaQuote = exchangeOrder.cummulativeQuoteQty - priorQuote;
      const fillPrice =
        deltaQuote > 0
          ? deltaQuote / levelQuantity
          : exchangeOrder.cummulativeQuoteQty > 0
            ? exchangeOrder.cummulativeQuoteQty / exchangeOrder.executedQty
            : level.price;

      const gridFill: EntryFill = {
        orderId,
        price: fillPrice,
        quantity: levelQuantity,
        filledAt: exchangeOrder.updateTime
          ? new Date(exchangeOrder.updateTime).toISOString()
          : new Date().toISOString(),
      };

      updatedTrade.entries = [...updatedTrade.entries, gridFill];
      tradeUpdated = true;

      const newAvgEntry = calculateWeightedAverageEntry(updatedTrade.entries);
      updatedTrade.averageEntry = newAvgEntry;

      alerts.push({
        type: "order_filled",
        tradeId: trade.id,
        message: `${trade.symbol}: Grid level ${i + 1} filled at ${fillPrice}`,
        severity: "info",
        data: {
          orderType: levelLabel,
          fillPrice,
          quantity: levelQuantity,
          newAverageEntry: newAvgEntry,
          gridLevelsFilled: updatedTrade.entries.length,
          totalGridLevels: gridLevels.length,
          clientOrderId,
        },
      });

      logger.info("Grid level filled (exchange-confirmed)", {
        tradeId: trade.id,
        symbol: trade.symbol,
        level: i + 1,
        orderId,
        price: fillPrice,
        quantity: levelQuantity,
        newAvgEntry,
        status: exchangeOrder.status,
      });

      logEvent({
        type: "ORDER_FILLED",
        data: {
          orderType: levelLabel,
          fillPrice,
          quantity: levelQuantity,
          newAverageEntry: newAvgEntry,
          orderId,
          clientOrderId,
        },
        tradeId: trade.id,
        planId: trade.planId,
      });
    }

    // Do not infer a stop fill from a crossed price. Stop-limit orders can gap
    // through and remain open; only exchange-reported executedQty below is
    // allowed to change the trade ledger.

    let gridTakeProfitEligible = false;
    if (updatedTrade.status !== "CLOSED" && updatedTrade.entries.length > 0) {
      const filledLevels = gridLevels.filter((_, index) => {
        const clientOrderId = generateDeterministicClientOrderId(trade.planId, `grid${index + 1}`);
        return (ordersByClientId.get(clientOrderId)?.executedQty ?? 0) > 0;
      }).length;
      const totalLevels = gridLevels.length;
      const allLevelsFilled = filledLevels >= totalLevels;

      const filledPrices = updatedTrade.entries.map((entry) => entry.price);
      const reversalAnchor =
        plan.direction === "short" ? Math.min(...filledPrices) : Math.max(...filledPrices);
      const reversalThreshold =
        plan.direction === "short"
          ? reversalAnchor * (1 - GRID_REVERSAL_THRESHOLD)
          : reversalAnchor * (1 + GRID_REVERSAL_THRESHOLD);
      const priceReversed =
        plan.direction === "short"
          ? currentPrice <= reversalThreshold
          : currentPrice >= reversalThreshold;
      gridTakeProfitEligible = allLevelsFilled || priceReversed;
    }

    if (tradeUpdated) updateTrade(trade.id, updatedTrade);

    const reconciledTrade = await applyConfirmedProtectiveFills(
      client,
      updatedTrade,
      plan,
      mergeOrders(orderHistory, openOrders),
      alerts,
    );
    if (gridTakeProfitEligible) {
      await maybeExecuteManagedTakeProfit(
        client,
        reconciledTrade,
        plan,
        mergeOrders(orderHistory, openOrders),
        currentPrice,
        alerts,
      );
    }

    if (tradeUpdated && reconciledTrade.status !== "CLOSED") {
      try {
        const repair = await repairProtectiveOrders(trade.planId, client);
        if (repair.repaired) {
          logger.info("Protective orders repaired after grid fill", {
            tradeId: trade.id,
            planId: trade.planId,
            placed: repair.placed,
          });
        }
      } catch (repairError) {
        logger.warn("Protective repair after grid fill failed", {
          tradeId: trade.id,
          planId: trade.planId,
          error: repairError instanceof Error ? repairError.message : String(repairError),
        });
      }
    }
  } catch (error) {
    logger.error("Error checking grid fills", error as Error, {
      tradeId: trade.id,
      symbol: trade.symbol,
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
 * Quantity that can still be closed without crossing through flat and opening
 * a short. Every filled exit counts, regardless of why it happened: a manual
 * or stop fill reduces the same position that a later take-profit order would
 * otherwise oversell.
 */
export function remainingTradeQuantity(trade: Pick<Trade, "entries" | "exits">): number {
  const entered = trade.entries.reduce(
    (sum, fill) => sum + (Number.isFinite(fill.quantity) && fill.quantity > 0 ? fill.quantity : 0),
    0,
  );
  const exited = trade.exits.reduce(
    (sum, fill) => sum + (Number.isFinite(fill.quantity) && fill.quantity > 0 ? fill.quantity : 0),
    0,
  );
  return roundQuantity(Math.max(0, entered - exited));
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
 * Execute at most one eligible grid take-profit through the managed close
 * path. No resting take-profit order is placed here: a venue without native
 * OCO cannot make independent stop and take-profit orders mutually exclusive.
 */
export async function placeGridTakeProfits(
  trade: Trade,
  exchange: Exchange,
): Promise<GridTPPlacementResult> {
  const alerts: Alert[] = [];
  const plan = getPlan(trade.planId);
  if (!plan) {
    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: "Plan not found",
      alerts,
    };
  }
  if (plan.strategy !== "grid_entry" || !plan.grid) {
    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: "Not a grid entry trade",
      alerts,
    };
  }
  if (trade.status === "CLOSED" || remainingTradeQuantity(trade) <= 0) {
    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: "Trade is closed or has no remaining quantity",
      alerts,
    };
  }
  if (trade.entries.length === 0) {
    return {
      success: false,
      placedCount: 0,
      failedCount: 0,
      skippedReason: "No grid entries filled yet",
      alerts,
    };
  }

  try {
    const currentPrice = await exchange.getPrice(trade.symbol);
    const orders = await loadPlanOrders(exchange, trade.symbol, trade.planId);
    const ordersByClientId = new Map(
      orders
        .filter((order): order is Order & { clientOrderId: string } => Boolean(order.clientOrderId))
        .map((order) => [order.clientOrderId, order]),
    );
    const filledLevelCount = plan.grid.levels.filter((_, index) => {
      const clientOrderId = generateDeterministicClientOrderId(trade.planId, `grid${index + 1}`);
      return (ordersByClientId.get(clientOrderId)?.executedQty ?? 0) > 0;
    }).length;
    const fillPercent = filledLevelCount / plan.grid.levels.length;
    const allLevelsFilled = filledLevelCount >= plan.grid.levels.length;
    const filledPrices = trade.entries.map((entry) => entry.price);
    const reversalAnchor =
      plan.direction === "short" ? Math.min(...filledPrices) : Math.max(...filledPrices);
    const reversalThreshold =
      plan.direction === "short"
        ? reversalAnchor * (1 - GRID_REVERSAL_THRESHOLD)
        : reversalAnchor * (1 + GRID_REVERSAL_THRESHOLD);
    const priceReversed =
      plan.direction === "short"
        ? currentPrice <= reversalThreshold
        : currentPrice >= reversalThreshold;
    const eligible = allLevelsFilled || (priceReversed && fillPercent >= GRID_TP_MIN_FILL_PERCENT);
    if (!eligible) {
      return {
        success: false,
        placedCount: 0,
        failedCount: 0,
        skippedReason:
          fillPercent < GRID_TP_MIN_FILL_PERCENT
            ? "Insufficient fills (" +
              (fillPercent * 100).toFixed(0) +
              "% < " +
              GRID_TP_MIN_FILL_PERCENT * 100 +
              "% required)"
            : "Waiting for all levels or price reversal (current: " +
              currentPrice.toFixed(4) +
              ", reversal at: " +
              reversalThreshold.toFixed(4) +
              ")",
        alerts,
      };
    }

    const before = new Set(trade.exits.map((exit) => exit.orderId));
    await maybeExecuteManagedTakeProfit(exchange, trade, plan, orders, currentPrice, alerts);
    const updated = getTrade(trade.id);
    const confirmedCount = updated
      ? updated.exits.filter((exit) => exit.reason.startsWith("TP") && !before.has(exit.orderId))
          .length
      : 0;

    return {
      success: confirmedCount > 0,
      placedCount: confirmedCount,
      failedCount: alerts.some((alert) => alert.severity === "critical") ? 1 : 0,
      skippedReason: confirmedCount > 0 ? undefined : "No managed take-profit fill was confirmed",
      alerts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Error executing grid take profit", error as Error, {
      tradeId: trade.id,
      symbol: trade.symbol,
    });
    return {
      success: false,
      placedCount: 0,
      failedCount: 1,
      skippedReason: `Error: ${message}`,
      alerts,
    };
  }
}

// ============================================================================
// PnL Calculations
// ============================================================================

export function calculateUnrealizedPnl(
  trade: Trade,
  currentPrice: number,
  plan: Pick<Plan, "direction">,
): { unrealizedPnl: number; unrealizedPnlPercent: number } {
  const avgEntry = trade.averageEntry;
  const remainingQty = calculateRemainingQuantity(trade);

  if (avgEntry === 0 || remainingQty === 0) {
    return { unrealizedPnl: 0, unrealizedPnlPercent: 0 };
  }

  const multiplier = plan.direction === "short" ? -1 : 1;
  const unrealizedPnl = multiplier * (currentPrice - avgEntry) * remainingQty;
  const unrealizedPnlPercent = multiplier * ((currentPrice - avgEntry) / avgEntry) * 100;

  return { unrealizedPnl, unrealizedPnlPercent };
}

export function calculateRealizedPnl(
  trade: Trade,
  plan: Pick<Plan, "direction">,
): { realizedPnl: number; realizedPnlPercent: number } {
  const avgEntry = trade.averageEntry;

  if (avgEntry === 0 || trade.exits.length === 0) {
    return { realizedPnl: 0, realizedPnlPercent: 0 };
  }

  let totalRealizedPnl = 0;
  let totalExitQty = 0;

  const multiplier = plan.direction === "short" ? -1 : 1;
  for (const exit of trade.exits) {
    const exitPnl = multiplier * (exit.price - avgEntry) * exit.quantity;
    totalRealizedPnl += exitPnl;
    totalExitQty += exit.quantity;
  }

  const entryValue = avgEntry * totalExitQty;
  const realizedPnlPercent = entryValue > 0 ? (totalRealizedPnl / entryValue) * 100 : 0;

  return { realizedPnl: totalRealizedPnl, realizedPnlPercent };
}

function calculateRemainingQuantity(trade: Trade): number {
  const totalEntryQty = trade.entries.reduce((sum, e) => sum + e.quantity, 0);
  const totalExitQty = trade.exits.reduce((sum, e) => sum + e.quantity, 0);
  return Math.max(0, totalEntryQty - totalExitQty);
}

function _calculateTotalExitPercent(trade: Trade): number {
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
  return plan.direction === "short"
    ? ((stopPrice - currentPrice) / currentPrice) * 100
    : ((currentPrice - stopPrice) / currentPrice) * 100;
}

function calculateDistanceToNextTP(trade: Trade, currentPrice: number, plan: Plan): number {
  if (currentPrice === 0) return 0;

  const filledTPs = new Set(
    trade.exits.filter((e) => e.reason.startsWith("TP")).map((e) => e.reason),
  );

  for (let i = 0; i < plan.takeProfit.length; i++) {
    const tpLabel = `TP${i + 1}` as "TP1" | "TP2" | "TP3";
    const tp = plan.takeProfit[i];
    if (!filledTPs.has(tpLabel) && tp) {
      const tpPrice = tp.price;
      return plan.direction === "short"
        ? ((currentPrice - tpPrice) / currentPrice) * 100
        : ((tpPrice - currentPrice) / currentPrice) * 100;
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

async function checkMarketAnomalies(client: Exchange, symbol: string): Promise<Alert[]> {
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
      logger.warn("Flash crash detected", {
        symbol,
        dropPercent: flashCrashAlert.data.dropPercent,
      });
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
    const priceVelocity =
      currentCandle.open > 0
        ? Math.abs(currentCandle.close - currentCandle.open) / currentCandle.open
        : 0;
    const candleRange =
      currentCandle.close > 0 ? (currentCandle.high - currentCandle.low) / currentCandle.close : 0;

    // Feed current metrics into the baseline tracker
    updateBaseline(symbol, currentCandle.volume, priceVelocity, candleRange);

    // Check for multi-metric anomaly (only fires after baseline is calibrated)
    const multiMetricAlert = checkMultiMetricAnomaly(
      symbol,
      currentCandle.volume,
      priceVelocity,
      candleRange,
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
  previousCandles: { volume: number }[],
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
  currentCandle: { open: number; close: number; low: number },
): Alert | null {
  if (currentCandle.open === 0) return null;

  const dropPercent = ((currentCandle.open - currentCandle.close) / currentCandle.open) * 100;
  const maxDropPercent = ((currentCandle.open - currentCandle.low) / currentCandle.open) * 100;

  if (
    dropPercent >= FLASH_CRASH_THRESHOLD_PERCENT ||
    maxDropPercent >= FLASH_CRASH_THRESHOLD_PERCENT
  ) {
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
export async function initializeRealtimeMonitor(
  _exchangeId: string = "ccxt:binance",
): Promise<void> {
  const { syncExchangeMarketFeeds } = await import("../../infra/exchange/marketStreamLifecycle.ts");
  await syncExchangeMarketFeeds();
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
    monitorHandlersWired = false;
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
    const distanceToStop =
      plan.direction === "short"
        ? ((stopPrice - price) / price) * 100
        : ((price - stopPrice) / price) * 100;

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
    const stopBreached = plan.direction === "short" ? price >= stopPrice : price <= stopPrice;
    if (stopBreached) {
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
export async function getRealtimePrice(client: Exchange, symbol: string): Promise<number> {
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
  const {
    trade,
    currentPrice,
    unrealizedPnl,
    unrealizedPnlPercent,
    distanceToStop,
    distanceToNextTP,
    status,
  } = update;

  const statusIndicator = status === "critical" ? "[!!!]" : status === "warning" ? "[!]" : "[OK]";

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
    lines.push(
      `  Realized PnL: ${realizedSign}$${trade.realizedPnl.toFixed(2)} (${realizedSign}${trade.realizedPnlPercent.toFixed(2)}%)`,
    );
  }

  return lines.join("\n");
}

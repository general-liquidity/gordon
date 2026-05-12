/**
 * Order Recovery Module
 *
 * Handles recovery of orphaned orders and trade reconciliation with:
 * - Detection of orders on Binance not tracked in Gordon
 * - Reconciliation of partially filled orders
 * - Recovery of trades after crashes/disconnections
 */

import type { BinanceClient } from "../../infra/venues/exchange/clients/binance/client.ts";
import type { OrderStatus } from "../../infra/venues/exchange/clients/binance/types.ts";

// Order type for recovery operations
interface Order {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  status: OrderStatus;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  time: number;
  updateTime: number;
}
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("order-recovery");

export interface OrphanedOrder {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  status: OrderStatus;
  price: number;
  origQty: number;
  executedQty: number;
  time: number;
  reason: "no_trade_record" | "trade_status_mismatch" | "partial_fill_untracked";
}

export interface RecoveryResult {
  scanned: number;
  orphaned: OrphanedOrder[];
  recovered: number;
  errors: string[];
}

export interface PartialFillInfo {
  orderId: number;
  symbol: string;
  originalQty: number;
  executedQty: number;
  remainingQty: number;
  avgPrice: number;
  status: OrderStatus;
}

// Gordon order ID prefix pattern
const GORDON_ORDER_PREFIX = "gordon_";

/**
 * Check if an order was placed by Gordon
 */
export function isGordonOrder(clientOrderId: string): boolean {
  return clientOrderId.startsWith(GORDON_ORDER_PREFIX);
}

/**
 * Extract the owner key from a Gordon client order ID.
 *
 * Supported formats:
 * - Standard orders: gordon_{planFragment}_{orderType}_{timestamp}_{random}
 * - Trailing stop: gordon_tsl_{tradeFragment}_{timestamp}
 */
export function extractOrderOwnerKey(clientOrderId: string): string | null {
  if (!isGordonOrder(clientOrderId)) return null;

  const parts = clientOrderId.split("_");
  if (parts.length < 2) return null;

  if (parts[1] === "tsl") {
    return parts[2] || null;
  }

  return parts[1] || null;
}

/**
 * @deprecated Use extractOrderOwnerKey()
 */
export function extractTradeId(clientOrderId: string): string | null {
  return extractOrderOwnerKey(clientOrderId);
}

function isKnownOrderOwner(ownerKey: string, knownOrderOwnerKeys: Set<string>): boolean {
  if (knownOrderOwnerKeys.has(ownerKey)) return true;

  // Accept both fragment keys and prefixed IDs for backward compatibility.
  return (
    knownOrderOwnerKeys.has(`pln_${ownerKey}`) ||
    knownOrderOwnerKeys.has(`trd_${ownerKey}`) ||
    knownOrderOwnerKeys.has(`trade_${ownerKey}`)
  );
}

/**
 * Scan for orphaned Gordon orders on Binance
 */
export async function scanForOrphanedOrders(
  client: BinanceClient,
  knownOrderOwnerKeys: Set<string>,
  symbols?: string[]
): Promise<OrphanedOrder[]> {
  const orphaned: OrphanedOrder[] = [];

  try {
    // Get all open orders
    const openOrders = symbols
      ? await Promise.all(symbols.map((s) => client.getOpenOrders(s))).then((r) => r.flat())
      : await client.getOpenOrders();

    for (const order of openOrders) {
      if (!isGordonOrder(order.clientOrderId)) continue;

      const ownerKey = extractOrderOwnerKey(order.clientOrderId);
      if (!ownerKey || !isKnownOrderOwner(ownerKey, knownOrderOwnerKeys)) {
        orphaned.push({
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          status: order.status,
          price: parseFloat(order.price),
          origQty: parseFloat(order.origQty),
          executedQty: parseFloat(order.executedQty),
          time: order.time ?? Date.now(),
          reason: "no_trade_record",
        });
      }
    }
  } catch (error) {
    logger.error("Failed to scan for orphaned orders", { error });
  }

  return orphaned;
}

/**
 * Get detailed fill information for an order
 */
export async function getPartialFillInfo(
  client: BinanceClient,
  symbol: string,
  orderId: number
): Promise<PartialFillInfo | null> {
  try {
    const order = await client.getOrderStatus(symbol, orderId);
    if (!order) return null;

    const origQty = parseFloat(order.origQty);
    const executedQty = parseFloat(order.executedQty);
    const cumulativeQuoteQty = parseFloat(order.cummulativeQuoteQty);

    return {
      orderId: order.orderId,
      symbol: order.symbol,
      originalQty: origQty,
      executedQty,
      remainingQty: origQty - executedQty,
      avgPrice: executedQty > 0 ? cumulativeQuoteQty / executedQty : 0,
      status: order.status,
    };
  } catch (error) {
    logger.error("Failed to get partial fill info", { symbol, orderId, error });
    return null;
  }
}

/**
 * Attempt to cancel an orphaned order
 */
export async function cancelOrphanedOrder(
  client: BinanceClient,
  symbol: string,
  orderId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await client.cancelOrder(symbol, String(orderId));
    logger.info("Cancelled orphaned order", { symbol, orderId });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to cancel orphaned order", { symbol, orderId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Check if order needs stop-loss protection
 */
export function needsStopLossProtection(order: OrphanedOrder): boolean {
  // Entry orders with executed quantity need protection
  return (
    order.side === "BUY" &&
    order.executedQty > 0 &&
    (order.status === "FILLED" || order.status === "PARTIALLY_FILLED")
  );
}

/**
 * Calculate suggested stop-loss price based on entry
 */
export function calculateSuggestedStopLoss(
  entryPrice: number,
  stopLossPercent: number = 5
): number {
  return entryPrice * (1 - stopLossPercent / 100);
}

/**
 * Run full order recovery scan
 */
export async function runOrderRecovery(
  client: BinanceClient,
  knownOrderOwnerKeys: Set<string>,
  options: {
    symbols?: string[];
    cancelOrphaned?: boolean;
    logResults?: boolean;
  } = {}
): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    scanned: 0,
    orphaned: [],
    recovered: 0,
    errors: [],
  };

  try {
    // Scan for orphaned orders
    result.orphaned = await scanForOrphanedOrders(client, knownOrderOwnerKeys, options.symbols);
    result.scanned = result.orphaned.length;

    if (options.logResults && result.orphaned.length > 0) {
      logger.warn("Found orphaned orders", {
        count: result.orphaned.length,
        orders: result.orphaned.map((o) => ({
          symbol: o.symbol,
          orderId: o.orderId,
          side: o.side,
          executedQty: o.executedQty,
        })),
      });
    }

    // Optionally cancel orphaned orders
    if (options.cancelOrphaned) {
      for (const order of result.orphaned) {
        // Only cancel if no quantity was executed
        if (order.executedQty === 0) {
          const cancelResult = await cancelOrphanedOrder(client, order.symbol, order.orderId);
          if (cancelResult.success) {
            result.recovered++;
          } else if (cancelResult.error) {
            result.errors.push(`Failed to cancel ${order.symbol} #${order.orderId}: ${cancelResult.error}`);
          }
        } else {
          // Order has fills - needs manual attention
          result.errors.push(
            `Order ${order.symbol} #${order.orderId} has ${order.executedQty} filled - needs manual attention`
          );
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Recovery scan failed: ${message}`);
    logger.error("Order recovery scan failed", { error: message });
  }

  return result;
}

/**
 * Verify order exists and matches expected state
 */
export async function verifyOrderState(
  client: BinanceClient,
  symbol: string,
  orderId: number,
  expectedStatus?: OrderStatus
): Promise<{ exists: boolean; matches: boolean; actualStatus?: OrderStatus }> {
  try {
    const order = await client.getOrderStatus(symbol, orderId);

    if (!order) {
      return { exists: false, matches: false };
    }

    return {
      exists: true,
      matches: !expectedStatus || order.status === expectedStatus,
      actualStatus: order.status,
    };
  } catch (error) {
    // Order might not exist or be inaccessible
    return { exists: false, matches: false };
  }
}

/**
 * Get actual executed quantity from Binance for an order
 */
export async function getActualExecutedQty(
  client: BinanceClient,
  symbol: string,
  orderId: number
): Promise<number | null> {
  const info = await getPartialFillInfo(client, symbol, orderId);
  return info?.executedQty ?? null;
}

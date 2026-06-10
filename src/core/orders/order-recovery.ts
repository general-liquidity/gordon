/**
 * Order recovery helpers — Gordon client-order-id parsing for reconciliation.
 */

const GORDON_ORDER_PREFIX = "gordon_";

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

/** @deprecated Use extractOrderOwnerKey() */
export function extractTradeId(clientOrderId: string): string | null {
  return extractOrderOwnerKey(clientOrderId);
}
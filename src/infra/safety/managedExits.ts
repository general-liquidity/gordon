import { resolveFlag } from "../config/flagResolver.ts";
import type { Exchange, ExchangeExtended } from "../exchange/index.ts";

export const MANAGED_EXITS_ACK_FLAG = "GORDON_MANAGED_EXITS_ACK";

export function isManagedExitsAcknowledged(): boolean {
  const raw = resolveFlag(MANAGED_EXITS_ACK_FLAG);
  return raw === "1" || raw === "true" || raw === "yes";
}

/** The only TP shape that remains protected when Gordon is not running. */
export function getNativeOcoExchangeForTakeProfits(
  exchange: Exchange,
  takeProfitCount: number,
): ExchangeExtended | null {
  if (takeProfitCount !== 1) return null;
  const extended = exchange as ExchangeExtended;
  return typeof extended.placeOCOOrder === "function" ? extended : null;
}

export function requiresProcessManagedTakeProfit(
  exchange: Exchange,
  takeProfitCount: number,
): boolean {
  return (
    takeProfitCount > 0 && getNativeOcoExchangeForTakeProfits(exchange, takeProfitCount) === null
  );
}

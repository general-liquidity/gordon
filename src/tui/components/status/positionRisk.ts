import type { Position } from "./LivePositions.tsx";

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Side-aware percentage distance from last price to the stop.
 * Negative values mean the stop level has already been breached.
 */
export function stopDistancePct(
  p: Pick<Position, "side" | "lastPrice" | "stopPrice">,
): number | null {
  if (!hasFiniteNumber(p.stopPrice) || !hasFiniteNumber(p.lastPrice) || p.lastPrice <= 0)
    return null;
  if (p.side === "long") return (p.lastPrice - p.stopPrice) / p.lastPrice;
  return (p.stopPrice - p.lastPrice) / p.lastPrice;
}

/**
 * Fraction of account equity at risk if the stop fills.
 * Loss is measured from entry, not last price, because that is the realized
 * trade loss the risk kernel reasons about.
 */
export function accountPctAtRisk(
  p: Pick<Position, "side" | "entryPrice" | "quantity" | "stopPrice">,
  accountEquity: number | null | undefined,
): number | null {
  if (!hasFiniteNumber(p.stopPrice) || !hasFiniteNumber(accountEquity) || accountEquity <= 0)
    return null;
  if (!hasFiniteNumber(p.entryPrice) || !hasFiniteNumber(p.quantity)) return null;

  const quantity = Math.abs(p.quantity);
  const perUnitLoss = p.side === "long" ? p.entryPrice - p.stopPrice : p.stopPrice - p.entryPrice;
  const loss = Math.max(0, perUnitLoss * quantity);
  return loss / accountEquity;
}

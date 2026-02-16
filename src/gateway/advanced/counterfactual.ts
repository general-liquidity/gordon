import type { GordonContext } from "../../infra/agents/tools/types.ts";
import { evaluateOrderRisk } from "../../infra/agents/tools/risk-gate.ts";

export interface CounterfactualOrder {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP_LIMIT";
  quantity: number;
  price?: number;
}

export interface CounterfactualOrderResult {
  symbol: string;
  side: string;
  type: string;
  requestedQuantity: number;
  adjustedQuantity: number;
  approved: boolean;
  reason: string;
  warnings: string[];
}

export interface CounterfactualBundleResult {
  simulated: number;
  approved: number;
  rejected: number;
  safeToExecute: boolean;
  results: CounterfactualOrderResult[];
}

/**
 * Counterfactual execution twin:
 * run risk/circuit checks against a bundle before any live submission.
 */
export async function simulateOrderBundle(
  orders: CounterfactualOrder[],
  context: GordonContext,
): Promise<CounterfactualBundleResult> {
  const results: CounterfactualOrderResult[] = [];

  for (const order of orders) {
    const risk = await evaluateOrderRisk(
      {
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        price: order.price,
      },
      context,
      "counterfactual_twin",
    );

    results.push({
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      requestedQuantity: order.quantity,
      adjustedQuantity: risk.quantity,
      approved: risk.approved,
      reason: risk.reason,
      warnings: risk.warnings,
    });
  }

  const approved = results.filter((r) => r.approved).length;
  const rejected = results.length - approved;

  return {
    simulated: results.length,
    approved,
    rejected,
    safeToExecute: rejected === 0,
    results,
  };
}


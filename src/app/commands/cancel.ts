// ============================================================================

import { requireLiveConsent } from "../../infra/safety/consent.ts";
// Cancel Command — Cancel open orders by ID or symbol
//
// Usage: /cancel <orderId>    — cancel specific order
//        /cancel <symbol>     — cancel all orders for symbol
//        /cancel all          — cancel all open orders
// ============================================================================

export interface CancelResult {
  cancelled: number;
  failed: number;
  details: Array<{
    orderId: string;
    symbol: string;
    status: "cancelled" | "failed";
    error?: string;
  }>;
}

export async function handleCancelCommand(args: string, runtime: any): Promise<CancelResult> {
  const target = args.trim();

  if (!target) {
    return {
      cancelled: 0,
      failed: 0,
      details: [
        { orderId: "", symbol: "", status: "failed", error: "Usage: /cancel <orderId|symbol|all>" },
      ],
    };
  }

  try {
    const state = runtime?.getState?.();
    const exchange = state?.session?.exchange;

    if (!exchange) {
      return {
        cancelled: 0,
        failed: 0,
        details: [{ orderId: "", symbol: "", status: "failed", error: "No exchange connected" }],
      };
    }

    // Generic cancellation can remove a protective stop and therefore is not
    // automatically exposure-reducing. Keep it under the same explicit live
    // consent policy as the agent-facing cancel tool. Dedicated verified-close
    // paths remain exempt because they prove the order reduces an open
    // position before dispatch.
    const consent = requireLiveConsent({ sandboxActive: exchange.isSandbox ?? false });
    if (!consent.ok) {
      return {
        cancelled: 0,
        failed: 1,
        details: [{ orderId: target, symbol: "", status: "failed", error: consent.reason }],
      };
    }

    if (target.toLowerCase() === "all") {
      // Cancel all open orders
      const openOrders = await exchange.getOpenOrders();
      const results: CancelResult["details"] = [];

      for (const order of openOrders) {
        try {
          await exchange.cancelOrder(order.symbol, order.orderId);
          results.push({ orderId: order.orderId, symbol: order.symbol, status: "cancelled" });
        } catch (err) {
          results.push({
            orderId: order.orderId,
            symbol: order.symbol,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        cancelled: results.filter((r) => r.status === "cancelled").length,
        failed: results.filter((r) => r.status === "failed").length,
        details: results,
      };
    }

    // Try as order ID first, then as symbol
    const isSymbol = target.includes("/") || target.includes("USDT") || target.length <= 10;

    if (isSymbol) {
      const symbol = target.toUpperCase();
      const openOrders = await exchange.getOpenOrders(symbol);
      const results: CancelResult["details"] = [];

      for (const order of openOrders) {
        try {
          await exchange.cancelOrder(symbol, order.orderId);
          results.push({ orderId: order.orderId, symbol, status: "cancelled" });
        } catch (err) {
          results.push({
            orderId: order.orderId,
            symbol,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        cancelled: results.filter((r) => r.status === "cancelled").length,
        failed: results.filter((r) => r.status === "failed").length,
        details: results,
      };
    }

    // Treat as order ID
    try {
      await exchange.cancelOrder("", target);
      return {
        cancelled: 1,
        failed: 0,
        details: [{ orderId: target, symbol: "", status: "cancelled" }],
      };
    } catch (err) {
      return {
        cancelled: 0,
        failed: 1,
        details: [
          {
            orderId: target,
            symbol: "",
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  } catch (err) {
    return {
      cancelled: 0,
      failed: 0,
      details: [
        {
          orderId: "",
          symbol: "",
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

// ============================================================================

import { requireLiveConsent } from "../../infra/safety/consent.ts";
import {
  classifyCancellationExposure,
  inspectCancellationMarket,
} from "../../infra/trading/risk/cancelExposure.ts";
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

    const consent = requireLiveConsent({ sandboxActive: exchange.isSandbox ?? false });
    const bulkCancel = async (symbols: readonly string[]): Promise<CancelResult> => {
      const results: CancelResult["details"] = [];
      for (const symbol of symbols) {
        try {
          const cancelled = await exchange.cancelAllOrders(symbol);
          for (const order of cancelled) {
            results.push({
              orderId: String(order.orderId),
              symbol: order.symbol ?? symbol,
              status: "cancelled",
            });
          }
        } catch (err) {
          results.push({
            orderId: "",
            symbol,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return {
        cancelled: results.filter((result) => result.status === "cancelled").length,
        failed: results.filter((result) => result.status === "failed").length,
        details: results,
      };
    };
    const cancelOrders = async (orders: any[]): Promise<CancelResult> => {
      const results: CancelResult["details"] = [];
      for (const order of orders) {
        try {
          if (!consent.ok) {
            const market = await inspectCancellationMarket(exchange, order.symbol);
            const exposure = classifyCancellationExposure(order, market.balances, market.context);
            if (exposure !== "reduces_risk") {
              results.push({
                orderId: String(order.orderId),
                symbol: order.symbol,
                status: "failed",
                error: `${consent.reason} Cancellation classified as ${exposure}.`,
              });
              continue;
            }
          }
          await exchange.cancelOrder(order.symbol, String(order.orderId));
          results.push({
            orderId: String(order.orderId),
            symbol: order.symbol,
            status: "cancelled",
          });
        } catch (err) {
          results.push({
            orderId: String(order.orderId),
            symbol: order.symbol,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return {
        cancelled: results.filter((result) => result.status === "cancelled").length,
        failed: results.filter((result) => result.status === "failed").length,
        details: results,
      };
    };

    if (target.toLowerCase() === "all") {
      // Cancel all open orders
      const openOrders = await exchange.getOpenOrders();
      if (consent.ok) {
        const symbols = Array.from(
          new Set<string>(openOrders.map((order: { symbol: string }) => String(order.symbol))),
        );
        return bulkCancel(symbols);
      }
      return cancelOrders(openOrders);
    }

    // Resolve exact order ID first. Length and punctuation are not reliable:
    // venues use short numeric IDs, while legitimate symbols can be long and
    // omit both slashes and USDT.
    try {
      const openOrders = await exchange.getOpenOrders();
      const order = openOrders.find((candidate: any) => String(candidate.orderId) === target);
      if (order) return cancelOrders([order]);
      if (/^\d+$/.test(target)) {
        return {
          cancelled: 0,
          failed: 1,
          details: [
            {
              orderId: target,
              symbol: "",
              status: "failed",
              error: "Open-order metadata unavailable; cancellation refused fail-closed.",
            },
          ],
        };
      }
      const symbol = target.toUpperCase();
      if (consent.ok) return bulkCancel([symbol]);
      const normalized = symbol.replace(/[^A-Z0-9]/g, "");
      return cancelOrders(
        openOrders.filter(
          (candidate: any) =>
            String(candidate.symbol ?? "")
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "") === normalized,
        ),
      );
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
      failed: 1,
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

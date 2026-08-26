/**
 * Order Book & Advanced Trading Tools (Mastra Format)
 * Tools for liquidity analysis, OCO orders, and order management
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key differences:
 * - tool() → createTool()
 * - name → id
 * - parameters → inputSchema
 * - Added outputSchema for better LLM routing
 * - Context access via second parameter (MastraExecutionContext)
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "../types.ts";
import { checkTradingPermission } from "../runtime/permissionHelpers.ts";
import { runHooks } from "../../../hooks/engine.ts";
import { recordStructuredObservation } from "../../../platform/observability/index.ts";
import { appendActionLogEntry } from "../../../action-log/index.ts";

import type { OrderBookEntry } from "../../../exchange/types.ts";
import { createCachedTool, TOOL_CACHE_CONFIG } from "../runtime/cache.ts";
import { placeOCOOrders } from "../../../../core/pipeline/executor.ts";
import { resolveInstrument } from "../../../domain/markets/instruments.ts";
import { checkKillSwitchForOrder } from "../../../safety/killSwitchGate.ts";
import { requireLiveConsent } from "../../../safety/consent.ts";

function killSwitchOrderError(
  ctx: ReturnType<typeof getGordonContext>,
  symbol: string,
): string | null {
  if (!ctx) return null;
  const block = checkKillSwitchForOrder(ctx, { instrument: symbol });
  return block.blocked ? block.error : null;
}

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "No active trading venue is connected. Please run setup first." },
  notArmed: (action: string) => ({
    error: `permissionMode must not be 'strict' to ${action}. Use /auto or /ask.`,
  }),
};

function normalizeEntries(entries: Array<[string, string] | OrderBookEntry>): OrderBookEntry[] {
  return entries.map((entry) => {
    if (Array.isArray(entry)) {
      return { price: parseFloat(entry[0]), quantity: parseFloat(entry[1]) };
    }
    return entry;
  });
}

// ============================================================================
// Order Book / Liquidity Analysis
// ============================================================================

export const getOrderBookTool = createTool({
  id: "get_order_book",
  description:
    "Get order book depth showing buy/sell walls and liquidity. " +
    "Use when user asks 'show order book', 'liquidity for BTC', 'buy/sell walls', 'market depth'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    limit: z.number().min(5).max(100).default(20).describe("Number of price levels to show"),
  }),
  outputSchema: z.object({
    marketFamily: z.enum(["crypto", "stocks"]).optional(),
    venueRoute: z.enum(["exchange", "broker"]).optional(),
    capabilities: z.object({
      supportsQuotes: z.boolean(),
      supportsBidAsk: z.boolean(),
      supportsOrderBook: z.boolean(),
      supportsSessionCalendar: z.boolean(),
      supportsExtendedHours: z.boolean(),
      supportsHistoricalBars: z.boolean(),
    }).optional(),
    symbol: z.string().optional(),
    message: z.string().optional(),
    spread: z.object({
      value: z.string(),
      percent: z.string(),
      bestBid: z.number(),
      bestAsk: z.number(),
    }).optional(),
    liquidity: z.object({
      bidDepth: z.string(),
      askDepth: z.string(),
      ratio: z.string(),
      imbalance: z.string(),
    }).optional(),
    walls: z.object({
      largestBid: z.object({
        price: z.number().optional(),
        quantity: z.number().optional(),
      }),
      largestAsk: z.object({
        price: z.number().optional(),
        quantity: z.number().optional(),
      }),
    }).optional(),
    topBids: z.array(z.object({
      price: z.number(),
      quantity: z.number(),
      total: z.number(),
    })).optional(),
    topAsks: z.array(z.object({
      price: z.number(),
      quantity: z.number(),
      total: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return errors.noExchange;
    }
    const instrument = await resolveInstrument(ctx, symbol);
    const normalizedSymbol = instrument.normalizedSymbol;

    if (instrument.route === "broker" && ctx.broker) {
      try {
        const quote = await ctx.broker.getLatestQuote(normalizedSymbol);
        const spreadValue = quote.askPrice - quote.bidPrice;
        const spreadPercent = quote.askPrice > 0 ? (spreadValue / quote.askPrice) * 100 : 0;

        return {
          marketFamily: instrument.marketFamily,
          venueRoute: instrument.route,
          capabilities: instrument.capabilities,
          symbol: normalizedSymbol,
          message: "Level-2 order book depth is not available on the active broker. Returning top-of-book quote instead.",
          spread: {
            value: spreadValue.toFixed(4),
            percent: `${spreadPercent.toFixed(4)}%`,
            bestBid: quote.bidPrice,
            bestAsk: quote.askPrice,
          },
          topBids: [{ price: quote.bidPrice, quantity: quote.bidSize, total: quote.bidSize }],
          topAsks: [{ price: quote.askPrice, quantity: quote.askSize, total: quote.askSize }],
        };
      } catch (error) {
        return { error: `Failed to get top-of-book quote: ${(error as Error).message}` };
      }
    }

    if (!ctx?.exchange) {
      return { error: "No active crypto execution venue is connected." };
    }

    try {
      const orderBook = await ctx.exchange.getOrderBook(normalizedSymbol, limit);

      // Calculate totals and find walls
      let bidTotal = 0;
      let askTotal = 0;
      const bids = normalizeEntries(orderBook.bids).slice(0, limit).map((entry) => {
        const quantity = entry.quantity;
        bidTotal += quantity;
        return { price: entry.price, quantity, total: bidTotal };
      });

      const asks = normalizeEntries(orderBook.asks).slice(0, limit).map((entry) => {
        const quantity = entry.quantity;
        askTotal += quantity;
        return { price: entry.price, quantity, total: askTotal };
      });

      // Find largest walls
      const largestBid = bids.reduce((max, b) => b.quantity > max.quantity ? b : max, bids[0]!);
      const largestAsk = asks.reduce((max, a) => a.quantity > max.quantity ? a : max, asks[0]!);

      // Calculate spread
      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 0;
      const spread = bestAsk - bestBid;
      const spreadPercent = (spread / bestAsk) * 100;

      return {
        marketFamily: instrument.marketFamily,
        venueRoute: instrument.route,
        capabilities: instrument.capabilities,
        symbol: normalizedSymbol,
        spread: {
          value: spread.toFixed(8),
          percent: spreadPercent.toFixed(4) + "%",
          bestBid,
          bestAsk,
        },
        liquidity: {
          bidDepth: bidTotal.toFixed(4),
          askDepth: askTotal.toFixed(4),
          ratio: (bidTotal / askTotal).toFixed(2),
          imbalance: bidTotal > askTotal ? "More buy pressure" : "More sell pressure",
        },
        walls: {
          largestBid: { price: largestBid?.price, quantity: largestBid?.quantity },
          largestAsk: { price: largestAsk?.price, quantity: largestAsk?.quantity },
        },
        topBids: bids.slice(0, 5),
        topAsks: asks.slice(0, 5),
      };
    } catch (error) {
      return { error: `Failed to get order book: ${(error as Error).message}` };
    }
  },
});

export const getSpreadTool = createTool({
  id: "get_spread",
  description:
    "Get the bid-ask spread for a trading pair. " +
    "Use when user asks 'what's the spread', 'slippage check', 'is liquidity good'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
  }),
  outputSchema: z.object({
    marketFamily: z.enum(["crypto", "stocks"]).optional(),
    venueRoute: z.enum(["exchange", "broker"]).optional(),
    capabilities: z.object({
      supportsQuotes: z.boolean(),
      supportsBidAsk: z.boolean(),
      supportsOrderBook: z.boolean(),
      supportsSessionCalendar: z.boolean(),
      supportsExtendedHours: z.boolean(),
      supportsHistoricalBars: z.boolean(),
    }).optional(),
    symbol: z.string().optional(),
    bidPrice: z.number().optional(),
    askPrice: z.number().optional(),
    spread: z.string().optional(),
    spreadPercent: z.string().optional(),
    assessment: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return errors.noExchange;
    }
    const instrument = await resolveInstrument(ctx, symbol);
    const normalizedSymbol = instrument.normalizedSymbol;

    try {
      if (instrument.route === "broker" && ctx.broker) {
        const quote = await ctx.broker.getLatestQuote(normalizedSymbol);
        const spread = quote.askPrice - quote.bidPrice;
        const spreadPercent = quote.askPrice > 0 ? (spread / quote.askPrice) * 100 : 0;

        let assessment: string;
        if (spreadPercent < 0.05) {
          assessment = "Tight top-of-book quote";
        } else if (spreadPercent < 0.2) {
          assessment = "Moderate top-of-book spread";
        } else {
          assessment = "Wide top-of-book spread";
        }

        return {
          marketFamily: instrument.marketFamily,
          venueRoute: instrument.route,
          capabilities: instrument.capabilities,
          symbol: normalizedSymbol,
          bidPrice: quote.bidPrice,
          askPrice: quote.askPrice,
          spread: spread.toFixed(4),
          spreadPercent: `${spreadPercent.toFixed(4)}%`,
          assessment,
        };
      }

      if (!ctx?.exchange) {
        return { error: "No active crypto execution venue is connected." };
      }

      const spread = await ctx.exchange.getSpread(normalizedSymbol);

      let assessment: string;
      if (spread.spreadPercent < 0.05) {
        assessment = "Excellent liquidity";
      } else if (spread.spreadPercent < 0.1) {
        assessment = "Good liquidity";
      } else if (spread.spreadPercent < 0.5) {
        assessment = "Moderate liquidity";
      } else {
        assessment = "Low liquidity - be cautious";
      }

      return {
        marketFamily: instrument.marketFamily,
        venueRoute: instrument.route,
        capabilities: instrument.capabilities,
        symbol: normalizedSymbol,
        bidPrice: spread.bidPrice,
        askPrice: spread.askPrice,
        spread: spread.spread.toFixed(8),
        spreadPercent: spread.spreadPercent.toFixed(4) + "%",
        assessment,
      };
    } catch (error) {
      return { error: `Failed to get spread: ${(error as Error).message}` };
    }
  },
});

export const getRecentTradesTool = createTool({
  id: "get_market_trades",
  description:
    "Get recent MARKET trades for a symbol (all traders, not just user's trades). " +
    "Shows real-time buy/sell activity and trade flow. " +
    "Use when user asks 'trade flow', 'who's buying/selling', 'market activity'. " +
    "NOTE: For USER's own trade history, use get_trade_history instead.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    limit: z.number().min(1).max(100).default(20).describe("Number of trades to show"),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    analysis: z.object({
      buyVolume: z.string(),
      sellVolume: z.string(),
      ratio: z.string(),
      dominance: z.string(),
    }),
    trades: z.array(z.object({
      price: z.string(),
      quantity: z.string(),
      value: z.string(),
      side: z.enum(["BUY", "SELL"]),
      time: z.string(),
    })),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!ctx?.exchange) {
      return {
        symbol: normalizedSymbol,
        analysis: { buyVolume: "0", sellVolume: "0", ratio: "0", dominance: "N/A" },
        trades: [],
        error: errors.noExchange.error,
      };
    }
    return {
      symbol: normalizedSymbol,
      analysis: { buyVolume: "0", sellVolume: "0", ratio: "0", dominance: "N/A" },
      trades: [],
      error: "Public recent trades require exchange-native market data; not available via CCXT adapter.",
    };
  },
});

// ============================================================================
// OCO Orders
// ============================================================================

export const placeOCOOrderTool = createTool({
  id: "place_oco_order",
  description:
    "Place an OCO (One-Cancels-Other) order combining a stop-loss with a take-profit. " +
    "When one triggers, the other is automatically cancelled. " +
    "On Binance this uses the native atomic OCO endpoint; on other exchanges it places " +
    "two separate orders (stop-loss + take-profit) that the monitor will coordinate. " +
    "Use for 'set stop loss and take profit', 'OCO order', 'bracket order'. " +
    "Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("Order side"),
    quantity: z.number().positive().describe("Quantity to trade"),
    takeProfitPrice: z.number().positive().describe("Take-profit limit price"),
    stopPrice: z.number().positive().describe("Stop-loss trigger price"),
    stopLimitPrice: z.number().default(0).describe("Stop-loss limit price (slightly below stopPrice). Use 0 to default to stopPrice * 0.995."),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    orderListId: z.number().optional(),
    orderIds: z.array(z.string()).optional(),
    native: z.boolean().optional(),
    symbol: z.string().optional(),
    side: z.enum(["BUY", "SELL"]).optional(),
    quantity: z.number().optional(),
    stopPrice: z.number().optional(),
    takeProfitPrice: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, side, quantity, takeProfitPrice, stopPrice, stopLimitPrice }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    {
      const killErr = killSwitchOrderError(ctx, symbol);
      if (killErr) return { error: killErr, symbol, side, quantity, takeProfitPrice, stopPrice };
      const check = checkTradingPermission(ctx.config?.permissionMode, "execute", { sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper });
      if (!check.allowed) {
        return {
          error: check.reason ?? "Trading not permitted under current mode",
          symbol,
          side,
          quantity,
          takeProfitPrice,
          stopPrice,
        };
      }
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    // Default stopLimitPrice to 0.5% below stopPrice if not provided
    const effectiveStopLimitPrice = stopLimitPrice && stopLimitPrice > 0
      ? stopLimitPrice
      : stopPrice * 0.995;

    // Risk gate: evaluate order before placement
    try {
      const { evaluateOrderRisk } = await import("../trading/risk-gate.ts");
      const riskResult = await evaluateOrderRisk(
        { symbol: normalizedSymbol, side, type: "LIMIT", quantity, price: takeProfitPrice },
        ctx,
        "executor"
      );
      if (!riskResult.approved) {
        return { error: `Risk check rejected: ${riskResult.reason}` };
      }
      // Use risk-adjusted quantity if modified
      if (riskResult.quantity !== quantity) {
        quantity = riskResult.quantity;
      }
    } catch (riskErr) {
      return {
        error: `Risk check failed for OCO order: ${riskErr instanceof Error ? riskErr.message : String(riskErr)}`,
      };
    }

    try {
      const result = await placeOCOOrders(
        ctx.exchange,
        normalizedSymbol,
        side,
        quantity,
        stopPrice,
        effectiveStopLimitPrice,
        takeProfitPrice,
        undefined, // no planId for ad-hoc tool calls
        ctx.userId ?? "system"
      );

      if (!result.success) {
        return { error: result.error ?? "OCO order placement failed" };
      }

      return {
        success: true,
        message: `OCO order placed: ${side} ${quantity} ${normalizedSymbol} — SL @ ${stopPrice}, TP @ ${takeProfitPrice}${result.native ? " (native OCO)" : " (two separate orders)"}`,
        orderListId: result.orderListId,
        orderIds: result.orderIds,
        native: result.native,
        symbol: normalizedSymbol,
        side,
        quantity,
        stopPrice,
        takeProfitPrice,
      };
    } catch (error) {
      return { error: `Failed to place OCO order: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Order Management
// ============================================================================

export const cancelAllOrdersTool = createTool({
  id: "cancel_all_orders",
  description:
    "Cancel all open orders on a symbol. Emergency function. " +
    "Use when user says 'cancel all orders', 'cancel everything on BTC', 'emergency cancel'. " +
    "Requires permissionMode not 'strict'. " +
    "You MUST provide a one-sentence `rationale` (>=10 chars) stating why mass cancellation is correct — " +
    "the rationale is recorded in the audit log for post-hoc review.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    rationale: z
      .string()
      .min(10, {
        message:
          "rationale must be at least 10 characters. Mass cancel is destructive — articulate the SPECIFIC trigger (regime flip, hack news, mandate breach, explicit user request). 'cleanup' or 'safety' is not enough. If you cannot articulate why, do not call — surface the ambiguity instead.",
      })
      .describe("One-sentence reason for cancelling ALL orders on this symbol (e.g. 'User requested emergency cancel after regime flip')"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    cancelledOrders: z.array(z.object({
      orderId: z.number(),
      type: z.string(),
      side: z.string(),
      price: z.string(),
      quantity: z.string(),
    })).optional(),
    symbol: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, rationale }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    {
      const check = checkTradingPermission(ctx.config?.permissionMode, "cancel", { sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper });
      if (!check.allowed) {
        return {
          error: check.reason ?? "Cancelling orders not permitted under current mode",
          symbol,
        };
      }
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    recordStructuredObservation({
      eventType: "cancel.rationale_recorded",
      workflow: "execution",
      source: "agent_tool",
      component: "cancel_all_orders",
      toolName: "cancel_all_orders",
      outcome: "info",
      symbol: normalizedSymbol,
      details: { rationale },
    });
    try {
      appendActionLogEntry({
        entryType: "execution_result",
        title: `Cancel all orders ${normalizedSymbol}`,
        content: `Cancellation rationale: ${rationale}`,
        payload: { kind: "cancel", tool: "cancel_all_orders", symbol: normalizedSymbol, rationale },
      });
    } catch {
      // Storage failures must not block the cancellation itself.
    }

    try {
      const cancelled = await ctx.exchange.cancelAllOrders(normalizedSymbol);

      return {
        success: true,
        message: `Cancelled ${cancelled.length} orders on ${normalizedSymbol}`,
        cancelledOrders: cancelled.map((o) => ({
          orderId: Number(o.orderId) || 0,
          type: o.type,
          side: o.side,
          price: o.price.toFixed(8),
          quantity: o.quantity.toFixed(8),
        })),
      };
    } catch (error) {
      return { error: `Failed to cancel orders: ${(error as Error).message}` };
    }
  },
});

export const getOrderStatusTool = createTool({
  id: "get_order_status",
  description:
    "Check the status of a specific order. " +
    "Use when user asks 'check order status', 'is my order filled', 'order #123'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    orderId: z.number().describe("Order ID to check"),
  }),
  outputSchema: z.object({
    orderId: z.number().optional(),
    symbol: z.string().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    side: z.string().optional(),
    price: z.string().optional(),
    quantity: z.string().optional(),
    filled: z.string().optional(),
    remaining: z.string().optional(),
    fillPercent: z.string().optional(),
    time: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, orderId }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return errors.noExchange;
    }

    if (ctx.broker && !ctx.exchange) {
      try {
        const order = await ctx.broker.getOrder(String(orderId));
        const price = order.limitPrice ?? order.notional ?? 0;
        const quantity = order.qty ?? 0;
        const filled = order.filledQty ?? 0;
        return {
          orderId: Number(order.id) || orderId,
          symbol: order.symbol,
          status: order.status,
          type: order.type,
          side: order.side.toUpperCase(),
          price: price.toFixed(2),
          quantity: quantity.toFixed(4),
          filled: filled.toFixed(4),
          remaining: Math.max(quantity - filled, 0).toFixed(4),
          fillPercent: quantity > 0 ? ((filled / quantity) * 100).toFixed(1) + "%" : "0%",
          time: order.submittedAt,
        };
      } catch (error) {
        return { error: `Failed to get broker order status: ${(error as Error).message}` };
      }
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const order = await ctx.exchange!.getOrderStatus(normalizedSymbol, orderId);

      return {
        orderId: Number(order.orderId) || 0,
        symbol: order.symbol,
        status: order.status,
        type: order.type,
        side: order.side,
        price: order.price.toFixed(8),
        quantity: order.quantity.toFixed(8),
        filled: order.executedQty.toFixed(8),
        remaining: (order.quantity - order.executedQty).toFixed(8),
        fillPercent: order.quantity > 0 ? ((order.executedQty / order.quantity) * 100).toFixed(1) + "%" : "0%",
        time: order.time ? new Date(order.time).toISOString() : undefined,
      };
    } catch (error) {
      return { error: `Failed to get order status: ${(error as Error).message}` };
    }
  },
});

export const testOrderTool = createTool({
  id: "test_order",
  description:
    "Test if an order would be valid without actually placing it. " +
    "Use when user wants to 'validate order', 'test if order works', 'dry run'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("Order side"),
    type: z.enum(["LIMIT", "MARKET"]).describe("Order type"),
    quantity: z.number().positive().describe("Quantity to trade"),
    price: z.number().default(0).describe("Price (required for LIMIT orders, use 0 for MARKET)"),
  }),
  outputSchema: z.object({
    valid: z.boolean().optional(),
    message: z.string().optional(),
    orderDetails: z.object({
      symbol: z.string(),
      side: z.enum(["BUY", "SELL"]),
      type: z.enum(["LIMIT", "MARKET"]),
      quantity: z.number(),
      price: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, side, type, quantity, price }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return { ...errors.noExchange, valid: false };
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const isValid = await ctx.exchange.testOrder({
        symbol: normalizedSymbol,
        side,
        type,
        quantity,
        price,
      });

      return {
        valid: isValid,
        message: isValid
          ? "Order is valid and would be accepted."
          : "Order is invalid.",
        orderDetails: {
          symbol: normalizedSymbol,
          side,
          type,
          quantity,
          price,
        },
      };
    } catch (error) {
      return {
        valid: false,
        error: `Order validation failed: ${(error as Error).message}`,
      };
    }
  },
});

// ============================================================================
// Limit Order Tool
// ============================================================================

export const placeLimitOrderTool = createTool({
  id: "place_limit_order",
  description:
    "Place a limit order at a specific price. The order will sit on the book until filled or cancelled. " +
    "Use when user says 'buy BTC at 95000', 'set a buy order at X price', 'limit buy', 'limit sell'. " +
    "Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("BUY or SELL"),
    quantity: z.number().positive().describe("Quantity of the base asset to trade"),
    price: z.number().positive().describe("Limit price at which to place the order"),
    timeInForce: z.enum(["GTC", "IOC", "FOK"]).default("GTC").describe("Time in force: GTC (Good Til Cancelled), IOC (Immediate or Cancel), FOK (Fill or Kill)"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    order: z.object({
      orderId: z.number(),
      symbol: z.string(),
      side: z.string(),
      type: z.string(),
      status: z.string(),
      price: z.number(),
      quantity: z.number(),
      executedQty: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, side, quantity, price, timeInForce }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    {
      const killErr = killSwitchOrderError(ctx, symbol);
      if (killErr) return { error: killErr };
      const check = checkTradingPermission(ctx.config?.permissionMode, "execute", { sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper });
      if (!check.allowed) {
        return { error: check.reason ?? "Placing limit orders not permitted under current mode" };
      }
      const consent = requireLiveConsent({ sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper ?? false });
      if (!consent.ok) {
        return { error: consent.reason ?? "Live-trading consent required." };
      }
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    // Risk gate: evaluate order before placement
    try {
      const { evaluateOrderRisk } = await import("../trading/risk-gate.ts");
      const riskResult = await evaluateOrderRisk(
        { symbol: normalizedSymbol, side, type: "LIMIT", quantity, price },
        ctx,
        "executor"
      );
      if (!riskResult.approved) {
        return { error: `Risk check rejected: ${riskResult.reason}` };
      }
      // Use risk-adjusted quantity if modified
      if (riskResult.quantity !== quantity) {
        quantity = riskResult.quantity;
      }
    } catch (riskErr) {
      return {
        error: `Risk check failed for limit order: ${riskErr instanceof Error ? riskErr.message : String(riskErr)}`,
      };
    }

    // PreOrderPlacement hook — can block or modify
    {
      const preHook = await runHooks("PreOrderPlacement", {
        symbol: normalizedSymbol,
        side: side.toLowerCase() === "sell" ? "sell" : "buy",
        quantity: quantity,
        orderType: "LIMIT",
        notionalUsd: quantity * price,
        exchangeId: ctx.exchange?.exchangeId,
      });
      if (preHook.action === "block") {
        return { error: `PreOrderPlacement hook blocked: ${preHook.reason}` };
      }
    }

    try {
      const orderResult = await ctx.exchange.placeOrder({
        symbol: normalizedSymbol,
        side,
        type: "LIMIT",
        quantity,
        price,
        timeInForce,
      });

      if (!orderResult || orderResult.status === "REJECTED") {
        return {
          success: false,
          error: `Order rejected: ${orderResult?.status ?? "unknown"}`,
        };
      }

      // PostOrderPlacement hook — fire-and-forget audit
      runHooks("PostOrderPlacement", {
        orderId: String(orderResult.orderId ?? ""),
        symbol: orderResult.symbol ?? normalizedSymbol,
        side: side.toLowerCase() === "sell" ? "sell" : "buy",
        status: orderResult.status ?? "unknown",
        filledQty: Number(orderResult.executedQty ?? 0),
        notionalUsd: quantity * price,
      }).catch(() => {});

      return {
        success: true,
        message: `LIMIT ${side} ${quantity} ${normalizedSymbol} @ ${price} (${timeInForce}) — status: ${orderResult.status}`,
        order: {
          orderId: Number(orderResult.orderId) || 0,
          symbol: orderResult.symbol,
          side: orderResult.side,
          type: orderResult.type,
          status: orderResult.status,
          price: orderResult.price,
          quantity: orderResult.quantity,
          executedQty: orderResult.executedQty,
        },
      };
    } catch (error) {
      return { error: `Failed to place limit order: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Get Open Orders Tool
// ============================================================================

export const getOpenOrdersTool = createTool({
  id: "get_open_orders",
  description:
    "List all open/pending orders, optionally filtered by symbol. " +
    "Use when user asks 'what orders do I have open?', 'show my pending orders', 'open orders', 'any limit orders active?'.",
  inputSchema: z.object({
    symbol: z.string().optional().describe("Trading pair to filter (e.g., 'BTCUSDT'). Leave empty for all open orders."),
  }),
  outputSchema: z.object({
    count: z.number().optional(),
    orders: z.array(z.object({
      orderId: z.number(),
      symbol: z.string(),
      side: z.string(),
      type: z.string(),
      status: z.string(),
      price: z.number(),
      quantity: z.number(),
      executedQty: z.number(),
      remaining: z.number(),
      time: z.string().optional(),
    })).optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return errors.noExchange;
    }

    try {
      if (ctx.broker && !ctx.exchange) {
        const openOrders = await ctx.broker.getOpenOrders();
        const normalizedSymbol = symbol ? symbol.toUpperCase() : undefined;
        const filtered = normalizedSymbol
          ? openOrders.filter((order) => order.symbol.toUpperCase() === normalizedSymbol)
          : openOrders;

        if (filtered.length === 0) {
          return {
            count: 0,
            orders: [],
            message: normalizedSymbol
              ? `No open broker orders for ${normalizedSymbol}`
              : "No open broker orders",
          };
        }

        return {
          count: filtered.length,
          orders: filtered.map((order) => ({
            orderId: Number(order.id) || 0,
            symbol: order.symbol,
            side: order.side.toUpperCase(),
            type: order.type,
            status: order.status,
            price: order.limitPrice ?? order.stopPrice ?? order.notional ?? 0,
            quantity: order.qty,
            executedQty: order.filledQty,
            remaining: Math.max(order.qty - order.filledQty, 0),
            time: order.submittedAt,
          })),
        };
      }

      const normalizedSymbol = symbol
        ? (normalizeSymbol(symbol))
        : undefined;

      const openOrders = await ctx.exchange!.getOpenOrders(normalizedSymbol);

      if (openOrders.length === 0) {
        return {
          count: 0,
          orders: [],
          message: normalizedSymbol
            ? `No open orders for ${normalizedSymbol}`
            : "No open orders on any pair",
        };
      }

      return {
        count: openOrders.length,
        orders: openOrders.map((o) => ({
          orderId: Number(o.orderId) || 0,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          status: o.status,
          price: o.price,
          quantity: o.quantity,
          executedQty: o.executedQty,
          remaining: o.quantity - o.executedQty,
          time: o.time ? new Date(o.time).toISOString() : undefined,
        })),
      };
    } catch (error) {
      return { error: `Failed to get open orders: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Cancel Single Order Tool
// ============================================================================

export const cancelOrderTool = createTool({
  id: "cancel_order",
  description:
    "Cancel a single open order by its order ID. " +
    "Use when user says 'cancel my BTC order', 'cancel order #12345', 'remove that limit order'. " +
    "Requires permissionMode not 'strict'. For cancelling ALL orders on a symbol, use cancel_all_orders instead. " +
    "You MUST provide a one-sentence `rationale` (>=10 chars) stating why this cancellation is correct — " +
    "the rationale is recorded in the audit log for post-hoc review.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    orderId: z.number().describe("Order ID to cancel"),
    rationale: z
      .string()
      .min(10, {
        message:
          "rationale must be at least 10 characters. Name the SPECIFIC reason this order should be cancelled — invalidation event, sizing breach, user request. 'replacing it' is not a reason — describe what's different about the new context.",
      })
      .describe("One-sentence reason for cancelling this order (e.g. 'Stop moved invalidated by trend change')"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    cancelledOrderId: z.number().optional(),
    symbol: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, orderId, rationale }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    {
      const check = checkTradingPermission(ctx.config?.permissionMode, "cancel", { sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper });
      if (!check.allowed) {
        return { error: check.reason ?? "Cancelling orders not permitted under current mode" };
      }
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    recordStructuredObservation({
      eventType: "cancel.rationale_recorded",
      workflow: "execution",
      source: "agent_tool",
      component: "cancel_order",
      toolName: "cancel_order",
      outcome: "info",
      symbol: normalizedSymbol,
      details: { rationale, orderId },
    });
    try {
      appendActionLogEntry({
        entryType: "execution_result",
        title: `Cancel order ${normalizedSymbol} #${orderId}`,
        content: `Cancellation rationale: ${rationale}`,
        payload: { kind: "cancel", tool: "cancel_order", symbol: normalizedSymbol, orderId, rationale },
      });
    } catch {
      // Storage failures must not block the cancellation itself.
    }

    try {
      await ctx.exchange.cancelOrder(normalizedSymbol, String(orderId));

      return {
        success: true,
        message: `Cancelled order #${orderId} on ${normalizedSymbol}`,
        cancelledOrderId: orderId,
        symbol: normalizedSymbol,
      };
    } catch (error) {
      return { error: `Failed to cancel order #${orderId}: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Order History Tool
// ============================================================================

export const getOrderHistoryTool = createTool({
  id: "get_order_history",
  description:
    "Get order history for a symbol (all orders: filled, cancelled, expired, new). " +
    "Different from get_trade_history which shows fills/executions. " +
    "Use when user asks 'show my recent orders', 'order history for BTC', 'past orders'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    limit: z.number().min(1).max(100).default(20).describe("Max orders to return"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    count: z.number().optional(),
    orders: z.array(z.object({
      orderId: z.number(),
      symbol: z.string(),
      side: z.string(),
      type: z.string(),
      status: z.string(),
      price: z.number(),
      quantity: z.number(),
      executedQty: z.number(),
      cummulativeQuoteQty: z.number(),
      time: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const orders = await ctx.exchange.getOrderHistory(normalizedSymbol, limit);

      return {
        symbol: normalizedSymbol,
        count: orders.length,
        orders: orders.map((o) => ({
          orderId: Number(o.orderId) || 0,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          status: o.status,
          price: o.price,
          quantity: o.quantity,
          executedQty: o.executedQty,
          cummulativeQuoteQty: o.cummulativeQuoteQty,
          time: o.time ? new Date(o.time).toISOString() : undefined,
        })),
      };
    } catch (error) {
      return { error: `Failed to get order history: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Cancel & Replace Order (Binance-only)
// ============================================================================

export const cancelReplaceOrderTool = createTool({
  id: "cancel_replace_order",
  description:
    "Atomically cancel an existing order and replace it with a new one. " +
    "Use when user says 'replace my order', 'modify order #123', 'change order price', 'update my limit order'. " +
    "Requires permissionMode not 'strict'. Binance only. " +
    "You MUST provide a one-sentence `rationale` (>=10 chars) stating why the replacement is correct — " +
    "the rationale is recorded in the audit log for post-hoc review.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    cancelOrderId: z.number().describe("Order ID of the existing order to cancel"),
    side: z.enum(["BUY", "SELL"]).describe("Side of the new replacement order"),
    type: z.enum(["LIMIT", "MARKET"]).describe("Type of the new replacement order"),
    quantity: z.number().positive().describe("Quantity for the new order"),
    price: z.number().optional().describe("Price for the new order (required for LIMIT orders)"),
    timeInForce: z.enum(["GTC", "IOC", "FOK"]).default("GTC").describe("Time in force for the new order"),
    rationale: z
      .string()
      .min(10, {
        message:
          "rationale must be at least 10 characters. Cancel-replace is two destructive actions — articulate why the OLD order should die AND why the NEW order is correct. 'price changed' is insufficient — name the concrete trigger and the new entry/exit basis.",
      })
      .describe("One-sentence reason for replacing this order (e.g. 'Better entry price available after pullback to 99800')"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    cancelResult: z.string().optional(),
    newOrderResult: z.string().optional(),
    newOrder: z.object({
      orderId: z.number(),
      symbol: z.string(),
      side: z.string(),
      type: z.string(),
      status: z.string(),
      price: z.string(),
      quantity: z.string(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, cancelOrderId, side, type, quantity, price, timeInForce, rationale }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    {
      const check = checkTradingPermission(ctx.config?.permissionMode, "execute", { sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper });
      if (!check.allowed) {
        return { error: check.reason ?? "Cancel/replace not permitted under current mode" };
      }
    }

    return { error: "Cancel-replace requires Binance SAPI; not available via CCXT adapter." };
  },
});

// ============================================================================
// Cancel Order List (OCO/OTO) (Binance-only)
// ============================================================================

export const cancelOrderListTool = createTool({
  id: "cancel_order_list",
  description:
    "Cancel an OCO or OTO order list by its orderListId. " +
    "Use when user says 'cancel my OCO order', 'cancel order list #123'. " +
    "Requires permissionMode not 'strict'. " +
    "You MUST provide a one-sentence `rationale` (>=10 chars) stating why this cancellation is correct — " +
    "the rationale is recorded in the audit log for post-hoc review.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    orderListId: z.number().describe("The orderListId of the OCO/OTO order list to cancel"),
    rationale: z
      .string()
      .min(10, {
        message:
          "rationale must be at least 10 characters. OCO/OTO lists cancel both legs — articulate why BOTH legs are invalid, not just one. If only one leg is invalid, cancel that single order instead of the whole list.",
      })
      .describe("One-sentence reason for cancelling this OCO/OTO list (e.g. 'Both legs invalidated by funding flip')"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    orderListId: z.number().optional(),
    status: z.string().optional(),
    cancelledOrders: z.array(z.object({
      orderId: z.number(),
      symbol: z.string(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, orderListId, rationale }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    {
      const check = checkTradingPermission(ctx.config?.permissionMode, "cancel", { sandboxActive: ctx.exchange?.isSandbox ?? ctx.broker?.isPaper });
      if (!check.allowed) {
        return { error: check.reason ?? "Cancelling order lists not permitted under current mode" };
      }
    }

    return { error: "OCO/OTO order-list cancel requires Binance SAPI; not available via CCXT adapter." };
  },
});

// ============================================================================
// Get Open Order Lists (OCO/OTO) (Binance-only)
// ============================================================================

export const getOpenOrderListsTool = createTool({
  id: "get_open_order_lists",
  description:
    "List all open OCO/OTO order lists. " +
    "Use when user asks 'show my OCO orders', 'open order lists', 'any active OCO orders?'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    count: z.number().optional(),
    orderLists: z.array(z.object({
      orderListId: z.number(),
      symbol: z.string(),
      status: z.string(),
      orders: z.array(z.object({
        orderId: z.number(),
      })),
    })).optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (_params, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    return { error: "Open OCO/OTO order lists require Binance SAPI; not available via CCXT adapter." };
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Orderbook tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 *
 * Caching strategy:
 * - get_order_book: 5 second TTL (highly dynamic)
 * - get_spread: 5 second TTL (highly dynamic)
 * - get_market_trades: 5 second TTL (real-time data)
 * - Order management tools are NOT cached (mutations)
 */
export const orderbookTools = {
  get_order_book: createCachedTool(getOrderBookTool, TOOL_CACHE_CONFIG.orderbook.ttl),
  get_spread: createCachedTool(getSpreadTool, TOOL_CACHE_CONFIG.orderbook.ttl),
  get_market_trades: createCachedTool(getRecentTradesTool, TOOL_CACHE_CONFIG.orderbook.ttl),
  // Order management tools are NOT cached (they are mutations)
  place_oco_order: placeOCOOrderTool,
  place_limit_order: placeLimitOrderTool,
  cancel_all_orders: cancelAllOrdersTool,
  cancel_order: cancelOrderTool,
  get_order_status: getOrderStatusTool,
  get_open_orders: getOpenOrdersTool,
  get_order_history: getOrderHistoryTool,
  test_order: testOrderTool,
  // Binance-only tools
  cancel_replace_order: cancelReplaceOrderTool,
  cancel_order_list: cancelOrderListTool,
  get_open_order_lists: getOpenOrderListsTool,
};

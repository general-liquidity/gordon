/**
 * Order Book & Advanced Trading Tools
 * Tools for liquidity analysis, OCO orders, and order management
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import type { ToolRunContext } from "./types.ts";
import { errors } from "./types.ts";

// ============================================================================
// Order Book / Liquidity Analysis
// ============================================================================

export const getOrderBookTool = tool({
  name: "get_order_book",
  description:
    "Get order book depth showing buy/sell walls and liquidity. " +
    "Use when user asks 'show order book', 'liquidity for BTC', 'buy/sell walls', 'market depth'.",
  parameters: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    limit: z.number().min(5).max(100).default(20).describe("Number of price levels to show"),
  }),
  async execute({ symbol, limit }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const orderBook = await ctx.binance.getOrderBook(normalizedSymbol, limit);

      // Calculate totals and find walls
      let bidTotal = 0;
      let askTotal = 0;
      const bids = orderBook.bids.slice(0, limit).map(([price, qty]) => {
        const quantity = parseFloat(qty);
        bidTotal += quantity;
        return { price: parseFloat(price), quantity, total: bidTotal };
      });

      const asks = orderBook.asks.slice(0, limit).map(([price, qty]) => {
        const quantity = parseFloat(qty);
        askTotal += quantity;
        return { price: parseFloat(price), quantity, total: askTotal };
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

export const getSpreadTool = tool({
  name: "get_spread",
  description:
    "Get the bid-ask spread for a trading pair. " +
    "Use when user asks 'what's the spread', 'slippage check', 'is liquidity good'.",
  parameters: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
  }),
  async execute({ symbol }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const spread = await ctx.binance.getSpread(normalizedSymbol);

      const assessment = spread.spreadPercent < 0.05
        ? "Excellent liquidity"
        : spread.spreadPercent < 0.1
          ? "Good liquidity"
          : spread.spreadPercent < 0.5
            ? "Moderate liquidity"
            : "Low liquidity - be cautious";

      return {
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

export const getRecentTradesTool = tool({
  name: "get_market_trades",
  description:
    "Get recent MARKET trades for a symbol (all traders, not just user's trades). " +
    "Shows real-time buy/sell activity and trade flow. " +
    "Use when user asks 'trade flow', 'who's buying/selling', 'market activity'. " +
    "NOTE: For USER's own trade history, use get_trade_history instead.",
  parameters: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    limit: z.number().min(1).max(100).default(20).describe("Number of trades to show"),
  }),
  async execute({ symbol, limit }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const trades = await ctx.binance.getRecentTrades(normalizedSymbol, limit);

      // Analyze trade flow
      let buyVolume = 0;
      let sellVolume = 0;

      for (const trade of trades) {
        const qty = parseFloat(trade.qty);
        if (trade.isBuyerMaker) {
          sellVolume += qty; // Taker was seller
        } else {
          buyVolume += qty; // Taker was buyer
        }
      }

      return {
        symbol: normalizedSymbol,
        analysis: {
          buyVolume: buyVolume.toFixed(4),
          sellVolume: sellVolume.toFixed(4),
          ratio: (buyVolume / sellVolume).toFixed(2),
          dominance: buyVolume > sellVolume ? "Buyers dominating" : "Sellers dominating",
        },
        trades: trades.slice(0, 10).map((t) => ({
          price: t.price,
          quantity: t.qty,
          value: (parseFloat(t.price) * parseFloat(t.qty)).toFixed(2) + " USDT",
          side: t.isBuyerMaker ? "SELL" : "BUY",
          time: new Date(t.time).toISOString(),
        })),
      };
    } catch (error) {
      return { error: `Failed to get recent trades: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// OCO Orders
// ============================================================================

export const placeOCOOrderTool = tool({
  name: "place_oco_order",
  description:
    "Place an OCO (One-Cancels-Other) order combining a limit order with a stop-loss. " +
    "When one triggers, the other is automatically cancelled. " +
    "Use for 'set stop loss and take profit', 'OCO order', 'bracket order'. " +
    "Requires ARMED mode.",
  parameters: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("Order side"),
    quantity: z.number().positive().describe("Quantity to trade"),
    price: z.number().positive().describe("Limit price (take profit)"),
    stopPrice: z.number().positive().describe("Stop trigger price"),
    stopLimitPrice: z.number().positive().optional().describe("Stop limit price (defaults to stopPrice)"),
  }),
  async execute({ symbol, side, quantity, price, stopPrice, stopLimitPrice }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    if (!ctx.config?.tradingMode?.armed) {
      return {
        error: "System must be ARMED to place OCO orders. Use 'arm' command first.",
        symbol,
        side,
        quantity,
        price,
        stopPrice,
      };
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const result = await ctx.binance.placeOCOOrder({
        symbol: normalizedSymbol,
        side,
        quantity,
        price,
        stopPrice,
        stopLimitPrice: stopLimitPrice ?? stopPrice,
      });

      return {
        success: true,
        message: `OCO order placed: ${side} ${quantity} ${normalizedSymbol}`,
        orderListId: result.orderListId,
        status: result.listOrderStatus,
        orders: result.orderReports.map((o) => ({
          orderId: o.orderId,
          type: o.type,
          price: o.price,
          status: o.status,
        })),
      };
    } catch (error) {
      return { error: `Failed to place OCO order: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Order Management
// ============================================================================

export const cancelAllOrdersTool = tool({
  name: "cancel_all_orders",
  description:
    "Cancel all open orders on a symbol. Emergency function. " +
    "Use when user says 'cancel all orders', 'cancel everything on BTC', 'emergency cancel'. " +
    "Requires ARMED mode.",
  parameters: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
  }),
  async execute({ symbol }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    if (!ctx.config?.tradingMode?.armed) {
      return {
        error: "System must be ARMED to cancel orders. Use 'arm' command first.",
        symbol,
      };
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const cancelled = await ctx.binance.cancelAllOrders(normalizedSymbol);

      return {
        success: true,
        message: `Cancelled ${cancelled.length} orders on ${normalizedSymbol}`,
        cancelledOrders: cancelled.map((o) => ({
          orderId: o.orderId,
          type: o.type,
          side: o.side,
          price: o.price,
          quantity: o.origQty,
        })),
      };
    } catch (error) {
      return { error: `Failed to cancel orders: ${(error as Error).message}` };
    }
  },
});

export const getOrderStatusTool = tool({
  name: "get_order_status",
  description:
    "Check the status of a specific order. " +
    "Use when user asks 'check order status', 'is my order filled', 'order #123'.",
  parameters: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    orderId: z.number().describe("Order ID to check"),
  }),
  async execute({ symbol, orderId }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const order = await ctx.binance.getOrderStatus(normalizedSymbol, orderId);

      return {
        orderId: order.orderId,
        symbol: order.symbol,
        status: order.status,
        type: order.type,
        side: order.side,
        price: order.price,
        quantity: order.origQty,
        filled: order.executedQty,
        remaining: (parseFloat(order.origQty) - parseFloat(order.executedQty)).toFixed(8),
        fillPercent: ((parseFloat(order.executedQty) / parseFloat(order.origQty)) * 100).toFixed(1) + "%",
        time: order.time ? new Date(order.time).toISOString() : undefined,
      };
    } catch (error) {
      return { error: `Failed to get order status: ${(error as Error).message}` };
    }
  },
});

export const testOrderTool = tool({
  name: "test_order",
  description:
    "Test if an order would be valid without actually placing it. " +
    "Use when user wants to 'validate order', 'test if order works', 'dry run'.",
  parameters: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("Order side"),
    type: z.enum(["LIMIT", "MARKET"]).describe("Order type"),
    quantity: z.number().positive().describe("Quantity to trade"),
    price: z.number().positive().optional().describe("Price (required for LIMIT orders)"),
  }),
  async execute({ symbol, side, type, quantity, price }, runContext: ToolRunContext) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const isValid = await ctx.binance.testOrder({
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

export const getMarketTradesTool = getRecentTradesTool; // Alias for clarity

export const orderbookTools = [
  getOrderBookTool,
  getSpreadTool,
  getRecentTradesTool,
  placeOCOOrderTool,
  cancelAllOrdersTool,
  getOrderStatusTool,
  testOrderTool,
];

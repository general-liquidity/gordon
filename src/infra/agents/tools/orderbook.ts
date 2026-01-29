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
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { GordonContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noBinance: { error: "Binance client not connected. Please run setup first." },
  notArmed: (action: string) => ({
    error: `System must be ARMED to ${action}. Use 'arm' command first.`,
  }),
};

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
    symbol: z.string(),
    spread: z.object({
      value: z.string(),
      percent: z.string(),
      bestBid: z.number(),
      bestAsk: z.number(),
    }),
    liquidity: z.object({
      bidDepth: z.string(),
      askDepth: z.string(),
      ratio: z.string(),
      imbalance: z.string(),
    }),
    walls: z.object({
      largestBid: z.object({
        price: z.number().optional(),
        quantity: z.number().optional(),
      }),
      largestAsk: z.object({
        price: z.number().optional(),
        quantity: z.number().optional(),
      }),
    }),
    topBids: z.array(z.object({
      price: z.number(),
      quantity: z.number(),
      total: z.number(),
    })),
    topAsks: z.array(z.object({
      price: z.number(),
      quantity: z.number(),
      total: z.number(),
    })),
    error: z.string().optional(),
  }),
  execute: async ({ context, symbol, limit }) => {
    const ctx = context as GordonContext;
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

export const getSpreadTool = createTool({
  id: "get_spread",
  description:
    "Get the bid-ask spread for a trading pair. " +
    "Use when user asks 'what's the spread', 'slippage check', 'is liquidity good'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    bidPrice: z.number(),
    askPrice: z.number(),
    spread: z.string(),
    spreadPercent: z.string(),
    assessment: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ context, symbol }) => {
    const ctx = context as GordonContext;
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
  execute: async ({ context, symbol, limit }) => {
    const ctx = context as GordonContext;
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
          side: t.isBuyerMaker ? "SELL" as const : "BUY" as const,
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

export const placeOCOOrderTool = createTool({
  id: "place_oco_order",
  description:
    "Place an OCO (One-Cancels-Other) order combining a limit order with a stop-loss. " +
    "When one triggers, the other is automatically cancelled. " +
    "Use for 'set stop loss and take profit', 'OCO order', 'bracket order'. " +
    "Requires ARMED mode.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("Order side"),
    quantity: z.number().positive().describe("Quantity to trade"),
    price: z.number().positive().describe("Limit price (take profit)"),
    stopPrice: z.number().positive().describe("Stop trigger price"),
    stopLimitPrice: z.number().default(0).describe("Stop limit price. Use 0 to default to stopPrice."),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    orderListId: z.number().optional(),
    status: z.string().optional(),
    orders: z.array(z.object({
      orderId: z.number(),
      type: z.string(),
      price: z.string(),
      status: z.string(),
    })).optional(),
    symbol: z.string().optional(),
    side: z.enum(["BUY", "SELL"]).optional(),
    quantity: z.number().optional(),
    stopPrice: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, symbol, side, quantity, price, stopPrice, stopLimitPrice }) => {
    const ctx = context as GordonContext;
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

export const cancelAllOrdersTool = createTool({
  id: "cancel_all_orders",
  description:
    "Cancel all open orders on a symbol. Emergency function. " +
    "Use when user says 'cancel all orders', 'cancel everything on BTC', 'emergency cancel'. " +
    "Requires ARMED mode.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
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
  execute: async ({ context, symbol }) => {
    const ctx = context as GordonContext;
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
  execute: async ({ context, symbol, orderId }) => {
    const ctx = context as GordonContext;
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
    valid: z.boolean(),
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
  execute: async ({ context, symbol, side, type, quantity, price }) => {
    const ctx = context as GordonContext;
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

// Alias for clarity
export const getMarketTradesTool = getRecentTradesTool;

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Orderbook tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const orderbookTools = {
  get_order_book: getOrderBookTool,
  get_spread: getSpreadTool,
  get_market_trades: getRecentTradesTool,
  place_oco_order: placeOCOOrderTool,
  cancel_all_orders: cancelAllOrdersTool,
  get_order_status: getOrderStatusTool,
  test_order: testOrderTool,
};

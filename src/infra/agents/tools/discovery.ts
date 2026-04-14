/**
 * Market Discovery Tools (Mastra Format)
 * Tools for finding trading opportunities, trending tokens, and market analysis
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key differences:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Added outputSchema for better LLM routing
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { checkTradingPermission } from "./permissionHelpers.ts";
import { runHooks } from "../../hooks/engine.ts";

import { formatActionPlanMarkdown, planActionExecution } from "../../runtime/actions/runtime.ts";
import { normalizeCryptoSymbol, resolveInstrument } from "../../domain/markets/instruments.ts";
import { recordStructuredObservation } from "../../platform/observability/index.ts";
import { getGordonContext, type MastraExecutionContext } from "./types.ts";
import type { ExchangeExtended } from "../../exchange/types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "No active trading venue is connected. Please run setup first." },
};

const marketOrderPlanOutputSchema = z.object({
  ready: z.boolean(),
  summary: z.string(),
  blockers: z.array(z.string()),
  preview: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

const cryptoDiscoveryCapabilitySchema = z.object({
  supportsQuotes: z.boolean(),
  supportsBidAsk: z.boolean(),
  supportsOrderBook: z.boolean(),
  supportsSessionCalendar: z.boolean(),
  supportsExtendedHours: z.boolean(),
  supportsHistoricalBars: z.boolean(),
});

// ============================================================================
// Trending Tokens Tool
// ============================================================================

export const getTrendingTokensTool = createTool({
  id: "get_trending_tokens",
  description:
    "Find tokens with the highest price changes in the last 24 hours. " +
    "Use when user asks 'what's trending', 'biggest movers', 'what's pumping', 'hot coins'.",
  inputSchema: z.object({
    minVolume: z
      .number()
      .min(0)
      .default(1000000)
      .describe("Minimum 24h volume in USDT (default: 1M)"),
    minPriceChange: z
      .number()
      .min(0)
      .default(5)
      .describe("Minimum absolute price change % (default: 5%)"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Max results to return"),
    direction: z
      .enum(["gainers", "losers", "both"])
      .default("gainers")
      .describe("Filter by price direction"),
  }),
  outputSchema: z.object({
    marketFamily: z.enum(["crypto", "stocks"]).optional(),
    venueRoute: z.enum(["exchange", "broker"]).optional(),
    capabilities: cryptoDiscoveryCapabilitySchema.optional(),
    direction: z.string().optional(),
    filters: z.object({
      minVolume: z.number(),
      minPriceChange: z.number(),
    }).optional(),
    count: z.number().optional(),
    tokens: z.array(z.object({
      rank: z.number(),
      symbol: z.string(),
      price: z.string(),
      change24h: z.string(),
      volume24h: z.string(),
      high24h: z.number(),
      low24h: z.number(),
    })).optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ minVolume, minPriceChange, limit, direction }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (ctx?.broker && !ctx?.exchange) {
      return {
        marketFamily: "stocks" as const,
        venueRoute: "broker" as const,
        error: "Trending token discovery requires a crypto venue with 24h ticker coverage. Use /analyze <ticker> for stock-specific workflows.",
      };
    }
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    try {
      const tickers = await ctx.exchange.get24hrTickers();

      // Skip leveraged tokens and stablecoins
      const skipPatterns = ["UP", "DOWN", "BEAR", "BULL", "USDC", "BUSD", "TUSD", "USDP", "FDUSD", "DAI"];

      const filtered = tickers
        .filter((t) => {
          // Only USDT pairs
          if (!t.symbol.endsWith("USDT")) return false;

          // Skip leveraged tokens and stablecoins
          const base = t.symbol.replace("USDT", "");
          if (skipPatterns.some((p) => base.includes(p))) return false;

          const volume = t.quoteVolume;
          const priceChange = t.priceChangePercent;

          // Volume filter
          if (volume < minVolume) return false;

          // Price change filter based on direction
          if (direction === "gainers" && priceChange < minPriceChange) return false;
          if (direction === "losers" && priceChange > -minPriceChange) return false;
          if (direction === "both" && Math.abs(priceChange) < minPriceChange) return false;

          return true;
        })
        .map((t) => ({
          symbol: t.symbol,
          price: t.lastPrice,
          priceChange24h: t.priceChange,
          priceChangePercent: t.priceChangePercent,
          volume24h: t.quoteVolume,
          high24h: t.highPrice,
          low24h: t.lowPrice,
        }))
        .sort((a, b) => {
          if (direction === "losers") {
            return a.priceChangePercent - b.priceChangePercent;
          }
          return b.priceChangePercent - a.priceChangePercent;
        })
        .slice(0, limit);

      if (filtered.length === 0) {
        return {
          marketFamily: "crypto" as const,
          venueRoute: "exchange" as const,
          capabilities: {
            supportsQuotes: true,
            supportsBidAsk: true,
            supportsOrderBook: true,
            supportsSessionCalendar: false,
            supportsExtendedHours: false,
            supportsHistoricalBars: true,
          },
          message: `No tokens found matching criteria (min volume: ${minVolume}, min change: ${minPriceChange}%)`,
          tokens: [],
        };
      }

      return {
        marketFamily: "crypto" as const,
        venueRoute: "exchange" as const,
        capabilities: {
          supportsQuotes: true,
          supportsBidAsk: true,
          supportsOrderBook: true,
          supportsSessionCalendar: false,
          supportsExtendedHours: false,
          supportsHistoricalBars: true,
        },
        direction,
        filters: { minVolume, minPriceChange },
        count: filtered.length,
        tokens: filtered.map((t, i) => ({
          rank: i + 1,
          symbol: t.symbol,
          price: t.price.toFixed(8).replace(/\.?0+$/, ""),
          change24h: `${t.priceChangePercent >= 0 ? "+" : ""}${t.priceChangePercent.toFixed(2)}%`,
          volume24h: `$${(t.volume24h / 1000000).toFixed(2)}M`,
          high24h: t.high24h,
          low24h: t.low24h,
        })),
      };
    } catch (error) {
      return { error: `Failed to get trending tokens: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// High Volume Tokens Tool
// ============================================================================

export const getHighVolumeTokensTool = createTool({
  id: "get_high_volume_tokens",
  description:
    "Find the most liquid tokens by 24h trading volume. " +
    "Use when user asks 'most traded', 'highest volume', 'liquid markets', 'active pairs'.",
  inputSchema: z.object({
    minVolume: z
      .number()
      .min(0)
      .default(10000000)
      .describe("Minimum 24h volume in USDT (default: 10M)"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Max results to return"),
  }),
  outputSchema: z.object({
    marketFamily: z.enum(["crypto", "stocks"]).optional(),
    venueRoute: z.enum(["exchange", "broker"]).optional(),
    capabilities: cryptoDiscoveryCapabilitySchema.optional(),
    minVolume: z.string().optional(),
    count: z.number().optional(),
    tokens: z.array(z.object({
      rank: z.number(),
      symbol: z.string(),
      price: z.string(),
      volume24h: z.string(),
      change24h: z.string(),
      trades24h: z.string(),
    })).optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ minVolume, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (ctx?.broker && !ctx?.exchange) {
      return {
        marketFamily: "stocks" as const,
        venueRoute: "broker" as const,
        error: "High-volume token discovery requires a crypto venue with market-wide ticker coverage. Use /analyze <ticker> for stock-specific workflows.",
      };
    }
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    try {
      const tickers = await ctx.exchange.get24hrTickers();

      // Skip leveraged tokens
      const skipPatterns = ["UP", "DOWN", "BEAR", "BULL"];

      const filtered = tickers
        .filter((t) => {
          if (!t.symbol.endsWith("USDT")) return false;
          const base = t.symbol.replace("USDT", "");
          if (skipPatterns.some((p) => base.includes(p))) return false;

          const volume = t.quoteVolume;
          return volume >= minVolume;
        })
        .map((t) => ({
          symbol: t.symbol,
          price: t.lastPrice,
          priceChangePercent: t.priceChangePercent,
          volume24h: t.quoteVolume,
          high24h: t.highPrice,
          low24h: t.lowPrice,
        }))
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, limit);

      if (filtered.length === 0) {
        return {
          marketFamily: "crypto" as const,
          venueRoute: "exchange" as const,
          capabilities: {
            supportsQuotes: true,
            supportsBidAsk: true,
            supportsOrderBook: true,
            supportsSessionCalendar: false,
            supportsExtendedHours: false,
            supportsHistoricalBars: true,
          },
          message: `No tokens found with volume above $${(minVolume / 1000000).toFixed(1)}M`,
          tokens: [],
        };
      }

      return {
        marketFamily: "crypto" as const,
        venueRoute: "exchange" as const,
        capabilities: {
          supportsQuotes: true,
          supportsBidAsk: true,
          supportsOrderBook: true,
          supportsSessionCalendar: false,
          supportsExtendedHours: false,
          supportsHistoricalBars: true,
        },
        minVolume: `$${(minVolume / 1000000).toFixed(1)}M`,
        count: filtered.length,
        tokens: filtered.map((t, i) => ({
          rank: i + 1,
          symbol: t.symbol,
          price: t.price.toFixed(8).replace(/\.?0+$/, ""),
          volume24h: `$${(t.volume24h / 1000000).toFixed(2)}M`,
          change24h: `${t.priceChangePercent >= 0 ? "+" : ""}${t.priceChangePercent.toFixed(2)}%`,
          trades24h: "N/A",
        })),
      };
    } catch (error) {
      return { error: `Failed to get high volume tokens: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Available Markets Tool
// ============================================================================

export const getAvailableMarketsTool = createTool({
  id: "get_available_markets",
  description:
    "List available trading pairs on the active exchange with optional filters. " +
    "Use when user asks 'what pairs are available', 'can I trade X', 'list markets for ETH'.",
  inputSchema: z.object({
    baseAsset: z
      .string()
      .default("")
      .describe("Filter by base asset (e.g., 'BTC', 'ETH'). Empty for all."),
    quoteAsset: z
      .string()
      .default("")
      .describe("Filter by quote asset (e.g., 'USDT', 'BTC'). Empty for all."),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Max results to return"),
  }),
  outputSchema: z.object({
    filters: z.object({
      baseAsset: z.string(),
      quoteAsset: z.string(),
    }).optional(),
    totalAvailable: z.number().optional(),
    showing: z.number().optional(),
    markets: z.array(z.object({
      symbol: z.string(),
      baseAsset: z.string(),
      quoteAsset: z.string(),
      tickSize: z.string(),
      minQty: z.string(),
      stepSize: z.string(),
      minNotional: z.string(),
    })).optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ baseAsset, quoteAsset, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    try {
      const exchangeInfo = await ctx.exchange.getExchangeInfo();

      let symbols = exchangeInfo.symbols.filter((s) => s.status === "TRADING" && s.isSpotTradingAllowed);

      // Apply filters
      if (baseAsset) {
        const base = baseAsset.toUpperCase();
        symbols = symbols.filter((s) => s.baseAsset === base);
      }
      if (quoteAsset) {
        const quote = quoteAsset.toUpperCase();
        symbols = symbols.filter((s) => s.quoteAsset === quote);
      }

      // Get price filter info for each symbol
      const markets = symbols.slice(0, limit).map((s) => {
        const priceFilter = s.filters.find((f) => f.filterType === "PRICE_FILTER") as { tickSize?: string } | undefined;
        const lotFilter = s.filters.find((f) => f.filterType === "LOT_SIZE") as { minQty?: string; stepSize?: string } | undefined;
        const notionalFilter = s.filters.find((f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL") as { minNotional?: string; notional?: string } | undefined;

        return {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          tickSize: priceFilter?.tickSize ?? "N/A",
          minQty: lotFilter?.minQty ?? "N/A",
          stepSize: lotFilter?.stepSize ?? "N/A",
          minNotional: notionalFilter?.minNotional ?? notionalFilter?.notional ?? "N/A",
        };
      });

      if (markets.length === 0) {
        return {
          message: "No trading pairs found matching the criteria.",
          filters: { baseAsset: baseAsset || "any", quoteAsset: quoteAsset || "any" },
          markets: [],
        };
      }

      return {
        filters: { baseAsset: baseAsset || "any", quoteAsset: quoteAsset || "any" },
        totalAvailable: symbols.length,
        showing: markets.length,
        markets,
      };
    } catch (error) {
      return { error: `Failed to get available markets: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Bracket Order Tool
// ============================================================================

export const placeBracketOrderTool = createTool({
  id: "place_bracket_order",
  description:
    "Place a bracket order: market entry with automatic stop-loss and take-profit. " +
    "Use when user says 'buy BTC with stop loss and take profit', 'bracket order', 'entry with SL and TP'. " +
    "Requires permissionMode not 'strict'. Places market order then OCO for exits.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("Entry side"),
    quantity: z.number().positive().describe("Quantity to trade"),
    stopLossPrice: z.number().positive().describe("Stop loss price"),
    takeProfitPrice: z.number().positive().describe("Take profit price"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    entry: z.object({
      orderId: z.number(),
      status: z.string(),
      filledQty: z.number(),
      avgPrice: z.number(),
    }).optional(),
    exits: z.object({
      ocoOrderListId: z.number(),
      status: z.string(),
      takeProfit: z.number(),
      stopLoss: z.number(),
      orders: z.array(z.object({
        orderId: z.number(),
      })),
    }).optional(),
    symbol: z.string().optional(),
    side: z.string().optional(),
    quantity: z.number().optional(),
    stopLossPrice: z.number().optional(),
    takeProfitPrice: z.number().optional(),
    error: z.string().optional(),
    entryOrder: z.object({
      orderId: z.number(),
      symbol: z.string(),
      status: z.string(),
      executedQty: z.string(),
      cummulativeQuoteQty: z.string(),
    }).passthrough().optional(),
  }),
  execute: async ({ symbol, side, quantity, stopLossPrice, takeProfitPrice }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    {
      const check = checkTradingPermission(ctx.config?.permissionMode, "execute");
      if (!check.allowed) {
        return {
          error: check.reason ?? "Placing bracket orders not permitted under current mode",
          symbol,
          side,
          quantity,
          stopLossPrice,
          takeProfitPrice,
        };
      }
    }

    const normalizedSymbol = normalizeCryptoSymbol(symbol);

    // Risk gate: evaluate order before placement
    try {
      const { evaluateOrderRisk } = await import("./risk-gate.ts");
      const riskResult = await evaluateOrderRisk(
        { symbol: normalizedSymbol, side, type: "MARKET", quantity, price: undefined },
        ctx,
        "executor"
      );
      if (!riskResult.approved) {
        return { error: `Risk check rejected: ${riskResult.reason}`, symbol, side, quantity, stopLossPrice, takeProfitPrice };
      }
      // Use risk-adjusted quantity if modified
      if (riskResult.quantity !== quantity) {
        quantity = riskResult.quantity;
      }
    } catch (riskErr) {
      return {
        error: `Risk check failed for bracket order: ${riskErr instanceof Error ? riskErr.message : String(riskErr)}`,
      };
    }

    try {
      // Validate prices make sense
      if (side === "BUY") {
        if (takeProfitPrice <= stopLossPrice) {
          return { error: "For BUY orders, take profit must be higher than stop loss." };
        }
      } else {
        if (takeProfitPrice >= stopLossPrice) {
          return { error: "For SELL orders, take profit must be lower than stop loss." };
        }
      }

      // Step 1: Place market entry order
      const entryOrder = await ctx.exchange.placeOrder({
        symbol: normalizedSymbol,
        side,
        type: "MARKET",
        quantity,
      });

      if (!entryOrder || entryOrder.status === "REJECTED") {
        return {
          error: "Entry order was rejected",
          entryOrder: {
            orderId: Number(entryOrder?.orderId) || 0,
            symbol: entryOrder?.symbol ?? normalizedSymbol,
            status: entryOrder?.status ?? "REJECTED",
            executedQty: String(entryOrder?.executedQty ?? 0),
            cummulativeQuoteQty: String(entryOrder?.cummulativeQuoteQty ?? 0),
          },
        };
      }

      // Step 2: Place OCO order for stop-loss and take-profit
      const exitSide = side === "BUY" ? "SELL" : "BUY";
      const filledQty = entryOrder.executedQty;

      if (filledQty <= 0) {
        return {
          error: "Entry order did not fill",
          entryOrder: {
            orderId: Number(entryOrder.orderId) || 0,
            symbol: entryOrder.symbol,
            status: entryOrder.status,
            executedQty: String(entryOrder.executedQty),
            cummulativeQuoteQty: String(entryOrder.cummulativeQuoteQty),
          },
        };
      }

      // For OCO: price = limit/take-profit, stopPrice = stop trigger, stopLimitPrice = stop limit
      const exchangeWithOco = ctx.exchange as ExchangeExtended;
      if (!exchangeWithOco.placeOCOOrder) {
        return { error: "OCO orders are not supported on this exchange." };
      }

      const ocoOrder = await exchangeWithOco.placeOCOOrder({
        symbol: normalizedSymbol,
        side: exitSide,
        quantity: filledQty,
        price: takeProfitPrice, // Take profit limit price
        stopPrice: stopLossPrice, // Stop loss trigger price
        stopLimitPrice: stopLossPrice, // Stop loss limit price (same as trigger for immediate fill)
      });

      const avgFillPrice = entryOrder.cummulativeQuoteQty / filledQty;

      return {
        success: true,
        message: `Bracket order placed: ${side} ${filledQty} ${normalizedSymbol} @ ${avgFillPrice.toFixed(8)}`,
        entry: {
          orderId: Number(entryOrder.orderId) || 0,
          status: entryOrder.status,
          filledQty,
          avgPrice: avgFillPrice,
        },
        exits: {
          ocoOrderListId: ocoOrder.orderListId,
          status: "PLACED",
          takeProfit: takeProfitPrice,
          stopLoss: stopLossPrice,
          orders: ocoOrder.orders.map((o) => ({
            orderId: Number(o.orderId) || 0,
          })),
        },
      };
    } catch (error) {
      return { error: `Failed to place bracket order: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Simple Market Order Tool
// ============================================================================

export const placeMarketOrderTool = createTool({
  id: "place_market_order",
  description:
    "Place a simple spot market order (buy or sell) without stop-loss or take-profit. " +
    "Use when user says 'buy USDT with my USDC', 'swap USDC to USDT', 'sell 100 BTC', " +
    "'buy $50 worth of ETH', or any simple spot conversion/purchase. " +
    "Requires permissionMode not 'strict'. Supports spending a quote amount (e.g., 'spend 54 USDC') " +
    "or selling a base quantity (e.g., 'sell 0.01 BTC').",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'USDCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("BUY or SELL"),
    quantity: z.number().positive().optional().describe("Quantity of the base asset to trade (e.g., 0.5 BTC). Use this OR quoteOrderQty, not both."),
    quoteOrderQty: z.number().positive().optional().describe("Amount of quote asset to spend (e.g., 54 USDC). Use this OR quantity, not both."),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    order: z.object({
      orderId: z.number(),
      symbol: z.string(),
      side: z.string(),
      status: z.string(),
      executedQty: z.number(),
      cummulativeQuoteQty: z.number(),
      avgPrice: z.number(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, side, quantity, quoteOrderQty }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange && !ctx?.broker) {
      return errors.noExchange;
    }
    const plan = await planActionExecution("trading.market_order", { symbol, side, quantity, quoteOrderQty }, ctx);
    if (!plan.ready) {
      return {
        error: formatActionPlanMarkdown(plan),
      };
    }

    const instrument = await resolveInstrument(ctx, symbol);
    const normalizedSymbol = typeof plan.preview?.symbol === "string"
      ? String(plan.preview.symbol)
      : instrument.normalizedSymbol;

    // Permission gate — blocks strict/observe/plan/paper for real execution
    {
      const check = checkTradingPermission(ctx.config?.permissionMode, "execute");
      if (!check.allowed) {
        return { error: check.reason ?? "Market order not permitted under current mode" };
      }
    }

    // Risk gate: evaluate order before placement (crypto execution only today)
    if (instrument.route === "exchange" && quantity && quantity > 0) {
      try {
        const { evaluateOrderRisk } = await import("./risk-gate.ts");
        const riskResult = await evaluateOrderRisk(
          { symbol: normalizedSymbol, side, type: "MARKET", quantity },
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
          error: `Risk check failed for market order: ${riskErr instanceof Error ? riskErr.message : String(riskErr)}`,
        };
      }
    }

    // PreOrderPlacement hook — can block or modify the order
    {
      const preHook = await runHooks("PreOrderPlacement", {
        symbol: normalizedSymbol,
        side: side.toLowerCase() === "sell" ? "sell" : "buy",
        quantity: quantity ?? 0,
        orderType: "MARKET",
        notionalUsd: quoteOrderQty ?? 0,
        exchangeId: ctx.exchange?.exchangeId ?? ctx.broker?.brokerId,
      });
      if (preHook.action === "block") {
        return { error: `PreOrderPlacement hook blocked: ${preHook.reason}` };
      }
    }

    try {
      if (instrument.route === "broker" && ctx.broker) {
        const orderResult = await ctx.broker.placeOrder({
          symbol: normalizedSymbol,
          side: side.toLowerCase() as "buy" | "sell",
          type: "market",
          timeInForce: "day",
          ...(quantity ? { qty: quantity } : {}),
          ...(quoteOrderQty ? { notional: quoteOrderQty } : {}),
        });

        return {
          success: true,
          message: `${side} ${orderResult.qty || quantity || 0} ${normalizedSymbol} via ${ctx.broker.displayName} — status: ${orderResult.status}`,
          order: {
            orderId: Number(orderResult.id) || 0,
            symbol: orderResult.symbol,
            side: orderResult.side.toUpperCase(),
            status: orderResult.status,
            executedQty: orderResult.filledQty,
            cummulativeQuoteQty: orderResult.notional ?? 0,
            avgPrice: orderResult.limitPrice ?? 0,
          },
        };
      }

      if (!ctx.exchange) {
        return {
          success: false,
          error: "No active crypto execution venue is connected.",
        };
      }

      const orderResult = await ctx.exchange.placeOrder({
        symbol: normalizedSymbol,
        side,
        type: "MARKET",
        ...(quantity ? { quantity } : {}),
        ...(quoteOrderQty ? { quoteOrderQty } : {}),
      });

      if (!orderResult || orderResult.status === "REJECTED") {
        return {
          success: false,
          error: `Order rejected: ${orderResult?.status ?? "unknown"}`,
        };
      }

      const executedQty = orderResult.executedQty;
      const quoteQty = orderResult.cummulativeQuoteQty;
      const avgPrice = executedQty > 0 ? quoteQty / executedQty : 0;

      // PostOrderPlacement hook — fire-and-forget audit
      runHooks("PostOrderPlacement", {
        orderId: String(orderResult.orderId ?? ""),
        symbol: orderResult.symbol ?? normalizedSymbol,
        side: side.toLowerCase() === "sell" ? "sell" : "buy",
        status: orderResult.status ?? "unknown",
        filledQty: executedQty,
        notionalUsd: quoteQty,
      }).catch(() => {});

      return {
        success: true,
        message: `${side} ${executedQty} ${normalizedSymbol} at avg price ${avgPrice.toFixed(8).replace(/\.?0+$/, "")} (total: ${quoteQty.toFixed(2)} quote)`,
        order: {
          orderId: Number(orderResult.orderId) || 0,
          symbol: orderResult.symbol,
          side: orderResult.side,
          status: orderResult.status,
          executedQty,
          cummulativeQuoteQty: quoteQty,
          avgPrice,
        },
      };
    } catch (error) {
      return { error: `Failed to place market order: ${(error as Error).message}` };
    }
  },
});

export const previewMarketOrderTool = createTool({
  id: "preview_market_order",
  description:
    "Preview a spot market order without placing it. " +
    "Use before live execution to inspect readiness, live price estimates, account blockers, and permissionMode requirements.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("BUY or SELL"),
    quantity: z.number().positive().optional().describe("Base asset quantity to trade"),
    quoteOrderQty: z.number().positive().optional().describe("Quote asset amount to spend"),
  }),
  outputSchema: marketOrderPlanOutputSchema,
  execute: async ({ symbol, side, quantity, quoteOrderQty }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    const normalizedSymbol = normalizeCryptoSymbol(symbol);
    if (!ctx) {
      recordStructuredObservation({
        eventType: "execution.preview_failed",
        workflow: "execution",
        source: "agent_tool",
        component: "preview_market_order",
        toolName: "preview_market_order",
        outcome: "failure",
        status: "context_missing",
        symbol: normalizedSymbol,
        reason: "Context not available.",
        details: {
          side,
        },
      });
      return { error: "Context not available.", ready: false, summary: "Context not available.", blockers: ["Context not available."] };
    }

    try {
      const plan = await planActionExecution("trading.preview_market_order", { symbol, side, quantity, quoteOrderQty }, ctx);
      const previewDetails = plan.preview && typeof plan.preview === "object"
        ? plan.preview as Record<string, unknown>
        : undefined;
      const venue = typeof previewDetails?.venue === "string"
        ? previewDetails.venue
        : ctx.exchange?.exchangeId ?? ctx.broker?.brokerId;

      recordStructuredObservation({
        eventType: plan.ready ? "execution.preview_generated" : "execution.preview_blocked",
        workflow: "execution",
        source: "agent_tool",
        component: "preview_market_order",
        toolName: "preview_market_order",
        outcome: plan.ready ? "success" : "failure",
        status: plan.ready ? "ready" : "blocked",
        symbol: normalizedSymbol,
        mode: ctx.config?.permissionMode,
        exchange: ctx.exchange?.exchangeId,
        broker: ctx.broker?.brokerId,
        venue,
        ready: plan.ready,
        blockerCount: plan.blockers.length,
        reason: plan.blockers[0],
        details: {
          side,
          quantityProvided: quantity != null,
          quoteOrderQtyProvided: quoteOrderQty != null,
          blockers: plan.blockers,
          preview: previewDetails,
        },
      });

      return {
        ready: plan.ready,
        summary: formatActionPlanMarkdown(plan),
        blockers: plan.blockers,
        preview: plan.preview,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordStructuredObservation({
        eventType: "execution.preview_failed",
        workflow: "execution",
        source: "agent_tool",
        component: "preview_market_order",
        toolName: "preview_market_order",
        outcome: "failure",
        status: "error",
        symbol: normalizedSymbol,
        mode: ctx.config?.permissionMode,
        exchange: ctx.exchange?.exchangeId,
        broker: ctx.broker?.brokerId,
        reason: message,
        details: {
          side,
          quantityProvided: quantity != null,
          quoteOrderQtyProvided: quoteOrderQty != null,
        },
      });
      return {
        ready: false,
        summary: "Unable to build order preview.",
        blockers: [message],
        error: message,
      };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Discovery tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const discoveryTools = {
  get_trending_tokens: getTrendingTokensTool,
  get_high_volume_tokens: getHighVolumeTokensTool,
  get_available_markets: getAvailableMarketsTool,
  place_bracket_order: placeBracketOrderTool,
  preview_market_order: previewMarketOrderTool,
  place_market_order: placeMarketOrderTool,
};

/**
 * Market Analysis Tools (Mastra Format)
 *
 * Advanced market analysis tools including:
 * - Whale order detection
 * - Breakout/breakdown scanning
 * - Consolidation detection
 * - Multi-factor market scoring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  WhaleDetector,
  BreakoutDetector,
  ConsolidationDetector,
  MarketScorer,
  type OrderBookEntry,
} from "../../../../core/market-analysis/index.ts";
import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please configure an active exchange." },
};

// ============================================================================
// Whale Detection Tool
// ============================================================================

export const analyzeWhaleOrdersTool = createTool({
  id: "analyze_whale_orders",
  description:
    "Analyze orderbook to detect whale orders (large orders) and determine market bias. " +
    "Use when user asks about 'whale activity', 'big orders', 'smart money', 'large positions'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    whaleThresholdUsd: z
      .number()
      .default(50000)
      .describe("Minimum USD value to consider a whale order (default: $50,000)"),
    depthLimit: z
      .number()
      .default(100)
      .describe("Number of orderbook levels to analyze"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    bias: z.enum(["bullish", "bearish", "neutral"]).optional(),
    strength: z.number().optional(),
    whaleBidsValue: z.number().optional(),
    whaleAsksValue: z.number().optional(),
    whaleBidsCount: z.number().optional(),
    whaleAsksCount: z.number().optional(),
    totalWhaleValue: z.number().optional(),
    largestBid: z.object({
      price: z.number(),
      quantity: z.number(),
      value: z.number(),
    }).nullable().optional(),
    largestAsk: z.object({
      price: z.number(),
      quantity: z.number(),
      value: z.number(),
    }).nullable().optional(),
    depthAnalysis: z.object({
      bidDepth: z.number(),
      askDepth: z.number(),
      depthImbalance: z.number(),
      bidAskRatio: z.number(),
    }).optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, whaleThresholdUsd, depthLimit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const orderBook = await ctx.exchange.getOrderBook(normalizedSymbol, depthLimit);

      // Convert to OrderBookEntry format
      const bids: OrderBookEntry[] = orderBook.bids.map((entry) => ({
        price: entry.price,
        quantity: entry.quantity,
      }));

      const asks: OrderBookEntry[] = orderBook.asks.map((entry) => ({
        price: entry.price,
        quantity: entry.quantity,
      }));

      const currentPrice = await ctx.exchange.getPrice(normalizedSymbol);

      const detector = new WhaleDetector(whaleThresholdUsd);
      const whaleAnalysis = detector.analyzeWhaleOrders(bids, asks, currentPrice);
      const depthAnalysis = detector.calculateDepth(bids, asks, 20);

      // Generate interpretation
      let interpretation = "";
      if (whaleAnalysis.bias === "bullish") {
        interpretation = `Bullish whale activity detected. ${whaleAnalysis.whaleBidsCount} whale bids totaling $${(whaleAnalysis.whaleBidsValue / 1000).toFixed(0)}K vs ${whaleAnalysis.whaleAsksCount} whale asks totaling $${(whaleAnalysis.whaleAsksValue / 1000).toFixed(0)}K. Smart money appears to be accumulating.`;
      } else if (whaleAnalysis.bias === "bearish") {
        interpretation = `Bearish whale activity detected. ${whaleAnalysis.whaleAsksCount} whale asks totaling $${(whaleAnalysis.whaleAsksValue / 1000).toFixed(0)}K vs ${whaleAnalysis.whaleBidsCount} whale bids totaling $${(whaleAnalysis.whaleBidsValue / 1000).toFixed(0)}K. Smart money appears to be distributing.`;
      } else {
        interpretation = `Neutral whale activity. No significant imbalance in large orders.`;
      }

      if (depthAnalysis.depthImbalance > 0.3) {
        interpretation += ` Order book depth favors buyers (${(depthAnalysis.bidAskRatio).toFixed(2)}:1 ratio).`;
      } else if (depthAnalysis.depthImbalance < -0.3) {
        interpretation += ` Order book depth favors sellers (1:${(1/depthAnalysis.bidAskRatio).toFixed(2)} ratio).`;
      }

      return {
        symbol: normalizedSymbol,
        ...whaleAnalysis,
        depthAnalysis,
        interpretation,
      };
    } catch (error) {
      return { error: `Failed to analyze whale orders: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Market Impact Estimation Tool
// ============================================================================

export const estimateMarketImpactTool = createTool({
  id: "estimate_market_impact",
  description:
    "Estimate slippage and market impact for a trade of a given size. " +
    "Use when user asks about 'slippage', 'market impact', 'can I fill X without moving price'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    orderSizeUsd: z.number().positive().describe("Size of order in USD"),
    side: z.enum(["BUY", "SELL"]).default("BUY").describe("Order side"),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    orderSizeUsd: z.number(),
    side: z.enum(["BUY", "SELL"]),
    bestPrice: z.number(),
    impactPrice: z.number(),
    slippagePercent: z.number(),
    levelsConsumed: z.number(),
    fillPercentage: z.number(),
    interpretation: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, orderSizeUsd, side }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const orderBook = await ctx.exchange.getOrderBook(normalizedSymbol, 100);

      const bids: OrderBookEntry[] = orderBook.bids.map((entry) => ({
        price: entry.price,
        quantity: entry.quantity,
      }));

      const asks: OrderBookEntry[] = orderBook.asks.map((entry) => ({
        price: entry.price,
        quantity: entry.quantity,
      }));

      const detector = new WhaleDetector();
      const impact = detector.estimateMarketImpact(bids, asks, orderSizeUsd, side);

      let interpretation = "";
      if (impact.slippagePercent < 0.1) {
        interpretation = `Excellent liquidity. Your $${orderSizeUsd.toLocaleString()} ${side} order would fill with minimal slippage (${impact.slippagePercent.toFixed(3)}%).`;
      } else if (impact.slippagePercent < 0.5) {
        interpretation = `Good liquidity. Your order would fill with ${impact.slippagePercent.toFixed(2)}% slippage across ${impact.levelsConsumed} price levels.`;
      } else if (impact.slippagePercent < 1.0) {
        interpretation = `Moderate slippage expected (${impact.slippagePercent.toFixed(2)}%). Consider splitting the order or using limit orders.`;
      } else {
        interpretation = `High slippage warning! ${impact.slippagePercent.toFixed(2)}% slippage expected. Order consumes ${impact.levelsConsumed} levels. Strongly recommend splitting order.`;
      }

      if (impact.fillPercentage < 1.0) {
        interpretation += ` Note: Only ${(impact.fillPercentage * 100).toFixed(0)}% of order can be filled with available liquidity.`;
      }

      return {
        symbol: normalizedSymbol,
        orderSizeUsd,
        side,
        ...impact,
        interpretation,
      };
    } catch (error) {
      return { error: `Failed to estimate market impact: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Breakout Detection Tool
// ============================================================================

export const scanBreakoutsTool = createTool({
  id: "scan_breakouts",
  description:
    "Scan a symbol for breakouts above resistance or breakdowns below support. " +
    "Use when user asks about 'breakout', 'breakdown', 'support break', 'resistance break'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    timeframe: z.enum(["15m", "1h", "4h", "1d"]).default("1h").describe("Timeframe for analysis"),
    lookbackBars: z.number().default(289).describe("Number of bars for S/R calculation"),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    breakout: z.boolean(),
    breakdown: z.boolean(),
    support: z.number(),
    resistance: z.number(),
    currentPrice: z.number(),
    breakoutPrice: z.number().nullable(),
    breakdownPrice: z.number().nullable(),
    distanceToResistance: z.number(),
    distanceToSupport: z.number(),
    interpretation: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, timeframe, lookbackBars }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, timeframe, lookbackBars + 10);
      const spread = await ctx.exchange.getSpread(normalizedSymbol);

      const detector = new BreakoutDetector(lookbackBars);
      const result = detector.scanBreakout(
        normalizedSymbol,
        candles,
        spread.bidPrice,
        spread.askPrice
      );

      let interpretation = "";
      if (result.breakout) {
        interpretation = `🚀 BREAKOUT DETECTED! ${normalizedSymbol} has broken above resistance at $${result.resistance.toFixed(2)}. Current price: $${result.currentPrice.toFixed(2)}. Entry zone: $${result.breakoutPrice?.toFixed(2)} (retest of broken resistance).`;
      } else if (result.breakdown) {
        interpretation = `📉 BREAKDOWN DETECTED! ${normalizedSymbol} has broken below support at $${result.support.toFixed(2)}. Current price: $${result.currentPrice.toFixed(2)}. Entry zone: $${result.breakdownPrice?.toFixed(2)} (retest of broken support).`;
      } else {
        interpretation = `No breakout/breakdown. Price is ${result.distanceToResistance.toFixed(1)}% from resistance ($${result.resistance.toFixed(2)}) and ${result.distanceToSupport.toFixed(1)}% from support ($${result.support.toFixed(2)}).`;

        if (Math.abs(result.distanceToResistance) < 2) {
          interpretation += ` Near resistance - watch for potential breakout.`;
        } else if (Math.abs(result.distanceToSupport) < 2) {
          interpretation += ` Near support - watch for potential breakdown or bounce.`;
        }
      }

      return {
        ...result,
        interpretation,
      };
    } catch (error) {
      return { error: `Failed to scan breakouts: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Consolidation Detection Tool
// ============================================================================

export const detectConsolidationTool = createTool({
  id: "detect_consolidation",
  description:
    "Detect if a market is in consolidation (low volatility range). " +
    "Use when user asks about 'consolidation', 'ranging', 'sideways', 'volatility squeeze'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    timeframe: z.enum(["15m", "1h", "4h", "1d"]).default("1h").describe("Timeframe for analysis"),
    consolidationThreshold: z
      .number()
      .default(0.7)
      .describe("True Range % threshold for consolidation (default 0.7%)"),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    isConsolidating: z.boolean(),
    consolidationLow: z.number(),
    consolidationHigh: z.number(),
    rangeSize: z.number(),
    rangePercent: z.number(),
    trueRangePercent: z.number(),
    barsInConsolidation: z.number(),
    currentPrice: z.number(),
    positionInRange: z.string(),
    interpretation: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, timeframe, consolidationThreshold }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, timeframe, 100);
      const currentPrice = await ctx.exchange.getPrice(normalizedSymbol);

      const detector = new ConsolidationDetector(consolidationThreshold);
      const result = detector.detectConsolidation(candles);

      // Determine position in range
      const { position } = detector.isNearBoundary(currentPrice, {
        low: result.consolidationLow,
        high: result.consolidationHigh,
        rangeSize: result.rangeSize,
        midpoint: (result.consolidationLow + result.consolidationHigh) / 2,
      });

      let positionInRange = "middle";
      if (position === "near_low") positionInRange = "near_low";
      if (position === "near_high") positionInRange = "near_high";

      let interpretation = "";
      if (result.isConsolidating) {
        interpretation = `${normalizedSymbol} is CONSOLIDATING. Range: $${result.consolidationLow.toFixed(2)} - $${result.consolidationHigh.toFixed(2)} (${result.rangePercent.toFixed(1)}% range). ${result.barsInConsolidation} bars in consolidation.`;

        if (positionInRange === "near_high") {
          interpretation += ` Price is near the TOP of the range - watch for breakout or rejection.`;
        } else if (positionInRange === "near_low") {
          interpretation += ` Price is near the BOTTOM of the range - watch for breakdown or bounce.`;
        } else {
          interpretation += ` Price is in the middle of the range.`;
        }

        interpretation += ` Grid entry strategy may be suitable.`;
      } else {
        interpretation = `${normalizedSymbol} is NOT consolidating. True Range: ${result.trueRangePercent.toFixed(2)}% (above ${consolidationThreshold}% threshold). Market is showing volatility.`;
      }

      return {
        symbol: normalizedSymbol,
        ...result,
        currentPrice,
        positionInRange,
        interpretation,
      };
    } catch (error) {
      return { error: `Failed to detect consolidation: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Market Score Tool
// ============================================================================

export const scoreMarketTool = createTool({
  id: "score_market",
  description:
    "Score a symbol based on multiple technical and flow factors. Returns a bullish/bearish consensus. " +
    "Use when user asks to 'rank coins', 'score opportunities', 'which coin is best', 'compare symbols'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    includeWhaleAnalysis: z.boolean().default(true).describe("Include whale order analysis in scoring"),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    technicalScore: z.number(),
    flowScore: z.number(),
    combinedScore: z.number(),
    consensus: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
    confidence: z.number(),
    narrative: z.string(),
    factors: z.object({
      trendScore: z.number(),
      volatilityScore: z.number(),
      momentumScore: z.number(),
      whaleScore: z.number(),
      pressureScore: z.number(),
    }),
    interpretation: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, includeWhaleAnalysis }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      // Get market data
      const candles = await ctx.exchange.getCandles(normalizedSymbol, "1d", 30);

      if (candles.length < 14) {
        return { error: `Insufficient data for ${normalizedSymbol}. Need at least 14 days.` };
      }

      // Calculate metrics
      const currentPrice = candles[candles.length - 1]!.close;
      const price30dAgo = candles[0]!.close;
      const returns30d = ((currentPrice - price30dAgo) / price30dAgo) * 100;

      // Calculate volatility (ATR-like)
      let trSum = 0;
      for (let i = 1; i < candles.length; i++) {
        const candle = candles[i]!;
        const prevClose = candles[i - 1]!.close;
        const tr = Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - prevClose),
          Math.abs(candle.low - prevClose)
        );
        trSum += tr;
      }
      const atr = trSum / (candles.length - 1);
      const volatility = (atr / currentPrice) * 100;

      // Calculate trend (simple: compare current to 14-period SMA)
      const sma14 = candles.slice(-14).reduce((sum, c) => sum + c.close, 0) / 14;
      const trend = (currentPrice - sma14) / sma14; // -1 to 1 range

      // Calculate RSI
      let gains = 0;
      let losses = 0;
      for (let i = candles.length - 14; i < candles.length; i++) {
        const change = candles[i]!.close - candles[i - 1]!.close;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
      }
      const avgGain = gains / 14;
      const avgLoss = losses / 14;
      const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
      const rsi = 100 - (100 / (1 + rs));

      const marketData = {
        volatility,
        trend,
        returns30d,
        rsi,
      };

      // Optionally include whale analysis
      let flowFeatures = undefined;
      if (includeWhaleAnalysis) {
        try {
          const orderBook = await ctx.exchange.getOrderBook(normalizedSymbol, 100);
          const bids: OrderBookEntry[] = orderBook.bids.map((entry) => ({
            price: entry.price,
            quantity: entry.quantity,
          }));
          const asks: OrderBookEntry[] = orderBook.asks.map((entry) => ({
            price: entry.price,
            quantity: entry.quantity,
          }));

          const detector = new WhaleDetector(50000);
          const whaleAnalysis = detector.analyzeWhaleOrders(bids, asks, currentPrice);

          flowFeatures = {
            whaleBias: whaleAnalysis.bias,
            whaleStrength: whaleAnalysis.strength,
          };
        } catch {
          // Continue without whale data
        }
      }

      const scorer = new MarketScorer();
      const result = scorer.score(normalizedSymbol, marketData, flowFeatures);

      let interpretation = "";
      if (result.consensus === "BULLISH") {
        interpretation = `${normalizedSymbol} scores ${(result.combinedScore * 100).toFixed(0)}/100 BULLISH. `;
        if (result.confidence > 0.7) {
          interpretation += `High confidence signal. Technical and flow metrics aligned.`;
        } else {
          interpretation += `Technical and flow metrics show some divergence.`;
        }
      } else if (result.consensus === "BEARISH") {
        interpretation = `${normalizedSymbol} scores ${(result.combinedScore * 100).toFixed(0)}/100 BEARISH. `;
        if (result.confidence > 0.7) {
          interpretation += `High confidence bearish signal.`;
        } else {
          interpretation += `Mixed signals - be cautious.`;
        }
      } else {
        interpretation = `${normalizedSymbol} scores ${(result.combinedScore * 100).toFixed(0)}/100 NEUTRAL. No clear directional bias.`;
      }

      interpretation += ` RSI: ${rsi.toFixed(0)}, 30d Return: ${returns30d.toFixed(1)}%, Volatility: ${volatility.toFixed(1)}%`;

      return {
        ...result,
        interpretation,
      };
    } catch (error) {
      return { error: `Failed to score market: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

export const marketAnalysisTools = {
  analyze_whale_orders: analyzeWhaleOrdersTool,
  estimate_market_impact: estimateMarketImpactTool,
  scan_breakouts: scanBreakoutsTool,
  detect_consolidation: detectConsolidationTool,
  score_market: scoreMarketTool,
};

/**
 * Technical Indicator Tools (Mastra Format)
 * Agent-facing tools for technical analysis
 *
 * This file demonstrates the Mastra tool format for migration from OpenAI Agents SDK.
 * Key differences:
 * - tool() → createTool()
 * - name → id
 * - parameters → inputSchema
 * - Added outputSchema for better LLM routing
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "./types.ts";
import { createCachedTool, TOOL_CACHE_CONFIG } from "./cache.ts";
import {
  calculateTechnicalAnalysis,
  calculateTechnicalSignals,
  calculateRSI,
  calculateATR,
  calculatePositionSize,
} from "../../../core/indicators/index.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
  insufficientData: (symbol: string) => ({ error: `Insufficient data for ${symbol}. Need at least 50 candles.` }),
};

// ============================================================================
// Full Technical Analysis Tool
// ============================================================================

export const getTechnicalAnalysisTool = createTool({
  id: "get_technical_analysis",
  description:
    "Get comprehensive technical analysis for a symbol including RSI, MACD, EMAs, Bollinger Bands, and ATR. " +
    "Use when user asks for 'analysis', 'technicals', 'indicators', or wants to understand a coin's setup. " +
    "Returns actionable bias (bullish/bearish) with confidence level.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
    interval: z
      .enum(["1h", "4h", "1d"])
      .default("4h")
      .describe("Timeframe for analysis"),
    atrMultiplier: z
      .number()
      .min(1)
      .max(3)
      .default(1.5)
      .describe("ATR multiplier for stop-loss calculation"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.number().optional(),
    bias: z.enum(["bullish", "bearish", "neutral", "strongly_bullish", "strongly_bearish"]).optional(),
    confidence: z.union([z.number().min(0).max(100), z.enum(["high", "medium", "low"])]).optional(),
    summary: z.string().optional(),
    rsi: z.object({
      value: z.string().optional(),
      signal: z.string(),
      action: z.string(),
    }).optional(),
    ema: z.object({
      ema9: z.string().optional(),
      ema20: z.string().optional(),
      ema50: z.string().optional(),
      ema200: z.string().optional(),
      alignment: z.string(),
      interpretation: z.string(),
    }).optional(),
    macd: z.object({
      value: z.string().optional(),
      signal: z.string().optional(),
      histogram: z.string().optional(),
      trend: z.string(),
      crossover: z.string().optional(),
      interpretation: z.string(),
    }).optional(),
    atr: z.object({
      value: z.string().optional(),
      stopLossLong: z.string(),
      stopLossShort: z.string(),
      stopDistance: z.string(),
      interpretation: z.string(),
    }).optional(),
    bollinger: z.object({
      upper: z.string().optional(),
      middle: z.string().optional(),
      lower: z.string().optional(),
      position: z.string(),
      squeeze: z.boolean(),
      interpretation: z.string(),
    }).optional(),
    signals: z.object({
      action: z.string(),
      signals: z.object({
        type: z.enum(["buy", "sell", "hold"]),
        reasons: z.array(z.string()),
      }),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, atrMultiplier }, execContext: MastraExecutionContext) => {
    // Context is injected via Mastra's RuntimeContext
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      // Need at least 200 candles for EMA200
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);

      if (!candles || candles.length < 50) {
        return errors.insufficientData(normalizedSymbol);
      }

      const analysis = calculateTechnicalAnalysis(candles, normalizedSymbol, interval, atrMultiplier);

      // Format for agent consumption
      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]?.close,

        // Overall assessment
        bias: analysis.bias,
        confidence: analysis.confidence,
        summary: analysis.summary,

        // RSI
        rsi: {
          value: analysis.rsi.current?.toFixed(1),
          signal: analysis.rsi.signal,
          action: analysis.rsi.action,
        },

        // EMAs
        ema: {
          ema9: analysis.ema.ema9?.toFixed(2),
          ema20: analysis.ema.ema20?.toFixed(2),
          ema50: analysis.ema.ema50?.toFixed(2),
          ema200: analysis.ema.ema200?.toFixed(2),
          alignment: analysis.ema.alignment,
          interpretation: analysis.ema.interpretation,
        },

        // MACD
        macd: {
          value: analysis.macd.current.macd?.toFixed(2),
          signal: analysis.macd.current.signal?.toFixed(2),
          histogram: analysis.macd.current.histogram?.toFixed(2),
          trend: analysis.macd.trend,
          crossover: analysis.macd.crossover,
          interpretation: analysis.macd.interpretation,
        },

        // ATR & Stop Loss
        atr: {
          value: analysis.atr.current?.toFixed(2),
          stopLossLong: analysis.atr.stopLoss.long.toFixed(2),
          stopLossShort: analysis.atr.stopLoss.short.toFixed(2),
          stopDistance: analysis.atr.stopLoss.distance.toFixed(2),
          interpretation: analysis.atr.interpretation,
        },

        // Bollinger Bands
        bollinger: {
          upper: analysis.bollinger.current.upper?.toFixed(2),
          middle: analysis.bollinger.current.middle?.toFixed(2),
          lower: analysis.bollinger.current.lower?.toFixed(2),
          position: analysis.bollinger.position,
          squeeze: analysis.bollinger.squeeze,
          interpretation: analysis.bollinger.interpretation,
        },

        // Actionable signals
        signals: {
          action: analysis.bias === "bullish" ? "BUY" : analysis.bias === "bearish" ? "SELL" : "HOLD",
          signals: analysis.signals,
        },
      };
    } catch (error) {
      return { error: `Failed to get technical analysis: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Quick Technical Signals Tool (for Scanner)
// ============================================================================

export const getTechnicalSignalsTool = createTool({
  id: "get_technical_signals",
  description:
    "Get quick technical signals for a symbol. Lighter than full analysis. " +
    "Use for scanning multiple coins or quick momentum/trend checks. " +
    "Returns score from -100 (bearish) to +100 (bullish).",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair"),
    interval: z
      .enum(["1h", "4h", "1d"])
      .default("4h")
      .describe("Timeframe"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    rsi: z.string().optional(),
    rsiSignal: z.string().optional(),
    trend: z.string().optional(),
    macd: z.string().optional(),
    priceVsEma200: z.string().optional(),
    bollingerPosition: z.string().optional(),
    bias: z.string().optional(),
    score: z.number().min(-100).max(100).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);

      if (!candles || candles.length < 50) {
        return errors.insufficientData(normalizedSymbol);
      }

      const signals = calculateTechnicalSignals(candles, normalizedSymbol);

      return {
        symbol: normalizedSymbol,
        rsi: signals.rsiValue?.toFixed(1),
        rsiSignal: signals.rsiSignal,
        trend: signals.trendAlignment,
        macd: signals.macdTrend,
        priceVsEma200: signals.priceVsEma200,
        bollingerPosition: signals.bollingerPosition,
        bias: signals.overallBias,
        score: signals.score,
      };
    } catch (error) {
      return { error: `Failed to get signals: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// RSI Tool (standalone)
// ============================================================================

export const getRSITool = createTool({
  id: "get_rsi",
  description:
    "Get RSI (Relative Strength Index) for a symbol. " +
    "RSI < 30 = oversold (potential buy), RSI > 70 = overbought (potential sell).",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h"),
    period: z.number().min(7).max(21).default(14),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    rsi: z.string().optional(),
    signal: z.enum(["oversold", "overbought", "neutral"]).optional(),
    action: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, period }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 50);

      if (!candles || candles.length < period + 1) {
        return { error: "Insufficient data for RSI" };
      }

      const closes = candles.map(c => c.close);
      const rsi = calculateRSI(closes, period);

      return {
        symbol: normalizedSymbol,
        rsi: rsi.current?.toFixed(1),
        signal: rsi.signal,
        action: rsi.action,
        interpretation:
          rsi.current === null
            ? "Insufficient data"
            : rsi.current < 30
            ? "Oversold - potential buying opportunity"
            : rsi.current > 70
            ? "Overbought - potential selling pressure"
            : rsi.current < 50
            ? "Below midline - slight bearish bias"
            : "Above midline - slight bullish bias",
      };
    } catch (error) {
      return { error: `Failed to get RSI: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// ATR Stop-Loss Tool (for Planner)
// ============================================================================

export const getStopLossLevelsTool = createTool({
  id: "get_stop_loss_levels",
  description:
    "Calculate ATR-based stop-loss levels for a trade. " +
    "Use when creating trade plans to set proper stop-loss based on volatility. " +
    "Returns stop-loss price for both long and short positions.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair"),
    interval: z
      .enum(["1h", "4h", "1d"])
      .default("4h")
      .describe("Timeframe for ATR calculation"),
    entryPrice: z
      .number()
      .optional()
      .describe("Entry price (defaults to current price)"),
    atrMultiplier: z
      .number()
      .min(1)
      .max(4)
      .default(1.5)
      .describe("ATR multiplier (1.5 = normal, 2 = wide, 3 = very wide)"),
    atrPeriod: z
      .number()
      .min(7)
      .max(21)
      .default(14)
      .describe("ATR period"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    atr: z.object({
      value: z.string(),
      period: z.number(),
      multiplier: z.number(),
      asPercent: z.string(),
    }).optional(),
    stopLoss: z.object({
      long: z.string(),
      short: z.string(),
      distance: z.string(),
      distancePercent: z.string(),
    }).optional(),
    takeProfit: z.object({
      long: z.string(),
      short: z.string(),
      distance: z.string(),
      riskReward: z.string(),
    }).optional(),
    interpretation: z.string().optional(),
    recommendation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, entryPrice, atrMultiplier, atrPeriod }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 50);

      if (!candles || candles.length < atrPeriod + 1) {
        return { error: `Insufficient data for ATR calculation` };
      }

      const currentPrice = entryPrice ?? candles[candles.length - 1]!.close;
      const atr = calculateATR(candles, atrPeriod, currentPrice, atrMultiplier);

      if (atr.current === null) {
        return { error: "Could not calculate ATR" };
      }

      // Calculate risk/reward levels
      const stopDistance = atr.stopLoss.distance;
      const takeProfitDistance = stopDistance * 2; // 2:1 R:R

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: currentPrice.toFixed(2),

        atr: {
          value: atr.current.toFixed(2),
          period: atrPeriod,
          multiplier: atrMultiplier,
          asPercent: ((atr.current / currentPrice) * 100).toFixed(2) + "%",
        },

        stopLoss: {
          long: atr.stopLoss.long.toFixed(2),
          short: atr.stopLoss.short.toFixed(2),
          distance: stopDistance.toFixed(2),
          distancePercent: ((stopDistance / currentPrice) * 100).toFixed(2) + "%",
        },

        takeProfit: {
          long: (currentPrice + takeProfitDistance).toFixed(2),
          short: (currentPrice - takeProfitDistance).toFixed(2),
          distance: takeProfitDistance.toFixed(2),
          riskReward: "2:1",
        },

        interpretation: atr.interpretation,

        recommendation:
          atr.current / currentPrice > 0.05
            ? "High volatility - consider reducing position size or widening stops"
            : atr.current / currentPrice > 0.03
            ? "Elevated volatility - use standard position sizing"
            : "Normal volatility - standard risk parameters appropriate",
      };
    } catch (error) {
      return { error: `Failed to calculate stop-loss: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Position Size Calculator Tool
// ============================================================================

export const getPositionSizeTool = createTool({
  id: "get_position_size",
  description:
    "Calculate optimal position size based on risk amount and ATR. " +
    "Use when determining how much to buy/sell based on account risk tolerance.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair"),
    riskAmount: z.number().describe("Amount willing to risk in USD (e.g., 100)"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h"),
    atrMultiplier: z.number().min(1).max(4).default(1.5),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    currentPrice: z.string(),
    risk: z.object({
      amount: z.string(),
      stopDistance: z.string(),
      riskPerUnit: z.string(),
    }),
    position: z.object({
      units: z.string(),
      value: z.string(),
    }),
    note: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, riskAmount, interval, atrMultiplier }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 50);

      if (!candles || candles.length < 15) {
        return { error: "Insufficient data" };
      }

      const currentPrice = candles[candles.length - 1]!.close;
      const atr = calculateATR(candles, 14, currentPrice, atrMultiplier);

      if (atr.current === null) {
        return { error: "Could not calculate ATR" };
      }

      const sizing = calculatePositionSize(riskAmount, atr.current, atrMultiplier, currentPrice);

      return {
        symbol: normalizedSymbol,
        currentPrice: currentPrice.toFixed(2),

        risk: {
          amount: riskAmount.toFixed(2),
          stopDistance: sizing.stopDistance.toFixed(2),
          riskPerUnit: sizing.riskPerShare.toFixed(4),
        },

        position: {
          units: sizing.shares.toFixed(6),
          value: sizing.positionSize.toFixed(2),
        },

        note: `With $${riskAmount} risk and ${atrMultiplier}x ATR stop, you can buy ${sizing.shares.toFixed(6)} ${normalizedSymbol.replace("USDT", "")} (~$${sizing.positionSize.toFixed(2)})`,
      };
    } catch (error) {
      return { error: `Failed to calculate position size: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// VWAP Tool
// ============================================================================

export const getVWAPTool = createTool({
  id: "get_vwap",
  description:
    "Get VWAP (Volume Weighted Average Price) for a symbol. " +
    "Shows fair value based on volume - essential for intraday trading. " +
    "Price above VWAP = bullish, below = bearish.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z
      .enum(["1m", "5m", "15m", "1h", "4h"])
      .default("1h")
      .describe("Timeframe (VWAP works best on shorter timeframes)"),
    limit: z
      .number()
      .min(50)
      .max(500)
      .default(100)
      .describe("Number of candles to include"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    vwap: z.string().optional(),
    pricePosition: z.enum(["above", "below", "at"]).optional(),
    deviation: z.string().nullable().optional(),
    interpretation: z.string().optional(),
    tradingImplication: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, limit);

      if (!candles || candles.length < 10) {
        return errors.insufficientData(normalizedSymbol);
      }

      const { calculateVWAP } = await import("../../../core/indicators/index.ts");
      const vwap = calculateVWAP(candles);

      const currentPrice = candles[candles.length - 1]!.close;

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: currentPrice.toFixed(2),
        vwap: vwap.current?.toFixed(2),
        pricePosition: vwap.pricePosition,
        deviation: vwap.deviation ? `${vwap.deviation.toFixed(2)}%` : null,
        interpretation: vwap.interpretation,
        tradingImplication:
          vwap.pricePosition === "above"
            ? "Bullish bias - consider buying dips to VWAP"
            : vwap.pricePosition === "below"
            ? "Bearish bias - consider selling rallies to VWAP"
            : "At fair value - wait for direction",
      };
    } catch (error) {
      return { error: `Failed to get VWAP: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Stochastic RSI Tool
// ============================================================================

export const getStochasticRSITool = createTool({
  id: "get_stochastic_rsi",
  description:
    "Get Stochastic RSI for a symbol. More sensitive than regular RSI for overbought/oversold. " +
    "Combines RSI with Stochastic for better entry/exit timing. " +
    "%K < 20 = oversold (buy), %K > 80 = overbought (sell).",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h"),
    rsiPeriod: z.number().min(7).max(21).default(14).describe("RSI period"),
    stochPeriod: z.number().min(7).max(21).default(14).describe("Stochastic lookback"),
    smoothK: z.number().min(1).max(5).default(3).describe("%K smoothing"),
    smoothD: z.number().min(1).max(5).default(3).describe("%D smoothing"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    stochRSI: z.object({
      k: z.string().optional(),
      d: z.string().optional(),
    }).optional(),
    signal: z.enum(["oversold", "overbought", "neutral"]).optional(),
    crossover: z.string().optional(),
    action: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, rsiPeriod, stochPeriod, smoothK, smoothD }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 100);

      if (!candles || candles.length < 50) {
        return errors.insufficientData(normalizedSymbol);
      }

      const closes = candles.map(c => c.close);
      const { calculateStochasticRSI } = await import("../../../core/indicators/index.ts");
      const stochRSI = calculateStochasticRSI(closes, rsiPeriod, stochPeriod, smoothK, smoothD);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        stochRSI: {
          k: stochRSI.currentK?.toFixed(1),
          d: stochRSI.currentD?.toFixed(1),
        },
        signal: stochRSI.signal,
        crossover: stochRSI.crossover,
        action: stochRSI.action,
        interpretation: stochRSI.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get Stochastic RSI: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Kalman Filter Tool
// ============================================================================

export const getKalmanFilterTool = createTool({
  id: "get_kalman_filter",
  description:
    "Get Kalman filter trend analysis for a symbol. " +
    "Zero-lag smoother that estimates fair value dynamically. " +
    "Detects overextension from fair value for mean reversion setups. " +
    "Mathematically superior to moving averages — adapts to noise automatically.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    processVariance: z
      .number()
      .min(1e-7)
      .max(1e-2)
      .default(1e-5)
      .describe("Q parameter: lower = smoother (default 0.00001)"),
    measurementVariance: z
      .number()
      .min(0.01)
      .max(1)
      .default(0.1)
      .describe("R parameter: lower = more responsive (default 0.1)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    kalmanValue: z.string().optional(),
    slope: z.string().optional(),
    deviation: z.string().optional(),
    trend: z.enum(["bullish", "bearish", "neutral"]).optional(),
    overextended: z.boolean().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, processVariance, measurementVariance }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < 20) return errors.insufficientData(normalizedSymbol);

      const { calculateKalmanFilter } = await import("../../../core/indicators/index.ts");
      const result = calculateKalmanFilter(candles, processVariance, measurementVariance);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        kalmanValue: result.current?.toFixed(2),
        slope: result.slope?.toFixed(4),
        deviation: result.deviation !== null ? `${result.deviation}%` : undefined,
        trend: result.trend,
        overextended: result.overextended,
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get Kalman filter: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Nadaraya-Watson Envelope Tool
// ============================================================================

export const getNadarayaWatsonTool = createTool({
  id: "get_nadaraya_watson",
  description:
    "Get Nadaraya-Watson kernel regression envelope for a symbol. " +
    "Non-parametric Gaussian smoother with ATR-based bands. " +
    "Price touching upper band = overbought (sell signal), lower band = oversold (buy signal). " +
    "Superior to Bollinger Bands for smooth trend estimation.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    bandwidth: z
      .number()
      .min(20)
      .max(500)
      .default(100)
      .describe("Kernel bandwidth / lookback (default 100)"),
    bandMultiplier: z
      .number()
      .min(0.5)
      .max(5)
      .default(2.0)
      .describe("ATR multiplier for envelope bands (default 2.0)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    nwValue: z.string().optional(),
    upperBand: z.string().optional(),
    lowerBand: z.string().optional(),
    position: z.enum(["above_upper", "upper_zone", "middle", "lower_zone", "below_lower"]).optional(),
    trend: z.enum(["bullish", "bearish", "neutral"]).optional(),
    envelopeWidth: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, bandwidth, bandMultiplier }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, Math.max(bandwidth + 50, 250));
      if (!candles || candles.length < 20) return errors.insufficientData(normalizedSymbol);

      const { calculateNadarayaWatson } = await import("../../../core/indicators/index.ts");
      const result = calculateNadarayaWatson(candles, bandwidth, bandMultiplier);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        nwValue: result.current?.toFixed(2),
        upperBand: result.currentUpper?.toFixed(2),
        lowerBand: result.currentLower?.toFixed(2),
        position: result.position,
        trend: result.trend,
        envelopeWidth: result.envelopeWidth !== null ? `${result.envelopeWidth}%` : undefined,
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get Nadaraya-Watson: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Camarilla Pivot Points Tool
// ============================================================================

export const getCamarillaPivotsTool = createTool({
  id: "get_camarilla_pivots",
  description:
    "Get Camarilla pivot point levels (R1-R4, S1-S4) for a symbol. " +
    "8 intraday support/resistance levels from previous period range. " +
    "S3/R3 = reversal levels (bounce trades), S4/R4 = breakout levels (momentum trades). " +
    "Best for intraday and swing trading entry/exit planning.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("1h").describe("Timeframe (1h works best with 24-bar daily pivots)"),
    lookbackPeriod: z
      .number()
      .min(6)
      .max(168)
      .default(24)
      .describe("Candles for previous period (24 = daily pivots on 1h chart)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    levels: z.array(z.object({
      label: z.string(),
      price: z.string(),
      type: z.string(),
      role: z.string(),
    })).optional(),
    priceZone: z.string().optional(),
    nearestLevel: z.object({
      label: z.string(),
      price: z.string(),
    }).optional(),
    signal: z.enum(["long_reversal", "short_reversal", "long_breakout", "short_breakout", "neutral"]).optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, lookbackPeriod }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, lookbackPeriod + 10);
      if (!candles || candles.length < lookbackPeriod + 1) return errors.insufficientData(normalizedSymbol);

      const { calculateCamarillaPivots } = await import("../../../core/indicators/index.ts");
      const result = calculateCamarillaPivots(candles, lookbackPeriod);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        levels: result.levels.map(l => ({
          label: l.label,
          price: l.price.toFixed(2),
          type: l.type,
          role: l.role,
        })),
        priceZone: result.priceZone,
        nearestLevel: result.nearestLevel ? {
          label: result.nearestLevel.label,
          price: result.nearestLevel.price.toFixed(2),
        } : undefined,
        signal: result.signal,
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get Camarilla pivots: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Indicator tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 *
 * All tools are wrapped with caching and request deduplication:
 * - get_technical_analysis: 1 minute TTL (computationally expensive)
 * - get_technical_signals: 1 minute TTL (used in scanning)
 * - get_rsi: 1 minute TTL (indicator data)
 * - get_stop_loss_levels: 1 minute TTL (ATR-based)
 * - get_position_size: 1 minute TTL (ATR-based)
 * - get_vwap: 1 minute TTL (indicator data)
 * - get_stochastic_rsi: 1 minute TTL (indicator data)
 */
export const indicatorTools = {
  get_technical_analysis: createCachedTool(getTechnicalAnalysisTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_technical_signals: createCachedTool(getTechnicalSignalsTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_rsi: createCachedTool(getRSITool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_stop_loss_levels: createCachedTool(getStopLossLevelsTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_position_size: createCachedTool(getPositionSizeTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_vwap: createCachedTool(getVWAPTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_stochastic_rsi: createCachedTool(getStochasticRSITool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_kalman_filter: createCachedTool(getKalmanFilterTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_nadaraya_watson: createCachedTool(getNadarayaWatsonTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_camarilla_pivots: createCachedTool(getCamarillaPivotsTool, TOOL_CACHE_CONFIG.indicators.ttl),
};

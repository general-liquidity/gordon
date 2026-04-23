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

import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "./types.ts";
import { createCachedTool, TOOL_CACHE_CONFIG } from "./cache.ts";
import type { Timeframe } from "../../../types/timeframes.ts";

/** VWAP tool supports a short-timeframe subset. */
const VWAP_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const satisfies readonly Timeframe[];
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
// ZLMA Helper: Zero-Lag Moving Average
// ============================================================================

function calculateEMAArray(data: number[], period: number): number[] {
  if (data.length < period) return data.map(() => NaN);
  const mult = 2 / (period + 1);
  const result: number[] = [];
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period - 1; i++) result.push(NaN);
  result.push(ema);
  for (let i = period; i < data.length; i++) {
    ema = (data[i]! - ema) * mult + ema;
    result.push(ema);
  }
  return result;
}

function calculateZLMA(closes: number[], period: number): (number | null)[] {
  const ema1 = calculateEMAArray(closes, period);
  const adjusted = closes.map((c, i) => {
    const e = ema1[i];
    return e !== undefined && !isNaN(e) ? c + (c - e) : c;
  });
  return calculateEMAArray(adjusted, period).map(v => (isNaN(v) ? null : v));
}

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
    zlma: z.object({
      zlma20: z.string().optional(),
      zlmaSlope: z.string().optional(),
      zlmaTrend: z.enum(["bullish", "bearish", "neutral"]).optional(),
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
    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      // Need at least 200 candles for EMA200
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);

      if (!candles || candles.length < 50) {
        return errors.insufficientData(normalizedSymbol);
      }

      const analysis = calculateTechnicalAnalysis(candles, normalizedSymbol, interval, atrMultiplier);

      // ZLMA(20)
      const zlmaCloses = candles.map(c => c.close);
      const zlmaValues = calculateZLMA(zlmaCloses, 20);
      const zlmaCurrent = zlmaValues[zlmaValues.length - 1] ?? null;
      const zlma3ago = zlmaValues[zlmaValues.length - 4] ?? null;
      const zlmaPrice = candles[candles.length - 1]?.close;
      const zlmaSlope = zlmaCurrent !== null && zlma3ago !== null && zlmaPrice
        ? ((zlmaCurrent - zlma3ago) / zlmaPrice) * 100 : null;
      let zlmaTrend: "bullish" | "bearish" | "neutral" = "neutral";
      if (zlmaPrice && zlmaCurrent !== null && zlmaSlope !== null) {
        if (zlmaPrice > zlmaCurrent && zlmaSlope > 0) zlmaTrend = "bullish";
        else if (zlmaPrice < zlmaCurrent && zlmaSlope < 0) zlmaTrend = "bearish";
      }

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

        // Zero-Lag Moving Average
        zlma: {
          zlma20: zlmaCurrent?.toFixed(2),
          zlmaSlope: zlmaSlope?.toFixed(4),
          zlmaTrend,
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

    const normalizedSymbol = normalizeSymbol(symbol);

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
    "Get momentum oscillator suite for a symbol: RSI, Stochastic RSI, MFI (volume-weighted RSI), and WaveTrend. " +
    "RSI < 30 = oversold, > 70 = overbought. StochRSI is more sensitive. MFI adds volume confirmation. " +
    "WaveTrend adds CMF (money flow) bias. All in one call for complete momentum picture.",
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
    stochRsi: z.object({
      k: z.string().optional(),
      d: z.string().optional(),
      signal: z.string().optional(),
      crossover: z.string().optional(),
      action: z.string().optional(),
      interpretation: z.string().optional(),
    }).optional(),
    mfi: z.object({
      value: z.string().optional(),
      signal: z.string().optional(),
      action: z.string().optional(),
      flowDirection: z.string().optional(),
      interpretation: z.string().optional(),
    }).optional(),
    waveTrend: z.object({
      wt1: z.string().optional(),
      wt2: z.string().optional(),
      zone: z.string().optional(),
      crossover: z.string().optional(),
      momentum: z.string().optional(),
      cmf: z.string().optional(),
      cmfBias: z.string().optional(),
      interpretation: z.string().optional(),
    }).optional(),
    rsiVelocity: z.object({
      velocity: z.number().optional().describe("RSI change over last 3 bars"),
      acceleration: z.number().optional().describe("Velocity change over last 3 bars"),
      rsiMin20: z.number().optional().describe("Min RSI over last 20 bars"),
      rsiMax20: z.number().optional().describe("Max RSI over last 20 bars"),
      momentumShift: z.enum(["accelerating_up", "accelerating_down", "decelerating", "steady"]).optional(),
      interpretation: z.string().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, period }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);

      if (!candles || candles.length < period + 1) {
        return { error: "Insufficient data for RSI" };
      }

      const closes = candles.map(c => c.close);
      const rsi = calculateRSI(closes, period);

      // Sub-indicators
      const { calculateStochasticRSI, calculateMFI, calculateWaveTrend } = await import("../../../core/indicators/index.ts");
      const stochRsi = calculateStochasticRSI(closes, period, period, 3, 3);
      const mfi = calculateMFI(candles, period);
      const wt = calculateWaveTrend(candles);

      // RSI Velocity & Acceleration
      const rsiValues = rsi.values;
      const rsiLen = rsiValues.length;
      let rsiVelocity: number | null = null;
      if (rsiLen >= 4 && rsiValues[rsiLen - 1] != null && rsiValues[rsiLen - 4] != null) {
        rsiVelocity = rsiValues[rsiLen - 1]! - rsiValues[rsiLen - 4]!;
      }
      let velocity3ago: number | null = null;
      if (rsiLen >= 7 && rsiValues[rsiLen - 4] != null && rsiValues[rsiLen - 7] != null) {
        velocity3ago = rsiValues[rsiLen - 4]! - rsiValues[rsiLen - 7]!;
      }
      const rsiAcceleration = rsiVelocity !== null && velocity3ago !== null ? rsiVelocity - velocity3ago : null;
      const recentRsi = rsiValues.slice(-20).filter((v): v is number => v !== null);
      const rsiMin20 = recentRsi.length > 0 ? Math.min(...recentRsi) : null;
      const rsiMax20 = recentRsi.length > 0 ? Math.max(...recentRsi) : null;
      let momentumShift: "accelerating_up" | "accelerating_down" | "decelerating" | "steady" = "steady";
      if (rsiVelocity !== null) {
        if (rsiVelocity > 5) momentumShift = "accelerating_up";
        else if (rsiVelocity < -5) momentumShift = "accelerating_down";
        else if (Math.abs(rsiVelocity) < 2) momentumShift = "decelerating";
      }

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
        stochRsi: {
          k: stochRsi.currentK?.toFixed(1),
          d: stochRsi.currentD?.toFixed(1),
          signal: stochRsi.signal,
          crossover: stochRsi.crossover,
          action: stochRsi.action,
          interpretation: stochRsi.interpretation,
        },
        mfi: {
          value: mfi.current?.toFixed(1),
          signal: mfi.signal,
          action: mfi.action,
          flowDirection: mfi.flowDirection,
          interpretation: mfi.interpretation,
        },
        waveTrend: {
          wt1: wt.currentWT1?.toFixed(2),
          wt2: wt.currentWT2?.toFixed(2),
          zone: wt.zone,
          crossover: wt.crossover,
          momentum: wt.momentum,
          cmf: wt.cmf?.toFixed(3),
          cmfBias: wt.cmfBias,
          interpretation: wt.interpretation,
        },
        rsiVelocity: {
          velocity: rsiVelocity !== null ? Math.round(rsiVelocity * 100) / 100 : undefined,
          acceleration: rsiAcceleration !== null ? Math.round(rsiAcceleration * 100) / 100 : undefined,
          rsiMin20: rsiMin20 !== null ? Math.round(rsiMin20 * 10) / 10 : undefined,
          rsiMax20: rsiMax20 !== null ? Math.round(rsiMax20 * 10) / 10 : undefined,
          momentumShift,
          interpretation: rsiVelocity !== null
            ? `RSI ${rsiVelocity > 0 ? "rising" : "falling"} at ${Math.abs(rsiVelocity).toFixed(1)} pts/3bars, ${momentumShift.replace("_", " ")}${rsiMin20 !== null ? ` | 20-bar range: ${rsiMin20.toFixed(1)}-${rsiMax20!.toFixed(1)}` : ""}`
            : undefined,
        },
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

    const normalizedSymbol = normalizeSymbol(symbol);

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

    const normalizedSymbol = normalizeSymbol(symbol);

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
      .enum(VWAP_TIMEFRAMES)
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
    swingVwap: z.string().nullable().optional(),
    swingAnchorType: z.enum(["swing_high", "swing_low"]).nullable().optional(),
    swingAnchorBar: z.number().nullable().optional(),
    swingAnchorPrice: z.string().nullable().optional(),
    priceVsSwingVwap: z.enum(["above", "below", "at"]).nullable().optional(),
    swingVwapInterpretation: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, limit);

      if (!candles || candles.length < 10) {
        return errors.insufficientData(normalizedSymbol);
      }

      const { calculateVWAP } = await import("../../../core/indicators/index.ts");
      const vwap = calculateVWAP(candles);

      const currentPrice = candles[candles.length - 1]!.close;

      // Swing-Anchored VWAP
      const pivotLen = 5;
      let swHiIdx: number | null = null, swHiPrice: number | null = null;
      let swLoIdx: number | null = null, swLoPrice: number | null = null;
      for (let i = candles.length - 1 - pivotLen; i >= pivotLen; i--) {
        if (swHiIdx === null) {
          let isHi = true;
          for (let j = i - pivotLen; j <= i + pivotLen; j++) {
            if (j !== i && candles[j]!.high >= candles[i]!.high) { isHi = false; break; }
          }
          if (isHi) { swHiIdx = i; swHiPrice = candles[i]!.high; }
        }
        if (swLoIdx === null) {
          let isLo = true;
          for (let j = i - pivotLen; j <= i + pivotLen; j++) {
            if (j !== i && candles[j]!.low <= candles[i]!.low) { isLo = false; break; }
          }
          if (isLo) { swLoIdx = i; swLoPrice = candles[i]!.low; }
        }
        if (swHiIdx !== null && swLoIdx !== null) break;
      }

      let swingVwapVal: number | null = null;
      let swingAnchorType: "swing_high" | "swing_low" | null = null;
      let swingAnchorBar: number | null = null;
      let swingAnchorPrice: number | null = null;
      let priceVsSwingVwap: "above" | "below" | "at" | null = null;
      let swingVwapInterpretation: string | null = null;

      let anchorIdx: number | null = null;
      if (swHiIdx !== null && swLoIdx !== null) {
        anchorIdx = swHiIdx > swLoIdx ? swHiIdx : swLoIdx;
        swingAnchorType = swHiIdx > swLoIdx ? "swing_high" : "swing_low";
        swingAnchorPrice = swHiIdx > swLoIdx ? swHiPrice : swLoPrice;
      } else if (swHiIdx !== null) { anchorIdx = swHiIdx; swingAnchorType = "swing_high"; swingAnchorPrice = swHiPrice; }
      else if (swLoIdx !== null) { anchorIdx = swLoIdx; swingAnchorType = "swing_low"; swingAnchorPrice = swLoPrice; }

      if (anchorIdx !== null) {
        swingAnchorBar = candles.length - 1 - anchorIdx;
        let cumVol = 0, cumVP = 0;
        for (let i = anchorIdx; i < candles.length; i++) {
          const tp = (candles[i]!.high + candles[i]!.low + candles[i]!.close) / 3;
          cumVP += tp * candles[i]!.volume; cumVol += candles[i]!.volume;
        }
        if (cumVol > 0) {
          swingVwapVal = cumVP / cumVol;
          const dev = ((currentPrice - swingVwapVal) / swingVwapVal) * 100;
          priceVsSwingVwap = Math.abs(dev) < 0.1 ? "at" : currentPrice > swingVwapVal ? "above" : "below";
          const anchor = swingAnchorType === "swing_low" ? "swing low" : "swing high";
          swingVwapInterpretation = `Price ${Math.abs(dev).toFixed(2)}% ${priceVsSwingVwap} swing VWAP anchored from ${anchor} ${swingAnchorBar} bars ago`;
        }
      }

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
        swingVwap: swingVwapVal?.toFixed(2) ?? null,
        swingAnchorType,
        swingAnchorBar,
        swingAnchorPrice: swingAnchorPrice?.toFixed(2) ?? null,
        priceVsSwingVwap,
        swingVwapInterpretation,
      };
    } catch (error) {
      return { error: `Failed to get VWAP: ${(error as Error).message}` };
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

    const normalizedSymbol = normalizeSymbol(symbol);

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
// Markov Chain Regime Detection Tool
// ============================================================================

export const getMarkovRegimeTool = createTool({
  id: "get_markov_regime",
  description:
    "Get Markov Chain market regime detection for a symbol. " +
    "Classifies market into Bull/Bear/Neutral using Z-score of returns. " +
    "Provides transition probability matrix — probability of switching regimes. " +
    "Detects regime transitions for entry/exit timing.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    lookback: z
      .number()
      .min(20)
      .max(200)
      .default(50)
      .describe("Lookback for Z-score and transition matrix (default 50)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    regime: z.string().optional(),
    zScore: z.string().optional(),
    probToBull: z.string().optional(),
    probStaySame: z.string().optional(),
    probToBear: z.string().optional(),
    confidence: z.string().optional(),
    transition: z.boolean().optional(),
    prevRegime: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, lookback }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, lookback * 2 + 10);
      if (!candles || candles.length < lookback * 2 + 2) return errors.insufficientData(normalizedSymbol);

      const { calculateMarkovRegime } = await import("../../../core/indicators/index.ts");
      const result = calculateMarkovRegime(candles, lookback);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        regime: result.regimeLabel.toUpperCase(),
        zScore: result.zScore?.toFixed(3),
        probToBull: `${(result.probToBull * 100).toFixed(1)}%`,
        probStaySame: `${(result.probStaySame * 100).toFixed(1)}%`,
        probToBear: `${(result.probToBear * 100).toFixed(1)}%`,
        confidence: `${result.confidence.toFixed(1)}%`,
        transition: result.transition,
        prevRegime: result.prevRegime.toUpperCase(),
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get Markov regime: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Supertrend Tool
// ============================================================================

export const getSupertrendTool = createTool({
  id: "get_supertrend",
  description:
    "Get Supertrend indicator for a symbol. " +
    "ATR-based dynamic trailing support/resistance — clean trend-following signal. " +
    "Direction = 1 (bullish, lower band is support) or -1 (bearish, upper band is resistance). " +
    "Buy on bearish→bullish flip, sell on bullish→bearish flip. No repainting.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    atrPeriod: z.number().min(5).max(30).default(10).describe("ATR period (default 10)"),
    multiplier: z.number().min(0.5).max(5).default(2.0).describe("ATR multiplier (default 2.0)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    supertrendValue: z.string().optional(),
    direction: z.string().optional(),
    trendChange: z.boolean().optional(),
    signal: z.enum(["buy", "sell", "hold"]).optional(),
    distance: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, atrPeriod, multiplier }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < atrPeriod + 5) return errors.insufficientData(normalizedSymbol);

      const { calculateSupertrend } = await import("../../../core/indicators/index.ts");
      const result = calculateSupertrend(candles, atrPeriod, multiplier);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        supertrendValue: result.current?.toFixed(2),
        direction: result.currentDirection === 1 ? "BULLISH" : "BEARISH",
        trendChange: result.trendChange,
        signal: result.signal,
        distance: result.distance !== null ? `${result.distance}%` : undefined,
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get Supertrend: ${(error as Error).message}` };
    }
  },
});


// ============================================================================
// Ichimoku Cloud Tool
// ============================================================================

export const getIchimokuTool = createTool({
  id: "get_ichimoku",
  description:
    "Get full Ichimoku Cloud analysis for a symbol. " +
    "5 components: Tenkan-sen, Kijun-sen, Senkou Span A/B, Chikou Span. " +
    "Cloud color (bullish/bearish), price position (above/in/below cloud), TK crosses. " +
    "Multi-timeframe trend analysis in one indicator — best for swing trading.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    tenkan: z.string().optional(),
    kijun: z.string().optional(),
    senkouA: z.string().optional(),
    senkouB: z.string().optional(),
    cloudTop: z.string().optional(),
    cloudBottom: z.string().optional(),
    cloudColor: z.enum(["bullish", "bearish", "neutral"]).optional(),
    pricePosition: z.enum(["above_cloud", "in_cloud", "below_cloud"]).optional(),
    tkCross: z.enum(["bullish_cross", "bearish_cross", "none"]).optional(),
    signal: z.enum(["strong_buy", "buy", "neutral", "sell", "strong_sell"]).optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < 53) return errors.insufficientData(normalizedSymbol);

      const { calculateIchimoku } = await import("../../../core/indicators/index.ts");
      const result = calculateIchimoku(candles);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        tenkan: result.tenkan?.toFixed(2),
        kijun: result.kijun?.toFixed(2),
        senkouA: result.senkouA?.toFixed(2),
        senkouB: result.senkouB?.toFixed(2),
        cloudTop: result.cloudTop?.toFixed(2),
        cloudBottom: result.cloudBottom?.toFixed(2),
        cloudColor: result.cloudColor,
        pricePosition: result.pricePosition,
        tkCross: result.tkCross,
        signal: result.signal,
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get Ichimoku: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// FlowScope Tool (Buy/Sell Volume Profile)
// ============================================================================

export const getFlowScopeTool = createTool({
  id: "get_flowscope",
  description:
    "Get volume flow analysis for a symbol: FlowScope buy/sell profile + Delta Ladder order flow. " +
    "FlowScope: buy vs sell pressure at each price level, POC imbalance, pressure score -100 to +100. " +
    "Delta Ladder: cumulative delta (net buying/selling), delta reversal detection, bar-by-bar flow.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    numBins: z.number().min(10).max(50).default(20).describe("Number of price bins (default 20)"),
    imbalanceThreshold: z
      .number()
      .min(0.55)
      .max(0.85)
      .default(0.65)
      .describe("Buy ratio threshold for imbalance detection (default 0.65)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    poc: z.string().optional(),
    pocBuyRatio: z.string().optional(),
    pocImbalanced: z.boolean().optional(),
    imbalanceDirection: z.enum(["buy", "sell", "neutral"]).optional(),
    pressureScore: z.number().optional(),
    overallBuyRatio: z.string().optional(),
    valueAreaHigh: z.string().optional(),
    valueAreaLow: z.string().optional(),
    interpretation: z.string().optional(),
    deltaLadder: z.object({
      currentDelta: z.string().optional(),
      cumulativeDelta: z.string().optional(),
      deltaRatio: z.string().optional(),
      poc: z.string().optional(),
      trend: z.string().optional(),
      reversal: z.boolean().optional(),
      signal: z.string().optional(),
      interpretation: z.string().optional(),
    }).optional(),
    orderFlowProxy: z.object({
      netFlow: z.number().optional(),
      buyPressure: z.number().optional(),
      sellPressure: z.number().optional(),
      absorption: z.boolean().optional(),
      flowBias: z.enum(["strong_buy", "buy", "neutral", "sell", "strong_sell"]).optional(),
      interpretation: z.string().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, numBins, imbalanceThreshold }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < 20) return errors.insufficientData(normalizedSymbol);

      const { calculateFlowScope, calculateDeltaLadder } = await import("../../../core/indicators/index.ts");
      const result = calculateFlowScope(candles, numBins, imbalanceThreshold);
      const delta = calculateDeltaLadder(candles);

      // Order Flow Proxy
      const ofpSlice = candles.slice(-20);
      const barDeltas: { buyP: number; sellP: number; delta: number }[] = [];
      for (const c of ofpSlice) {
        const range = c.high - c.low;
        const buyP = range < 1e-10 ? 0.5 : (c.close - c.low) / range;
        const sellP = range < 1e-10 ? 0.5 : (c.high - c.close) / range;
        barDeltas.push({ buyP, sellP, delta: c.volume * buyP - c.volume * sellP });
      }
      let cumDelta = 0, cumVol = 0;
      for (const b of barDeltas) { cumDelta += b.delta; cumVol += Math.abs(b.delta) + (b.buyP + b.sellP > 0 ? 1 : 0); }
      cumVol = ofpSlice.reduce((s, c) => s + c.volume, 0);
      const netFlow = cumVol > 0 ? Math.max(-1, Math.min(1, cumDelta / cumVol)) : 0;
      const short5 = barDeltas.slice(-5);
      const avgBuyP = short5.reduce((s, b) => s + b.buyP, 0) / short5.length;
      const avgSellP = short5.reduce((s, b) => s + b.sellP, 0) / short5.length;
      let ofpAbsorption = false;
      if (barDeltas.length >= 2) {
        const last = barDeltas[barDeltas.length - 1]!, prev = barDeltas[barDeltas.length - 2]!;
        const flipped = (prev.delta > 0 && last.delta < 0) || (prev.delta < 0 && last.delta > 0);
        if (flipped) {
          const lc = ofpSlice[ofpSlice.length - 1]!, pc = ofpSlice[ofpSlice.length - 2]!;
          ofpAbsorption = (pc.close > pc.open && lc.close > lc.open) || (pc.close < pc.open && lc.close < lc.open);
        }
      }
      const flowBias: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" =
        netFlow > 0.3 ? "strong_buy" : netFlow > 0.1 ? "buy" : netFlow < -0.3 ? "strong_sell" : netFlow < -0.1 ? "sell" : "neutral";

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        poc: result.poc?.toFixed(2),
        pocBuyRatio: `${(result.pocBuyRatio * 100).toFixed(0)}%`,
        pocImbalanced: result.pocImbalanced,
        imbalanceDirection: result.imbalanceDirection,
        pressureScore: result.pressureScore,
        overallBuyRatio: `${(result.overallBuyRatio * 100).toFixed(0)}%`,
        valueAreaHigh: result.valueAreaHigh?.toFixed(2),
        valueAreaLow: result.valueAreaLow?.toFixed(2),
        interpretation: result.interpretation,
        deltaLadder: {
          currentDelta: delta.currentDelta.toFixed(0),
          cumulativeDelta: delta.cumulativeDelta.toFixed(0),
          deltaRatio: `${(delta.deltaRatio * 100).toFixed(0)}%`,
          poc: delta.poc?.toFixed(2),
          trend: delta.trend,
          reversal: delta.reversal,
          signal: delta.signal,
          interpretation: delta.interpretation,
        },
        orderFlowProxy: {
          netFlow: Math.round(netFlow * 10000) / 10000,
          buyPressure: Math.round(avgBuyP * 10000) / 10000,
          sellPressure: Math.round(avgSellP * 10000) / 10000,
          absorption: ofpAbsorption,
          flowBias,
          interpretation: `Net flow: ${netFlow > 0 ? "+" : ""}${netFlow.toFixed(3)} (${flowBias.replace(/_/g, " ")}). Buy: ${(avgBuyP * 100).toFixed(0)}%, Sell: ${(avgSellP * 100).toFixed(0)}%${ofpAbsorption ? ". ABSORPTION detected" : ""}`,
        },
      };
    } catch (error) {
      return { error: `Failed to get FlowScope: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Angled Market Structure Tool
// ============================================================================

export const getAngledMarketStructureTool = createTool({
  id: "get_angled_market_structure",
  description:
    "Get Angled Market Structure (AMS) analysis for a symbol. " +
    "ATR-decaying pivot lines that slope over time — support rises, resistance falls. " +
    "Detects structure breaks when price crosses angled S/R levels. " +
    "Better than horizontal S/R — accounts for time decay of levels.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    pivotLen: z.number().min(3).max(15).default(5).describe("Pivot detection window (default 5)"),
    angleFactor: z
      .number()
      .min(0.001)
      .max(0.1)
      .default(0.01)
      .describe("ATR fraction for per-bar angle (default 0.01)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    nearestSupport: z.string().optional(),
    nearestResistance: z.string().optional(),
    supportCount: z.number().optional(),
    resistanceCount: z.number().optional(),
    structureBreak: z.boolean().optional(),
    breakDirection: z.enum(["bullish", "bearish", "none"]).optional(),
    atr: z.string().optional(),
    bias: z.enum(["bullish", "bearish", "neutral"]).optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, pivotLen, angleFactor }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < 30) return errors.insufficientData(normalizedSymbol);

      const { calculateAMS } = await import("../../../core/indicators/index.ts");
      const result = calculateAMS(candles, pivotLen, angleFactor);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        nearestSupport: result.nearestSupport?.toFixed(2),
        nearestResistance: result.nearestResistance?.toFixed(2),
        supportCount: result.supportLines.length,
        resistanceCount: result.resistanceLines.length,
        structureBreak: result.structureBreak,
        breakDirection: result.breakDirection,
        atr: result.atr?.toFixed(2),
        bias: result.bias,
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get AMS: ${(error as Error).message}` };
    }
  },
});


// ============================================================================
// False Breakout Reversal Tool
// ============================================================================

export const getFalseBreakoutTool = createTool({
  id: "get_false_breakout",
  description:
    "Detect false breakout reversals for a symbol. " +
    "Finds S/R levels, then checks if the last candle broke beyond a level and closed back inside. " +
    "Confirms with wick ratio (long wick = rejection) and volume spike. " +
    "bullish_reversal = false break below support (buy), bearish_reversal = false break above resistance (sell).",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    srLookback: z.number().min(3).max(15).default(5).describe("S/R pivot detection window (default 5)"),
    wickThreshold: z
      .number()
      .min(0.3)
      .max(0.9)
      .default(0.6)
      .describe("Min wick ratio for reversal candle (default 0.6)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    supportCount: z.number().optional(),
    resistanceCount: z.number().optional(),
    falseBreakout: z.boolean().optional(),
    signal: z.enum(["bullish_reversal", "bearish_reversal", "none"]).optional(),
    brokenLevel: z.string().optional(),
    wickRatio: z.string().optional(),
    volumeConfirmed: z.boolean().optional(),
    confidence: z.number().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, srLookback, wickThreshold }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < 20) return errors.insufficientData(normalizedSymbol);

      const { calculateFalseBreakout } = await import("../../../core/indicators/index.ts");
      const result = calculateFalseBreakout(candles, srLookback, undefined, wickThreshold);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        supportCount: result.supportLevels.length,
        resistanceCount: result.resistanceLevels.length,
        falseBreakout: result.falseBreakout,
        signal: result.signal,
        brokenLevel: result.brokenLevel?.toFixed(2),
        wickRatio: result.wickRatio !== null ? `${(result.wickRatio * 100).toFixed(0)}%` : undefined,
        volumeConfirmed: result.volumeConfirmed,
        confidence: result.confidence,
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get false breakout: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// ADX (Average Directional Index) Tool
// ============================================================================

export const getADXTool = createTool({
  id: "get_adx",
  description:
    "Get ADX (Average Directional Index) with +DI/-DI for a symbol. " +
    "Measures trend STRENGTH (not direction) — ADX > 25 = strong trend, < 20 = ranging. " +
    "+DI > -DI = bullish direction, -DI > +DI = bearish direction. " +
    "DI crossovers = trend reversal signals. Essential for filtering trend vs range strategies.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    period: z.number().min(7).max(30).default(14).describe("ADX period (default 14)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    adx: z.string().optional(),
    plusDI: z.string().optional(),
    minusDI: z.string().optional(),
    trendStrength: z.enum(["strong", "moderate", "weak", "absent"]).optional(),
    direction: z.enum(["bullish", "bearish", "neutral"]).optional(),
    diCrossover: z.enum(["bullish_cross", "bearish_cross", "none"]).optional(),
    signal: z.enum(["strong_buy", "buy", "neutral", "sell", "strong_sell"]).optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, period }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < period * 2 + 2) return errors.insufficientData(normalizedSymbol);

      const { calculateADX } = await import("../../../core/indicators/index.ts");
      const result = calculateADX(candles, period);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        adx: result.adx?.toFixed(1),
        plusDI: result.plusDI?.toFixed(1),
        minusDI: result.minusDI?.toFixed(1),
        trendStrength: result.trendStrength,
        direction: result.direction,
        diCrossover: result.diCrossover,
        signal: result.signal,
        interpretation: result.interpretation,
      };
    } catch (error) {
      return { error: `Failed to get ADX: ${(error as Error).message}` };
    }
  },
});


// ============================================================================
// Divergence Detection Tool
// ============================================================================

export const getDivergenceTool = createTool({
  id: "get_divergence",
  description:
    "Detect divergences for a symbol: RSI divergence + Volume Price Trend (VPT) divergence. " +
    "Bullish divergence: price lower low but indicator higher low → reversal UP. " +
    "Bearish divergence: price higher high but indicator lower high → reversal DOWN. " +
    "VPT adds volume-based divergence confirmation. Most reliable reversal signals.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    rsiPeriod: z.number().min(7).max(21).default(14).describe("RSI period (default 14)"),
    lookback: z.number().min(5).max(30).default(10).describe("Lookback for extreme detection (default 10)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    rsi: z.string().optional(),
    divergenceDetected: z.boolean().optional(),
    signal: z.enum(["bullish_divergence", "bearish_divergence", "none"]).optional(),
    strength: z.number().optional(),
    divergenceCount: z.number().optional(),
    interpretation: z.string().optional(),
    vpt: z.object({
      current: z.string().optional(),
      currentMA: z.string().optional(),
      slope: z.string().optional(),
      trend: z.string().optional(),
      divergence: z.string().optional(),
      interpretation: z.string().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, rsiPeriod, lookback }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < rsiPeriod + lookback * 2 + 2) return errors.insufficientData(normalizedSymbol);

      const { calculateDivergence, calculateVPT } = await import("../../../core/indicators/index.ts");
      const result = calculateDivergence(candles, rsiPeriod, lookback);
      const vpt = calculateVPT(candles);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        rsi: result.rsi?.toFixed(1),
        divergenceDetected: result.divergenceDetected,
        signal: result.signal,
        strength: result.strength,
        divergenceCount: result.divergences.length,
        interpretation: result.interpretation,
        vpt: {
          current: vpt.current?.toFixed(0),
          currentMA: vpt.currentMA?.toFixed(0),
          slope: vpt.slope?.toFixed(4),
          trend: vpt.trend,
          divergence: vpt.divergence,
          interpretation: vpt.interpretation,
        },
      };
    } catch (error) {
      return { error: `Failed to get divergence: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Supply/Demand Zones Tool
// ============================================================================

export const getSupplyDemandZonesTool = createTool({
  id: "get_supply_demand_zones",
  description:
    "Detect institutional zones for a symbol: Supply/Demand zones + Order Blocks. " +
    "Demand zones = price ranges where buying absorbed selling (support). " +
    "Supply zones = price ranges where selling absorbed buying (resistance). " +
    "Order Blocks = z-score extreme price moves with Kaplan-Meier survival probability. " +
    "Detects bounces, rejections, breakouts, and smart money levels.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    lookback: z.number().min(10).max(50).default(20).describe("Rolling window for zone detection (default 20)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    demandZoneCount: z.number().optional(),
    supplyZoneCount: z.number().optional(),
    inDemandZone: z.boolean().optional(),
    inSupplyZone: z.boolean().optional(),
    nearestDemand: z.object({
      lower: z.string(),
      upper: z.string(),
      tests: z.number(),
    }).optional(),
    nearestSupply: z.object({
      lower: z.string(),
      upper: z.string(),
      tests: z.number(),
    }).optional(),
    signal: z.enum(["demand_bounce", "supply_rejection", "breakout_up", "breakout_down", "none"]).optional(),
    interpretation: z.string().optional(),
    orderBlocks: z.object({
      bullishCount: z.number().optional(),
      bearishCount: z.number().optional(),
      nearestBullishOB: z.string().optional(),
      nearestBearishOB: z.string().optional(),
      bullishProbability: z.string().optional(),
      bearishProbability: z.string().optional(),
      newBlock: z.boolean().optional(),
      newBlockType: z.string().optional(),
      signal: z.string().optional(),
      interpretation: z.string().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, lookback }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < lookback + 6) return errors.insufficientData(normalizedSymbol);

      const { calculateSupplyDemandZones, calculateOrderBlocks } = await import("../../../core/indicators/index.ts");
      const result = calculateSupplyDemandZones(candles, lookback);
      const ob = calculateOrderBlocks(candles);

      return {
        symbol: normalizedSymbol,
        interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        demandZoneCount: result.demandZones.length,
        supplyZoneCount: result.supplyZones.length,
        inDemandZone: result.inDemandZone,
        inSupplyZone: result.inSupplyZone,
        nearestDemand: result.nearestDemand ? {
          lower: result.nearestDemand.lower.toFixed(2),
          upper: result.nearestDemand.upper.toFixed(2),
          tests: result.nearestDemand.tests,
        } : undefined,
        nearestSupply: result.nearestSupply ? {
          lower: result.nearestSupply.lower.toFixed(2),
          upper: result.nearestSupply.upper.toFixed(2),
          tests: result.nearestSupply.tests,
        } : undefined,
        signal: result.signal,
        interpretation: result.interpretation,
        orderBlocks: {
          bullishCount: ob.bullishBlocks.length,
          bearishCount: ob.bearishBlocks.length,
          nearestBullishOB: ob.nearestBullishOB?.toFixed(2),
          nearestBearishOB: ob.nearestBearishOB?.toFixed(2),
          bullishProbability: `${(ob.bullishProbability * 100).toFixed(0)}%`,
          bearishProbability: `${(ob.bearishProbability * 100).toFixed(0)}%`,
          newBlock: ob.newBlock,
          newBlockType: ob.newBlockType,
          signal: ob.signal,
          interpretation: ob.interpretation,
        },
      };
    } catch (error) {
      return { error: `Failed to get supply/demand zones: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Squeeze Momentum Tool
// ============================================================================

export const getSqueezeMomentumTool = createTool({
  id: "get_squeeze_momentum",
  description:
    "Get Squeeze Momentum (LazyBear) for a symbol. " +
    "Detects when Bollinger Bands contract inside Keltner Channels = volatility squeeze. " +
    "Squeeze ON = compression building, Squeeze FIRED = breakout imminent. " +
    "Momentum via linear regression slope shows direction of breakout.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    squeezeOn: z.boolean().optional(),
    squeezeFired: z.boolean().optional(),
    momentum: z.string().optional(),
    momentumColor: z.string().optional(),
    signal: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;
    const normalizedSymbol = normalizeSymbol(symbol);
    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < 30) return errors.insufficientData(normalizedSymbol);
      const { calculateSqueezeMomentum } = await import("../../../core/indicators/index.ts");
      const result = calculateSqueezeMomentum(candles);
      return {
        symbol: normalizedSymbol, interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        squeezeOn: result.squeezeOn, squeezeFired: result.squeezeFired,
        momentum: result.momentum?.toFixed(4), momentumColor: result.momentumColor,
        signal: result.signal, interpretation: result.interpretation,
      };
    } catch (error) { return { error: `Failed to get Squeeze Momentum: ${(error as Error).message}` }; }
  },
});


// ============================================================================
// Fair Value Gap (FVG) Tool
// ============================================================================

export const getFVGTool = createTool({
  id: "get_fvg",
  description:
    "Detect Fair Value Gaps (FVG) for a symbol. " +
    "3-bar pattern where bar[i].low > bar[i-2].high (bullish gap) or vice versa. " +
    "Unfilled gaps act as magnets — price tends to return to fill them. " +
    "Volume confirmation validates gap strength.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    bullishGapCount: z.number().optional(),
    bearishGapCount: z.number().optional(),
    unfilledCount: z.number().optional(),
    newGap: z.boolean().optional(),
    newGapType: z.string().optional(),
    nearestBullishFVG: z.string().optional(),
    nearestBearishFVG: z.string().optional(),
    signal: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;
    const normalizedSymbol = normalizeSymbol(symbol);
    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < 25) return errors.insufficientData(normalizedSymbol);
      const { calculateFVG } = await import("../../../core/indicators/index.ts");
      const result = calculateFVG(candles);
      return {
        symbol: normalizedSymbol, interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        bullishGapCount: result.bullishGaps.length, bearishGapCount: result.bearishGaps.length,
        unfilledCount: result.unfilledCount,
        newGap: result.newGap, newGapType: result.newGapType,
        nearestBullishFVG: result.nearestBullishFVG ? `${result.nearestBullishFVG.low.toFixed(2)}-${result.nearestBullishFVG.high.toFixed(2)}` : undefined,
        nearestBearishFVG: result.nearestBearishFVG ? `${result.nearestBearishFVG.low.toFixed(2)}-${result.nearestBearishFVG.high.toFixed(2)}` : undefined,
        signal: result.signal, interpretation: result.interpretation,
      };
    } catch (error) { return { error: `Failed to get FVG: ${(error as Error).message}` }; }
  },
});

// ============================================================================
// Parabolic SAR Tool
// ============================================================================

export const getParabolicSARTool = createTool({
  id: "get_parabolic_sar",
  description:
    "Get Parabolic SAR (Stop and Reverse) for a symbol. " +
    "Classic trend-following indicator with accelerating trailing stop. " +
    "SAR below price = uptrend, above = downtrend. Direction flip = reversal signal. " +
    "Best for identifying trend direction and setting trailing stops.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    afStart: z.number().min(0.01).max(0.05).default(0.02).describe("Initial acceleration factor (default 0.02)"),
    afMax: z.number().min(0.1).max(0.5).default(0.2).describe("Max acceleration factor (default 0.2)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    sar: z.string().optional(),
    direction: z.string().optional(),
    trendChange: z.boolean().optional(),
    signal: z.string().optional(),
    distance: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, afStart, afMax }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;
    const normalizedSymbol = normalizeSymbol(symbol);
    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 250);
      if (!candles || candles.length < 10) return errors.insufficientData(normalizedSymbol);
      const { calculateParabolicSAR } = await import("../../../core/indicators/index.ts");
      const result = calculateParabolicSAR(candles, afStart, afStart, afMax);
      return {
        symbol: normalizedSymbol, interval,
        currentPrice: candles[candles.length - 1]!.close.toFixed(2),
        sar: result.current?.toFixed(2),
        direction: result.currentDirection === 1 ? "UPTREND" : "DOWNTREND",
        trendChange: result.trendChange, signal: result.signal,
        distance: result.distance !== null ? `${result.distance}%` : undefined,
        interpretation: result.interpretation,
      };
    } catch (error) { return { error: `Failed to get Parabolic SAR: ${(error as Error).message}` }; }
  },
});





// ============================================================================
// ATR Rope Smoothing Tool
// ============================================================================

export const getATRRopeTool = createTool({
  id: "get_atr_rope",
  description:
    "ATR Rope Smoothing — adaptive price filter that only moves on significant price changes. " +
    "Filters noise by requiring ATR-threshold moves before updating direction. " +
    "Rope stays flat during consolidation, steps only on real moves. " +
    "distanceFromRope in ATR units shows how stretched price is.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    threshold: z.number().min(0.1).max(5.0).default(1.0).describe("ATR multiplier threshold (default 1.0)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    ropeValue: z.string().optional(),
    direction: z.enum(["bullish", "bearish", "flat"]).optional(),
    distanceFromRope: z.string().optional(),
    barsFlat: z.number().optional(),
    lastFlipBarsAgo: z.number().optional(),
    atr: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, threshold }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;
    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 100);
      if (!candles || candles.length < 30) return errors.insufficientData(normalizedSymbol);

      // ATR(14) with Wilder's smoothing
      const atrP = 14;
      const trs: number[] = [];
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i]!;
        if (i === 0) { trs.push(c.high - c.low); continue; }
        const p = candles[i - 1]!;
        trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
      }
      const atrs: number[] = new Array(candles.length).fill(0);
      let atrSum = 0;
      for (let i = 0; i < atrP; i++) atrSum += trs[i]!;
      atrs[atrP - 1] = atrSum / atrP;
      for (let i = atrP; i < candles.length; i++) atrs[i] = (atrs[i - 1]! * (atrP - 1) + trs[i]!) / atrP;

      // Rope algorithm
      const rope: number[] = new Array(candles.length).fill(0);
      const dirs: number[] = new Array(candles.length).fill(0);
      rope[0] = candles[0]!.close; dirs[0] = 0;
      for (let i = 1; i < candles.length; i++) {
        const close = candles[i]!.close;
        const atr = atrs[i]!;
        if (i < atrP || atr <= 0) { rope[i] = close; dirs[i] = close > candles[i-1]!.close ? 1 : -1; continue; }
        const band = atr * threshold;
        if (close > rope[i-1]! + band) { rope[i] = close - band; dirs[i] = 1; }
        else if (close < rope[i-1]! - band) { rope[i] = close + band; dirs[i] = -1; }
        else { rope[i] = rope[i-1]!; dirs[i] = dirs[i-1]!; }
      }

      const last = candles.length - 1;
      const cp = candles[last]!.close;
      const rv = rope[last]!;
      const ca = atrs[last]!;
      let barsFlat = 0;
      for (let i = last; i >= 1; i--) { if (Math.abs(rope[i]! - rope[i-1]!) < 1e-10) barsFlat++; else break; }
      let lastFlip = last;
      for (let i = last; i >= 1; i--) { if (dirs[i] !== dirs[i-1]) { lastFlip = last - i; break; } }
      const dist = ca > 0 ? (cp - rv) / ca : 0;
      const dir: "bullish" | "bearish" | "flat" = dirs[last] === 1 ? "bullish" : dirs[last] === -1 ? "bearish" : "flat";
      let interp = `${dir.charAt(0).toUpperCase() + dir.slice(1)} — price ${Math.abs(dist).toFixed(2)} ATR ${dist >= 0 ? "above" : "below"} rope at ${rv.toFixed(2)}.`;
      if (barsFlat >= 5) interp += ` Rope flat ${barsFlat} bars (consolidation).`;
      if (lastFlip <= 3 && lastFlip > 0) interp += ` Fresh flip ${lastFlip} bar(s) ago.`;

      return { symbol: normalizedSymbol, interval, currentPrice: cp.toFixed(2), ropeValue: rv.toFixed(2), direction: dir, distanceFromRope: dist.toFixed(2), barsFlat, lastFlipBarsAgo: lastFlip, atr: ca.toFixed(2), interpretation: interp };
    } catch (error) { return { error: `Failed to get ATR Rope: ${(error as Error).message}` }; }
  },
});

// ============================================================================
// Linear Regression Channel Tool
// ============================================================================

export const getLinearRegressionTool = createTool({
  id: "get_linear_regression",
  description:
    "Linear Regression Channel — rolling regression line with deviation bands and R² correlation strength. " +
    "Identifies trend direction, slope strength, and when price deviates from the regression channel. " +
    "R² > 0.7 = strong trend. Price above upper band = overextended, below lower = oversold.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    regressionValue: z.string().optional(),
    slope: z.string().optional(),
    slopePercent: z.string().optional(),
    upperBand: z.string().optional(),
    lowerBand: z.string().optional(),
    rSquared: z.string().optional(),
    pricePosition: z.enum(["above_upper", "upper_half", "lower_half", "below_lower"]).optional(),
    trendStrength: z.enum(["strong", "moderate", "weak"]).optional(),
    trendDirection: z.enum(["bullish", "bearish", "flat"]).optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;
    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 100);
      if (!candles || candles.length < 50) return errors.insufficientData(normalizedSymbol);

      const LB = 50, BM = 1.5;
      const closes = candles.slice(-LB).map(c => c.close);
      const N = closes.length;
      const cp = candles[candles.length - 1]!.close;

      let sX = 0, sY = 0, sXY = 0, sX2 = 0, sY2 = 0;
      for (let i = 0; i < N; i++) { sX += i; sY += closes[i]!; sXY += i * closes[i]!; sX2 += i * i; sY2 += closes[i]! * closes[i]!; }

      const denom = N * sX2 - sX * sX;
      if (denom === 0) return { error: "Degenerate data" };
      const slope = (N * sXY - sX * sY) / denom;
      const intercept = (sY - slope * sX) / N;
      const regVal = intercept + slope * (N - 1);

      let sumR2 = 0;
      for (let i = 0; i < N; i++) { const r = closes[i]! - (intercept + slope * i); sumR2 += r * r; }
      const stdDev = Math.sqrt(sumR2 / N);
      const upper = regVal + BM * stdDev, lower = regVal - BM * stdDev;

      const rNum = N * sXY - sX * sY;
      const rDen = Math.sqrt((N * sX2 - sX * sX) * (N * sY2 - sY * sY));
      const R = rDen !== 0 ? rNum / rDen : 0;
      const r2 = R * R;
      const slopePct = regVal !== 0 ? (slope / regVal) * 100 : 0;

      const pos: "above_upper" | "upper_half" | "lower_half" | "below_lower" =
        cp > upper ? "above_upper" : cp >= regVal ? "upper_half" : cp >= lower ? "lower_half" : "below_lower";
      const strength: "strong" | "moderate" | "weak" = r2 > 0.7 ? "strong" : r2 > 0.4 ? "moderate" : "weak";
      const dir: "bullish" | "bearish" | "flat" = Math.abs(slopePct) < 0.01 ? "flat" : slope > 0 ? "bullish" : "bearish";

      let interp = `${strength.toUpperCase()} ${dir} trend (R²=${r2.toFixed(2)}, slope=${slopePct.toFixed(3)}%/bar). `;
      if (pos === "above_upper") interp += `Price above upper band — overextended.`;
      else if (pos === "below_lower") interp += `Price below lower band — oversold vs trend.`;
      else interp += `Price in ${pos.replace("_", " ")} of channel.`;

      return { symbol: normalizedSymbol, interval, currentPrice: cp.toFixed(2), regressionValue: regVal.toFixed(2), slope: slope.toFixed(6), slopePercent: slopePct.toFixed(4), upperBand: upper.toFixed(2), lowerBand: lower.toFixed(2), rSquared: r2.toFixed(4), pricePosition: pos, trendStrength: strength, trendDirection: dir, interpretation: interp };
    } catch (error) { return { error: `Failed to get Linear Regression: ${(error as Error).message}` }; }
  },
});

// ============================================================================
// Waddah Attar Explosion (WAE) Tool
// ============================================================================

export const getWAETool = createTool({
  id: "get_wae",
  description:
    "Waddah Attar Explosion — momentum-envelope confluence indicator with dead zone noise filter. " +
    "Compares MACD momentum delta against Bollinger Band envelope width. " +
    "Signals fire only when momentum exceeds BOTH the envelope AND a dead zone (ATR-based noise floor). " +
    "Eliminates whipsaw in ranging markets. Returns explosion strength, direction, and whether dead zone is cleared.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    interval: z.enum(["1h", "4h", "1d"]).default("4h").describe("Timeframe"),
    sensitivity: z.number().min(50).max(300).default(150).describe("Sensitivity multiplier for MACD delta (default 150)"),
    deadZoneMult: z.number().min(1.0).max(6.0).default(3.7).describe("Dead zone ATR multiplier (default 3.7)"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    interval: z.string().optional(),
    currentPrice: z.string().optional(),
    trendUp: z.string().optional(),
    trendDown: z.string().optional(),
    explosion: z.string().optional(),
    deadZone: z.string().optional(),
    direction: z.enum(["bullish", "bearish", "neutral"]).optional(),
    aboveDeadZone: z.boolean().optional(),
    aboveExplosion: z.boolean().optional(),
    signal: z.enum(["strong_buy", "strong_sell", "weak_buy", "weak_sell", "none"]).optional(),
    momentumWeakening: z.boolean().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, interval, sensitivity, deadZoneMult }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) return errors.noExchange;
    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, 120);
      if (!candles || candles.length < 50) return errors.insufficientData(normalizedSymbol);

      const closes = candles.map(c => c.close);

      // EMA helper (reusing local scope)
      const ema = (data: number[], period: number): number[] => {
        const mult = 2 / (period + 1);
        const result: number[] = [];
        let val = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = 0; i < period - 1; i++) result.push(NaN);
        result.push(val);
        for (let i = period; i < data.length; i++) {
          val = (data[i]! - val) * mult + val;
          result.push(val);
        }
        return result;
      };

      // MACD line = EMA(fast) - EMA(slow)
      const fastEMA = ema(closes, 20);
      const slowEMA = ema(closes, 40);
      const macd: number[] = [];
      for (let i = 0; i < closes.length; i++) {
        const f = fastEMA[i]!;
        const s = slowEMA[i]!;
        macd.push(isNaN(f) || isNaN(s) ? 0 : f - s);
      }

      // t1 = (MACD[i] - MACD[i-1]) * sensitivity
      const len = closes.length;
      const t1Curr = (macd[len - 1]! - macd[len - 2]!) * sensitivity;
      const t1Prev = (macd[len - 2]! - macd[len - 3]!) * sensitivity;

      const trendUpVal = t1Curr >= 0 ? t1Curr : 0;
      const trendDownVal = t1Curr < 0 ? -t1Curr : 0;
      const prevTrendUp = t1Prev >= 0 ? t1Prev : 0;
      const prevTrendDown = t1Prev < 0 ? -t1Prev : 0;

      // Bollinger Band envelope = upper - lower (BB channel width)
      const bbPeriod = 20;
      const bbMult = 2.0;
      const bbSlice = closes.slice(-bbPeriod);
      const bbMean = bbSlice.reduce((a, b) => a + b, 0) / bbPeriod;
      const bbStdDev = Math.sqrt(bbSlice.reduce((s, v) => s + (v - bbMean) ** 2, 0) / bbPeriod);
      const explosionLine = 2 * bbMult * bbStdDev; // upper - lower = 2 * mult * stddev

      // Dead zone = RMA(TR, 100) * deadZoneMult
      const trs: number[] = [];
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i]!;
        if (i === 0) { trs.push(c.high - c.low); continue; }
        const p = candles[i - 1]!;
        trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
      }
      // RMA(100) — Wilder's smoothing
      const rmaPeriod = Math.min(100, trs.length);
      let rmaVal = trs.slice(0, rmaPeriod).reduce((a, b) => a + b, 0) / rmaPeriod;
      for (let i = rmaPeriod; i < trs.length; i++) {
        rmaVal = (rmaVal * (rmaPeriod - 1) + trs[i]!) / rmaPeriod;
      }
      const deadZoneVal = rmaVal * deadZoneMult;

      // Signal logic
      const momentum = Math.max(trendUpVal, trendDownVal);
      const aboveDeadZone = momentum > deadZoneVal;
      const aboveExplosion = momentum > explosionLine;
      const dir: "bullish" | "bearish" | "neutral" = trendUpVal > 0 ? "bullish" : trendDownVal > 0 ? "bearish" : "neutral";

      const weakening = dir === "bullish"
        ? trendUpVal < prevTrendUp
        : dir === "bearish"
          ? trendDownVal < prevTrendDown
          : false;

      let signal: "strong_buy" | "strong_sell" | "weak_buy" | "weak_sell" | "none" = "none";
      if (dir === "bullish" && aboveDeadZone && aboveExplosion) signal = weakening ? "weak_buy" : "strong_buy";
      else if (dir === "bearish" && aboveDeadZone && aboveExplosion) signal = weakening ? "weak_sell" : "strong_sell";

      const cp = closes[len - 1]!;
      const parts: string[] = [];
      if (signal === "strong_buy") parts.push("Strong bullish explosion — momentum exceeds both dead zone and BB envelope");
      else if (signal === "strong_sell") parts.push("Strong bearish explosion — momentum exceeds both dead zone and BB envelope");
      else if (signal === "weak_buy") parts.push("Bullish explosion but momentum weakening — consider tightening stops");
      else if (signal === "weak_sell") parts.push("Bearish explosion but momentum weakening — consider tightening stops");
      else if (!aboveDeadZone) parts.push("Inside dead zone — no actionable signal, market is ranging");
      else parts.push("Momentum above dead zone but below explosion line — building, not yet confirmed");

      return {
        symbol: normalizedSymbol, interval, currentPrice: cp.toFixed(2),
        trendUp: trendUpVal.toFixed(4), trendDown: trendDownVal.toFixed(4),
        explosion: explosionLine.toFixed(4), deadZone: deadZoneVal.toFixed(4),
        direction: dir, aboveDeadZone, aboveExplosion, signal, momentumWeakening: weakening,
        interpretation: parts.join(". "),
      };
    } catch (error) { return { error: `Failed to get WAE: ${(error as Error).message}` }; }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

export const indicatorTools = {
  get_technical_analysis: createCachedTool(getTechnicalAnalysisTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_technical_signals: createCachedTool(getTechnicalSignalsTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_rsi: createCachedTool(getRSITool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_stop_loss_levels: createCachedTool(getStopLossLevelsTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_position_size: createCachedTool(getPositionSizeTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_vwap: createCachedTool(getVWAPTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_camarilla_pivots: createCachedTool(getCamarillaPivotsTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_markov_regime: createCachedTool(getMarkovRegimeTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_supertrend: createCachedTool(getSupertrendTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_ichimoku: createCachedTool(getIchimokuTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_flowscope: createCachedTool(getFlowScopeTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_angled_market_structure: createCachedTool(getAngledMarketStructureTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_false_breakout: createCachedTool(getFalseBreakoutTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_adx: createCachedTool(getADXTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_divergence: createCachedTool(getDivergenceTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_supply_demand_zones: createCachedTool(getSupplyDemandZonesTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_squeeze_momentum: createCachedTool(getSqueezeMomentumTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_fvg: createCachedTool(getFVGTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_parabolic_sar: createCachedTool(getParabolicSARTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_atr_rope: createCachedTool(getATRRopeTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_linear_regression: createCachedTool(getLinearRegressionTool, TOOL_CACHE_CONFIG.indicators.ttl),
  get_wae: createCachedTool(getWAETool, TOOL_CACHE_CONFIG.indicators.ttl),
};

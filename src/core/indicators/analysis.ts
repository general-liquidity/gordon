/**
 * Composite Technical Analysis
 * Combines all indicators into actionable insights
 */

import { calculateRSI } from "./rsi.ts";
import { calculateMultiEMA } from "./ema.ts";
import { calculateMACD } from "./macd.ts";
import { calculateATR } from "./atr.ts";
import { calculateBollingerBands } from "./bollinger.ts";
import type { Candle, TechnicalAnalysis, TechnicalSignals } from "./types.ts";

/**
 * Calculate full technical analysis for a symbol
 */
export function calculateTechnicalAnalysis(
  candles: Candle[],
  symbol: string,
  interval: string,
  atrMultiplier: number = 1.5,
): TechnicalAnalysis {
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1]!;

  // Calculate all indicators
  const rsi = calculateRSI(closes);
  const ema = calculateMultiEMA(closes, currentPrice);
  const macd = calculateMACD(closes);
  const atr = calculateATR(candles, 14, currentPrice, atrMultiplier);
  const bollinger = calculateBollingerBands(closes, 20, 2, currentPrice);

  // Calculate composite bias
  const biasScore = calculateBiasScore(rsi, ema, macd, bollinger);
  const bias = getBias(biasScore);
  const confidence = getConfidence(rsi, ema, macd);

  // Generate summary
  const summary = generateSummary(rsi, ema, macd, bollinger, bias);

  // Generate actionable signals
  const signals = generateSignals(rsi, ema, macd, bollinger, biasScore);

  return {
    symbol,
    interval,
    timestamp: Date.now(),
    rsi,
    ema,
    macd,
    atr,
    bollinger,
    bias,
    confidence,
    summary,
    signals,
  };
}

/**
 * Calculate quick technical signals for scanner
 */
export function calculateTechnicalSignals(candles: Candle[], symbol: string): TechnicalSignals {
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1]!;

  const rsi = calculateRSI(closes);
  const ema = calculateMultiEMA(closes, currentPrice);
  const macd = calculateMACD(closes);
  const bollinger = calculateBollingerBands(closes, 20, 2, currentPrice);

  // Calculate score (-100 to +100)
  const score = calculateBiasScore(rsi, ema, macd, bollinger);

  // Determine overall bias
  let overallBias: "bullish" | "bearish" | "neutral" = "neutral";
  if (score > 25) overallBias = "bullish";
  else if (score < -25) overallBias = "bearish";

  return {
    symbol,
    rsiSignal: rsi.signal,
    rsiValue: rsi.current,
    trendAlignment: ema.alignment,
    macdTrend: macd.trend,
    priceVsEma200: ema.ema200 && currentPrice > ema.ema200 ? "above" : "below",
    bollingerPosition: bollinger.position,
    overallBias,
    score,
  };
}

/**
 * Calculate bias score from -100 to +100
 */
function calculateBiasScore(
  rsi: ReturnType<typeof calculateRSI>,
  ema: ReturnType<typeof calculateMultiEMA>,
  macd: ReturnType<typeof calculateMACD>,
  bollinger: ReturnType<typeof calculateBollingerBands>,
): number {
  let score = 0;

  // RSI contribution (-30 to +30)
  if (rsi.current !== null) {
    if (rsi.current < 30) score += 30;
    else if (rsi.current < 40) score += 15;
    else if (rsi.current < 50) score += 0;
    else if (rsi.current < 60) score -= 0;
    else if (rsi.current < 70) score -= 15;
    else score -= 30;
  }

  // EMA alignment contribution (-25 to +25)
  if (ema.alignment === "bullish") score += 25;
  else if (ema.alignment === "bearish") score -= 25;

  // Price vs EMA200 (-15 to +15)
  if (ema.pricePosition === "above_all") score += 15;
  else if (ema.pricePosition === "below_all") score -= 15;

  // MACD contribution (-20 to +20)
  if (macd.trend === "bullish") score += 15;
  else if (macd.trend === "bearish") score -= 15;

  if (macd.crossover === "bullish_cross") score += 5;
  else if (macd.crossover === "bearish_cross") score -= 5;

  // Bollinger contribution (-10 to +10)
  if (bollinger.position === "below_lower") score += 10;
  else if (bollinger.position === "lower") score += 5;
  else if (bollinger.position === "above_upper") score -= 10;
  else if (bollinger.position === "upper") score -= 5;

  return Math.max(-100, Math.min(100, score));
}

/**
 * Convert score to bias label
 */
export function getBias(score: number): TechnicalAnalysis["bias"] {
  if (score >= 50) return "strongly_bullish";
  if (score >= 20) return "bullish";
  if (score <= -50) return "strongly_bearish";
  if (score <= -20) return "bearish";
  return "neutral";
}

/**
 * Calculate confidence level
 */
function getConfidence(
  rsi: ReturnType<typeof calculateRSI>,
  ema: ReturnType<typeof calculateMultiEMA>,
  macd: ReturnType<typeof calculateMACD>,
): "high" | "medium" | "low" {
  const _agreements = 0;

  // Check if indicators agree
  const rsiBullish = rsi.current !== null && rsi.current < 50;
  const emaBullish = ema.alignment === "bullish" || ema.pricePosition === "above_all";
  const macdBullish = macd.trend === "bullish";

  const rsiBearish = rsi.current !== null && rsi.current > 50;
  const emaBearish = ema.alignment === "bearish" || ema.pricePosition === "below_all";
  const macdBearish = macd.trend === "bearish";

  if ((rsiBullish && emaBullish && macdBullish) || (rsiBearish && emaBearish && macdBearish)) {
    return "high";
  }

  if (
    (rsiBullish && emaBullish) ||
    (rsiBullish && macdBullish) ||
    (emaBullish && macdBullish) ||
    (rsiBearish && emaBearish) ||
    (rsiBearish && macdBearish) ||
    (emaBearish && macdBearish)
  ) {
    return "medium";
  }

  return "low";
}

/**
 * Generate human-readable summary
 */
function generateSummary(
  rsi: ReturnType<typeof calculateRSI>,
  ema: ReturnType<typeof calculateMultiEMA>,
  macd: ReturnType<typeof calculateMACD>,
  bollinger: ReturnType<typeof calculateBollingerBands>,
  bias: TechnicalAnalysis["bias"],
): string {
  const parts: string[] = [];

  // RSI summary
  if (rsi.signal === "oversold") {
    parts.push("RSI oversold");
  } else if (rsi.signal === "overbought") {
    parts.push("RSI overbought");
  }

  // EMA summary
  if (ema.alignment === "bullish") {
    parts.push("bullish EMA alignment");
  } else if (ema.alignment === "bearish") {
    parts.push("bearish EMA alignment");
  }

  // MACD summary
  if (macd.crossover !== "none") {
    parts.push(`MACD ${macd.crossover.replace("_", " ")}`);
  } else if (macd.trend !== "neutral") {
    parts.push(`${macd.trend} MACD momentum`);
  }

  // Bollinger summary
  if (bollinger.squeeze) {
    parts.push("Bollinger squeeze (breakout setup)");
  } else if (bollinger.position === "below_lower" || bollinger.position === "above_upper") {
    parts.push(`price ${bollinger.position.replace("_", " ")}`);
  }

  if (parts.length === 0) {
    return "Mixed signals - no clear directional bias";
  }

  const biasLabel = bias.replace("_", " ");
  return `${biasLabel.charAt(0).toUpperCase() + biasLabel.slice(1)}: ${parts.join(", ")}`;
}

/**
 * Generate actionable signals
 */
function generateSignals(
  rsi: ReturnType<typeof calculateRSI>,
  ema: ReturnType<typeof calculateMultiEMA>,
  macd: ReturnType<typeof calculateMACD>,
  bollinger: ReturnType<typeof calculateBollingerBands>,
  score: number,
): TechnicalAnalysis["signals"] {
  const reasons: string[] = [];

  // Strong buy signals
  if (score >= 40) {
    if (rsi.signal === "oversold") reasons.push("RSI oversold - reversal potential");
    if (ema.alignment === "bullish") reasons.push("Bullish EMA stack");
    if (macd.crossover === "bullish_cross") reasons.push("MACD bullish crossover");
    if (bollinger.position === "below_lower") reasons.push("Price at lower Bollinger band");

    return { type: "buy", reasons };
  }

  // Strong sell signals
  if (score <= -40) {
    if (rsi.signal === "overbought") reasons.push("RSI overbought - pullback likely");
    if (ema.alignment === "bearish") reasons.push("Bearish EMA stack");
    if (macd.crossover === "bearish_cross") reasons.push("MACD bearish crossover");
    if (bollinger.position === "above_upper") reasons.push("Price at upper Bollinger band");

    return { type: "sell", reasons };
  }

  // Hold signals
  reasons.push("Mixed or neutral signals");
  if (ema.alignment === "mixed") reasons.push("EMAs not aligned");
  if (macd.trend === "neutral") reasons.push("MACD momentum flat");

  return { type: "hold", reasons };
}

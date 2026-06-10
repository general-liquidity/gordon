/**
 * Analyzer module for Gordon CLI
 *
 * Performs deep, deterministic analysis on a single coin.
 * No AI involved - purely technical indicator and level analysis.
 */

import type { Exchange } from "../../infra/exchange/index.ts";
import { calculateIndicators } from "../indicators/scanner-bundle.ts";
import { detectLevels } from "../indicators/price-levels.ts";
import type { CoinAnalysis, Level, Candle, Indicators, Trend, Bias, Risk } from "../../types/index.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("analyzer");

// ============================================================================
// Types
// ============================================================================

interface AnalyzeOptions {
  timeframes?: string[]; // default ["1h", "4h"]
  candleLimit?: number; // default 100
}

export interface DetailedAnalysis extends CoinAnalysis {
  supports: Level[]; // S1, S2, S3 (sorted by proximity)
  resistances: Level[]; // R1, R2, R3 (sorted by proximity)
  volumeTrend: "rising" | "falling" | "stable";
  macdState: "bullish_cross" | "bearish_cross" | "bullish" | "bearish" | "neutral";
  rsiState: "oversold" | "overbought" | "neutral";
  setupDetails: {
    nearestSupport: Level | null;
    distanceToSupport: number; // percentage
    setupValid: boolean;
    invalidationPrice: number; // price where setup fails
  };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEFRAMES = ["1h", "4h"];
const DEFAULT_CANDLE_LIMIT = 100;

// RSI thresholds
const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;

// Volume analysis - compare recent vs older periods
const VOLUME_RECENT_PERIODS = 10;
const VOLUME_OLDER_PERIODS = 20;
const VOLUME_STABLE_THRESHOLD = 0.1; // 10% change considered stable

// Support Bounce setup thresholds
const SETUP_MAX_DISTANCE_PERCENT = 5; // Max 5% away from support for valid setup
const INVALIDATION_BUFFER_PERCENT = 1; // 1% below support is invalidation

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Perform deep analysis on a single coin
 *
 * @param client - BinanceClient instance for fetching market data
 * @param symbol - Trading pair symbol (e.g., "BTCUSDT")
 * @param options - Analysis options (timeframes, candle limit)
 * @returns Detailed analysis with supports, resistances, and setup details
 */
export async function analyze(
  client: Exchange,
  symbol: string,
  options?: AnalyzeOptions
): Promise<DetailedAnalysis> {
  const timeframes = options?.timeframes ?? DEFAULT_TIMEFRAMES;
  const candleLimit = options?.candleLimit ?? DEFAULT_CANDLE_LIMIT;

  logger.debug("Starting analysis", { symbol, timeframes, candleLimit });

  try {
    // Fetch candles for the primary timeframe (first in list)
    const primaryTimeframe = timeframes[0] ?? "1h";
    const candles = await client.getCandles(symbol, primaryTimeframe, candleLimit);

    if (!candles || candles.length === 0) {
      return createEmptyAnalysis(symbol);
    }

    // Get current price from the most recent candle
    const currentCandle = candles[candles.length - 1];
    if (!currentCandle) {
      return createEmptyAnalysis(symbol);
    }
    const currentPrice = currentCandle.close;

    // Calculate all technical indicators
    const indicators = calculateIndicators(candles);

    // Detect support and resistance levels
    const allLevels = detectLevels(candles);

    // Separate and sort supports and resistances by proximity
    const { supports, resistances } = separateAndSortLevels(allLevels, currentPrice);

    // Analyze volume trend
    const volumeTrend = analyzeVolumeTrend(candles);

    // Determine MACD state
    const macdState = determineMacdState(candles, indicators);

    // Determine RSI state
    const rsiState = determineRsiState(indicators.rsi);

    // Calculate 24h change (approximate from candles if needed)
    const change24h = calculate24hChange(candles, primaryTimeframe ?? "1h");

    // Calculate 24h volume
    const volume24h = calculateVolume(candles, primaryTimeframe ?? "1h");

    // Determine overall trend
    const trend = determineTrend(candles, indicators);

    // Determine bias based on indicators
    const bias = determineBias(macdState, rsiState, trend);

    // Determine risk level
    const risk = determineRisk(rsiState, volumeTrend, supports, currentPrice);

    // Calculate Support Bounce setup details
    const setupDetails = calculateSetupDetails(supports, currentPrice);

    // Determine if a valid setup is detected
    const setupDetected = setupDetails.setupValid;
    const setupConfidence = calculateSetupConfidence(setupDetails, volumeTrend, rsiState);

    const result: DetailedAnalysis = {
      // Base CoinAnalysis fields
      symbol,
      price: currentPrice,
      change24h,
      volume24h,
      indicators,
      levels: allLevels,
      trend,
      setupDetected,
      setupConfidence,
      bias,
      risk,

      // Extended DetailedAnalysis fields
      supports,
      resistances,
      volumeTrend,
      macdState,
      rsiState,
      setupDetails,
    };

    logger.debug("Analysis complete", {
      symbol,
      trend,
      bias,
      setupDetected,
      setupConfidence: setupConfidence.toFixed(2)
    });

    return result;
  } catch (error) {
    // On error, return sensible defaults
    logger.error("Analysis failed", error instanceof Error ? error : undefined, { symbol });
    return createEmptyAnalysis(symbol);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an empty analysis with default values when data is unavailable
 */
function createEmptyAnalysis(symbol: string): DetailedAnalysis {
  return {
    symbol,
    price: 0,
    change24h: 0,
    volume24h: 0,
    indicators: {
      rsi: null,
      macd: null,
      volumeMA: null,
      volumeRatio: null,
    },
    levels: [],
    trend: "range",
    setupDetected: false,
    setupConfidence: 0,
    bias: "neutral",
    risk: "high",

    supports: [],
    resistances: [],
    volumeTrend: "stable",
    macdState: "neutral",
    rsiState: "neutral",
    setupDetails: {
      nearestSupport: null,
      distanceToSupport: 0,
      setupValid: false,
      invalidationPrice: 0,
    },
  };
}

/**
 * Separate levels into supports and resistances, sorted by proximity to current price
 */
function separateAndSortLevels(
  levels: Level[],
  currentPrice: number
): { supports: Level[]; resistances: Level[] } {
  const supports = levels
    .filter((level) => level.type === "support")
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));

  const resistances = levels
    .filter((level) => level.type === "resistance")
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));

  return { supports, resistances };
}

/**
 * Analyze volume trend by comparing recent volume to older volume
 */
function analyzeVolumeTrend(candles: Candle[]): "rising" | "falling" | "stable" {
  if (candles.length < VOLUME_RECENT_PERIODS + VOLUME_OLDER_PERIODS) {
    return "stable";
  }

  // Calculate average volume for recent periods
  const recentCandles = candles.slice(-VOLUME_RECENT_PERIODS);
  const recentAvgVolume =
    recentCandles.reduce((sum, c) => sum + c.volume, 0) / VOLUME_RECENT_PERIODS;

  // Calculate average volume for older periods (before recent)
  const olderCandles = candles.slice(
    -(VOLUME_RECENT_PERIODS + VOLUME_OLDER_PERIODS),
    -VOLUME_RECENT_PERIODS
  );
  const olderAvgVolume =
    olderCandles.reduce((sum, c) => sum + c.volume, 0) / VOLUME_OLDER_PERIODS;

  if (olderAvgVolume === 0) {
    return "stable";
  }

  const changeRatio = (recentAvgVolume - olderAvgVolume) / olderAvgVolume;

  if (changeRatio > VOLUME_STABLE_THRESHOLD) {
    return "rising";
  } else if (changeRatio < -VOLUME_STABLE_THRESHOLD) {
    return "falling";
  }

  return "stable";
}

/**
 * Determine MACD state based on current values and recent crossovers
 */
function determineMacdState(
  candles: Candle[],
  indicators: Indicators
): "bullish_cross" | "bearish_cross" | "bullish" | "bearish" | "neutral" {
  if (!indicators.macd) {
    return "neutral";
  }

  const { macd, signal, histogram } = indicators.macd;

  // Check for recent crossover by comparing current and previous histogram
  // A crossover occurs when histogram changes sign
  if (candles.length >= 2) {
    // Calculate previous MACD values (simplified - check histogram sign change)
    const prevHistogram = histogram; // In real implementation, calculate from previous candles

    // Current state based on MACD line vs signal line
    if (macd > signal) {
      // MACD above signal - bullish
      // Check if this is a recent cross (histogram was negative, now positive)
      if (histogram > 0 && Math.abs(histogram) < Math.abs(macd) * 0.1) {
        return "bullish_cross";
      }
      return "bullish";
    } else if (macd < signal) {
      // MACD below signal - bearish
      // Check if this is a recent cross
      if (histogram < 0 && Math.abs(histogram) < Math.abs(macd) * 0.1) {
        return "bearish_cross";
      }
      return "bearish";
    }
  }

  // MACD equals signal or insufficient data
  return "neutral";
}

/**
 * Determine RSI state based on standard thresholds
 */
function determineRsiState(rsi: number | null): "oversold" | "overbought" | "neutral" {
  if (rsi === null) {
    return "neutral";
  }

  if (rsi < RSI_OVERSOLD) {
    return "oversold";
  } else if (rsi > RSI_OVERBOUGHT) {
    return "overbought";
  }

  return "neutral";
}

/**
 * Calculate approximate 24h price change from candles
 */
function calculate24hChange(candles: Candle[], timeframe: string): number {
  if (candles.length < 2) {
    return 0;
  }

  // Determine how many candles represent 24 hours based on timeframe
  const candlesIn24h = getCandlesIn24h(timeframe);
  const lookbackIndex = Math.max(0, candles.length - candlesIn24h - 1);

  const oldPrice = candles[lookbackIndex]?.close ?? 0;
  const currentPrice = candles[candles.length - 1]?.close ?? 0;

  if (oldPrice === 0) {
    return 0;
  }

  return ((currentPrice - oldPrice) / oldPrice) * 100;
}

/**
 * Calculate volume over the candle period
 */
function calculateVolume(candles: Candle[], timeframe: string): number {
  const candlesIn24h = getCandlesIn24h(timeframe);
  const relevantCandles = candles.slice(-candlesIn24h);

  return relevantCandles.reduce((sum, c) => sum + c.volume, 0);
}

/**
 * Get number of candles that represent 24 hours for a given timeframe
 */
function getCandlesIn24h(timeframe: string): number {
  const timeframeMap: Record<string, number> = {
    "1m": 1440,
    "5m": 288,
    "15m": 96,
    "30m": 48,
    "1h": 24,
    "2h": 12,
    "4h": 6,
    "6h": 4,
    "8h": 3,
    "12h": 2,
    "1d": 1,
  };

  return timeframeMap[timeframe] ?? 24;
}

/**
 * Determine overall trend from candles and indicators
 */
function determineTrend(candles: Candle[], indicators: Indicators): Trend {
  if (candles.length < 20) {
    return "range";
  }

  // Use simple moving average comparison
  const recentPrices = candles.slice(-10).map((c) => c.close);
  const olderPrices = candles.slice(-20, -10).map((c) => c.close);

  const recentAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
  const olderAvg = olderPrices.reduce((a, b) => a + b, 0) / olderPrices.length;

  const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

  // Also consider MACD direction
  const macdBias = indicators.macd
    ? indicators.macd.macd > indicators.macd.signal
      ? 1
      : -1
    : 0;

  // Combined score
  const trendScore = changePercent + macdBias * 2;

  if (trendScore > 2) {
    return "up";
  } else if (trendScore < -2) {
    return "down";
  }

  return "range";
}

/**
 * Determine overall bias from multiple factors
 */
function determineBias(
  macdState: string,
  rsiState: string,
  trend: Trend
): Bias {
  let score = 0;

  // MACD contribution
  if (macdState === "bullish_cross" || macdState === "bullish") {
    score += 1;
  } else if (macdState === "bearish_cross" || macdState === "bearish") {
    score -= 1;
  }

  // RSI contribution
  if (rsiState === "oversold") {
    score += 1; // Potential reversal to bullish
  } else if (rsiState === "overbought") {
    score -= 1; // Potential reversal to bearish
  }

  // Trend contribution
  if (trend === "up") {
    score += 1;
  } else if (trend === "down") {
    score -= 1;
  }

  if (score >= 2) {
    return "bullish";
  } else if (score <= -2) {
    return "bearish";
  }

  return "neutral";
}

/**
 * Determine risk level based on market conditions
 */
function determineRisk(
  rsiState: string,
  volumeTrend: string,
  supports: Level[],
  currentPrice: number
): Risk {
  let riskScore = 0;

  // High RSI extremes increase risk
  if (rsiState === "overbought" || rsiState === "oversold") {
    riskScore += 1;
  }

  // Falling volume can indicate weakness
  if (volumeTrend === "falling") {
    riskScore += 1;
  }

  // No nearby support is risky
  if (supports.length === 0) {
    riskScore += 2;
  } else {
    const nearestSupport = supports[0];
    if (nearestSupport) {
      const distancePercent =
        ((currentPrice - nearestSupport.price) / currentPrice) * 100;

      // Far from support is riskier
      if (distancePercent > 10) {
        riskScore += 1;
      }

      // Weak support is riskier
      if (nearestSupport.strength < 0.5) {
        riskScore += 1;
      }
    }
  }

  if (riskScore >= 3) {
    return "high";
  } else if (riskScore >= 1) {
    return "medium";
  }

  return "low";
}

/**
 * Calculate Support Bounce setup details
 */
function calculateSetupDetails(
  supports: Level[],
  currentPrice: number
): DetailedAnalysis["setupDetails"] {
  if (supports.length === 0 || currentPrice === 0) {
    return {
      nearestSupport: null,
      distanceToSupport: 0,
      setupValid: false,
      invalidationPrice: 0,
    };
  }

  // S1 = nearest support (already sorted by proximity)
  const nearestSupport = supports[0];

  if (!nearestSupport) {
    return {
      nearestSupport: null,
      distanceToSupport: 0,
      setupValid: false,
      invalidationPrice: 0,
    };
  }

  // Calculate distance as percentage
  const distanceToSupport =
    ((currentPrice - nearestSupport.price) / currentPrice) * 100;

  // Setup is valid if:
  // 1. Price is above support (not below it)
  // 2. Distance to support is within threshold
  // 3. Support has reasonable strength
  const setupValid =
    currentPrice > nearestSupport.price &&
    distanceToSupport <= SETUP_MAX_DISTANCE_PERCENT &&
    distanceToSupport >= 0 &&
    nearestSupport.strength >= 0.3;

  // Invalidation price is below the support level
  const invalidationPrice =
    nearestSupport.price * (1 - INVALIDATION_BUFFER_PERCENT / 100);

  return {
    nearestSupport: nearestSupport ?? null,
    distanceToSupport: Math.abs(distanceToSupport),
    setupValid,
    invalidationPrice,
  };
}

/**
 * Calculate confidence score for the setup
 */
function calculateSetupConfidence(
  setupDetails: DetailedAnalysis["setupDetails"],
  volumeTrend: string,
  rsiState: string
): number {
  if (!setupDetails.setupValid || !setupDetails.nearestSupport) {
    return 0;
  }

  let confidence = 0.5; // Base confidence

  // Support strength contributes to confidence
  confidence += setupDetails.nearestSupport.strength * 0.2;

  // Closer to support = higher confidence
  const proximityBonus = Math.max(
    0,
    (SETUP_MAX_DISTANCE_PERCENT - setupDetails.distanceToSupport) /
      SETUP_MAX_DISTANCE_PERCENT
  );
  confidence += proximityBonus * 0.15;

  // Rising volume is positive
  if (volumeTrend === "rising") {
    confidence += 0.1;
  } else if (volumeTrend === "falling") {
    confidence -= 0.1;
  }

  // Oversold RSI increases confidence for bounce setup
  if (rsiState === "oversold") {
    confidence += 0.1;
  } else if (rsiState === "overbought") {
    confidence -= 0.1;
  }

  // More touches on support = more confidence
  if (setupDetails.nearestSupport.touches >= 3) {
    confidence += 0.1;
  }

  // Clamp between 0 and 1
  return Math.max(0, Math.min(1, confidence));
}

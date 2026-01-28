/**
 * Market Scanner Module
 *
 * Fetches market data and ranks trading opportunities.
 * Fully deterministic - no AI involved.
 */

import { BinanceClient } from "../infra/binance/index.ts";
import { calculateIndicators, detectLevels } from "../indicators/index.ts";
import type {
  CoinAnalysis,
  ScanResult,
  Candle,
  Indicators,
  Level,
  Trend,
  Bias,
  Risk,
} from "../types/index.ts";

/**
 * Options for the scan function
 */
export interface ScanOptions {
  /** Number of top coins by volume to scan (default: 50) */
  topN?: number;
  /** Timeframes to analyze (default: ["1h", "4h"]) */
  timeframes?: string[];
}

/**
 * Result of support bounce detection
 */
interface SupportBounceResult {
  detected: boolean;
  confidence: number;
}

/**
 * Determine trend based on recent price action
 *
 * Uses simple moving average comparison and price momentum:
 * - Up: Price trending higher with higher highs and higher lows
 * - Down: Price trending lower with lower highs and lower lows
 * - Range: Price moving sideways
 *
 * @param candles - Array of candle data (oldest first)
 * @returns Trend classification
 */
export function determineTrend(candles: Candle[]): Trend {
  if (candles.length < 20) {
    return "range";
  }

  // Get recent candles for trend analysis
  const recentCandles = candles.slice(-20);
  const firstHalf = recentCandles.slice(0, 10);
  const secondHalf = recentCandles.slice(-10);

  // Calculate average price for each half
  const firstAvg =
    firstHalf.reduce((sum, c) => sum + c.close, 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((sum, c) => sum + c.close, 0) / secondHalf.length;

  // Calculate the percentage change
  const percentChange = ((secondAvg - firstAvg) / firstAvg) * 100;

  // Count higher highs and higher lows for uptrend confirmation
  let higherHighs = 0;
  let higherLows = 0;
  let lowerHighs = 0;
  let lowerLows = 0;

  for (let i = 1; i < recentCandles.length; i++) {
    const current = recentCandles[i];
    const previous = recentCandles[i - 1];
    if (current && previous) {
      if (current.high > previous.high) higherHighs++;
      else lowerHighs++;

      if (current.low > previous.low) higherLows++;
      else lowerLows++;
    }
  }

  // Determine trend based on price change and swing pattern
  const trendThreshold = 2; // 2% change threshold

  if (percentChange > trendThreshold && higherHighs > lowerHighs) {
    return "up";
  } else if (percentChange < -trendThreshold && lowerLows > higherLows) {
    return "down";
  }

  return "range";
}

/**
 * Detect Support Bounce setup
 *
 * Criteria:
 * - Price near support level (within 2%)
 * - RSI < 40 (oversold territory)
 * - Volume not declining (current volume >= average)
 *
 * @param candles - Array of candle data
 * @param levels - Detected support/resistance levels
 * @param indicators - Calculated indicators
 * @returns Detection result with confidence score
 */
export function detectSupportBounce(
  candles: Candle[],
  levels: Level[],
  indicators: Indicators
): SupportBounceResult {
  if (candles.length === 0) {
    return { detected: false, confidence: 0 };
  }

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) {
    return { detected: false, confidence: 0 };
  }
  const currentPrice = lastCandle.close;

  // Find nearest support level below current price
  const supportLevels = levels
    .filter((l) => l.type === "support" && l.price < currentPrice)
    .sort((a, b) => b.price - a.price); // Sort by price descending (nearest first)

  if (supportLevels.length === 0) {
    return { detected: false, confidence: 0 };
  }

  const nearestSupport = supportLevels[0];
  if (!nearestSupport) {
    return { detected: false, confidence: 0 };
  }

  // Check if price is within 2% of support
  const distancePercent =
    ((currentPrice - nearestSupport.price) / nearestSupport.price) * 100;
  const nearSupport = distancePercent <= 2;

  // Check RSI condition (< 40 for oversold)
  const rsi = indicators.rsi;
  const oversold = rsi !== null && rsi < 40;

  // Check volume condition (not declining - ratio >= 1 or at least >= 0.8)
  const volumeRatio = indicators.volumeRatio;
  const volumeOk = volumeRatio !== null && volumeRatio >= 0.8;

  // Calculate confidence based on how well conditions are met
  let confidence = 0;

  if (nearSupport) {
    // Higher confidence the closer to support (max 0.4 for being within 2%)
    confidence += Math.max(0, 0.4 * (1 - distancePercent / 2));
  }

  if (oversold && rsi !== null) {
    // Higher confidence the more oversold (max 0.3 for RSI < 40)
    confidence += 0.3 * ((40 - rsi) / 40);
  }

  if (volumeOk && volumeRatio !== null) {
    // Higher confidence with stronger volume (max 0.2)
    confidence += Math.min(0.2, 0.2 * (volumeRatio - 0.8) / 0.5);
  }

  // Bonus for support strength (max 0.1)
  confidence += 0.1 * nearestSupport.strength;

  // All conditions must be met for detection
  const detected = nearSupport && oversold && volumeOk;

  return {
    detected,
    confidence: detected ? Math.min(confidence, 1) : 0,
  };
}

/**
 * Categorize risk level based on analysis
 *
 * Risk factors:
 * - Support strength (stronger = lower risk)
 * - Volume (higher = lower risk)
 * - RSI (extreme values = higher risk)
 *
 * @param analysis - Partial coin analysis data
 * @returns Risk classification
 */
export function categorizeRisk(
  analysis: Partial<CoinAnalysis>
): Risk {
  let riskScore = 0;

  // Check support strength from levels
  if (analysis.levels && analysis.levels.length > 0) {
    const supportLevels = analysis.levels.filter((l) => l.type === "support");
    if (supportLevels.length > 0) {
      const maxStrength = Math.max(...supportLevels.map((l) => l.strength));
      // Strong support (> 0.7) reduces risk
      if (maxStrength > 0.7) {
        riskScore -= 1;
      } else if (maxStrength < 0.3) {
        // Weak support increases risk
        riskScore += 1;
      }
    } else {
      // No support levels = higher risk
      riskScore += 1;
    }
  }

  // Check volume
  if (analysis.indicators) {
    const volumeRatio = analysis.indicators.volumeRatio;
    if (volumeRatio !== null) {
      if (volumeRatio >= 1.5) {
        // High volume = lower risk
        riskScore -= 1;
      } else if (volumeRatio < 0.5) {
        // Low volume = higher risk
        riskScore += 1;
      }
    } else {
      // Unknown volume = medium risk
      riskScore += 0.5;
    }

    // Check RSI extremes
    const rsi = analysis.indicators.rsi;
    if (rsi !== null) {
      if (rsi < 20 || rsi > 80) {
        // Extreme RSI = higher risk (potential for reversal)
        riskScore += 1;
      }
    }
  }

  // Categorize based on score
  if (riskScore <= -1) {
    return "low";
  } else if (riskScore >= 1) {
    return "high";
  }

  return "medium";
}

/**
 * Determine bias based on setup detection and price position
 *
 * @param setupDetected - Whether a support bounce setup was detected
 * @param currentPrice - Current price
 * @param levels - Detected support/resistance levels
 * @returns Bias classification
 */
function determineBias(
  setupDetected: boolean,
  currentPrice: number,
  levels: Level[]
): Bias {
  if (setupDetected) {
    return "bullish";
  }

  // Check if near resistance (within 2%)
  const resistanceLevels = levels
    .filter((l) => l.type === "resistance" && l.price > currentPrice)
    .sort((a, b) => a.price - b.price); // Sort by price ascending (nearest first)

  if (resistanceLevels.length > 0) {
    const nearestResistance = resistanceLevels[0];
    if (nearestResistance) {
      const distancePercent =
        ((nearestResistance.price - currentPrice) / currentPrice) * 100;

      if (distancePercent <= 2) {
        return "bearish";
      }
    }
  }

  return "neutral";
}

/**
 * Analyze a single coin and return CoinAnalysis
 */
async function analyzeCoin(
  client: BinanceClient,
  symbol: string,
  timeframes: string[]
): Promise<CoinAnalysis | null> {
  try {
    // Fetch candles for all timeframes and merge analysis
    // Use the primary timeframe (first one) for main analysis
    const primaryTimeframe = timeframes[0] ?? "1h";
    const candles = await client.getCandles(symbol, primaryTimeframe, 100);

    if (candles.length === 0) {
      return null;
    }

    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) {
      return null;
    }
    const currentPrice = lastCandle.close;

    // Calculate indicators
    const indicators = calculateIndicators(candles);

    // Detect support/resistance levels
    const levels = detectLevels(candles);

    // Determine trend
    const trend = determineTrend(candles);

    // Detect support bounce setup
    const bounceResult = detectSupportBounce(candles, levels, indicators);

    // Calculate 24h change (approximate from candle data)
    const change24h = calculateChange24h(candles);

    // Calculate 24h volume (approximate from candle data)
    const volume24h = calculateVolume24h(candles, primaryTimeframe);

    // Determine bias
    const bias = determineBias(bounceResult.detected, currentPrice, levels);

    // Build partial analysis for risk categorization
    const partialAnalysis: Partial<CoinAnalysis> = {
      indicators,
      levels,
    };

    // Categorize risk
    const risk = categorizeRisk(partialAnalysis);

    return {
      symbol,
      price: currentPrice,
      change24h,
      volume24h,
      indicators,
      levels,
      trend,
      setupDetected: bounceResult.detected,
      setupConfidence: bounceResult.confidence,
      bias,
      risk,
    };
  } catch (error) {
    // Log error but don't throw - we want to continue with other coins
    console.error(`Failed to analyze ${symbol}:`, error);
    return null;
  }
}

/**
 * Calculate approximate 24h price change from candles
 */
function calculateChange24h(candles: Candle[]): number {
  if (candles.length < 2) {
    return 0;
  }

  // Use first and last candle for approximate change
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];

  if (!firstCandle || !lastCandle || firstCandle.open === 0) {
    return 0;
  }

  return ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
}

/**
 * Calculate approximate 24h volume from candles
 * Estimation based on timeframe
 */
function calculateVolume24h(candles: Candle[], timeframe: string): number {
  // Determine how many candles represent 24h based on timeframe
  let candlesPer24h: number;

  switch (timeframe) {
    case "1m":
      candlesPer24h = 1440;
      break;
    case "5m":
      candlesPer24h = 288;
      break;
    case "15m":
      candlesPer24h = 96;
      break;
    case "30m":
      candlesPer24h = 48;
      break;
    case "1h":
      candlesPer24h = 24;
      break;
    case "4h":
      candlesPer24h = 6;
      break;
    case "1d":
      candlesPer24h = 1;
      break;
    default:
      candlesPer24h = 24; // Default to 1h
  }

  // Sum volume for the last 24h worth of candles
  const relevantCandles = candles.slice(-Math.min(candlesPer24h, candles.length));
  return relevantCandles.reduce((sum, c) => sum + c.volume, 0);
}

/**
 * Main scan function - fetches market data and ranks opportunities
 *
 * Process:
 * 1. Get top N symbols by volume from Binance
 * 2. For each symbol, fetch candles for each timeframe
 * 3. Calculate indicators (RSI, MACD, volume)
 * 4. Detect support/resistance levels
 * 5. Determine trend (up/down/range)
 * 6. Detect Support Bounce setup
 * 7. Score and rank coins by setup quality
 * 8. Categorize bias and risk
 *
 * @param client - Binance API client
 * @param options - Scan options
 * @returns ScanResult with all analyzed coins sorted by setup confidence
 */
export async function scan(
  client: BinanceClient,
  options?: ScanOptions
): Promise<ScanResult> {
  const topN = options?.topN ?? 50;
  const timeframes = options?.timeframes ?? ["1h", "4h"];

  // Get top symbols by volume
  const symbols = await client.getTopSymbols(topN);

  // Analyze each symbol
  const analysisPromises = symbols.map((symbol) =>
    analyzeCoin(client, symbol, timeframes)
  );

  const analysisResults = await Promise.all(analysisPromises);

  // Filter out failed analyses and sort by setup confidence
  const coins = analysisResults
    .filter((result): result is CoinAnalysis => result !== null)
    .sort((a, b) => {
      // Primary sort: setup detected (true first)
      if (a.setupDetected !== b.setupDetected) {
        return a.setupDetected ? -1 : 1;
      }
      // Secondary sort: setup confidence (higher first)
      return b.setupConfidence - a.setupConfidence;
    });

  return {
    timestamp: new Date().toISOString(),
    universe: `top${topN}`,
    timeframes,
    coins,
  };
}

/**
 * Market Scanner Module
 *
 * Fetches market data and ranks trading opportunities.
 * Fully deterministic - no AI involved.
 */

import type { Exchange } from "../../infra/exchange/index.ts";
import { calculateIndicators, detectLevels } from "../../indicators/index.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import { logScanOpportunity } from "../../infra/storage/events.ts";
import type {
  CoinAnalysis,
  ScanResult,
  Candle,
  Indicators,
  Level,
  Trend,
  Bias,
  Risk,
} from "../../types/index.ts";

const logger = createModuleLogger("scanner");
const SCAN_CONCURRENCY = 6;
const SCAN_CACHE_TTL_MS = 20_000;
const TOP_SYMBOLS_CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface TopSymbolsCacheEntry extends CacheEntry<string[]> {
  count: number;
}

const scanCache = new Map<string, CacheEntry<ScanResult>>();
const inFlightScans = new Map<string, Promise<ScanResult>>();
const topSymbolsCache = new Map<string, TopSymbolsCacheEntry>();

/**
 * Options for the scan function
 */
export interface ScanOptions {
  topN?: number;
  // Ordered preference list; scanner uses the first timeframe only.
  timeframes?: string[];
}

/**
 * Result of support bounce detection
 */
interface SupportBounceResult {
  detected: boolean;
  confidence: number;
}

function getExchangeCacheKey(client: Exchange): string {
  const constructorName = client?.constructor?.name?.trim();
  return constructorName && constructorName !== "Object"
    ? constructorName.toLowerCase()
    : "exchange";
}

function getPrimaryScanTimeframe(timeframes?: string[]): string {
  return timeframes?.[0] ?? "1h";
}

function createScanCacheKey(
  client: Exchange,
  topN: number,
  timeframe: string
): string {
  return `${getExchangeCacheKey(client)}:${topN}:${timeframe}`;
}

function getCachedValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number
): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      const item = items[currentIndex];
      if (item === undefined) {
        return;
      }

      results[currentIndex] = await mapper(item, currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function getTopSymbolsCached(
  client: Exchange,
  topN: number
): Promise<string[]> {
  const exchangeKey = getExchangeCacheKey(client);
  const cached = topSymbolsCache.get(exchangeKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now && cached.count >= topN) {
    return cached.value.slice(0, topN);
  }

  const symbols = await client.getTopSymbols(topN);
  topSymbolsCache.set(exchangeKey, {
    value: symbols,
    count: symbols.length,
    expiresAt: now + TOP_SYMBOLS_CACHE_TTL_MS,
  });

  return symbols;
}

/**
 * Determine trend based on recent price action
 */
export function determineTrend(candles: Candle[]): Trend {
  if (candles.length < 20) {
    return "range";
  }

  const recentCandles = candles.slice(-20);
  const firstHalf = recentCandles.slice(0, 10);
  const secondHalf = recentCandles.slice(-10);

  const firstAvg =
    firstHalf.reduce((sum, c) => sum + c.close, 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((sum, c) => sum + c.close, 0) / secondHalf.length;

  const percentChange = ((secondAvg - firstAvg) / firstAvg) * 100;

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

  const trendThreshold = 2;

  if (percentChange > trendThreshold && higherHighs > lowerHighs) {
    return "up";
  } else if (percentChange < -trendThreshold && lowerLows > higherLows) {
    return "down";
  }

  return "range";
}

/**
 * Detect Support Bounce setup
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

  const supportLevels = levels
    .filter((l) => l.type === "support" && l.price < currentPrice)
    .sort((a, b) => b.price - a.price);

  if (supportLevels.length === 0) {
    return { detected: false, confidence: 0 };
  }

  const nearestSupport = supportLevels[0];
  if (!nearestSupport) {
    return { detected: false, confidence: 0 };
  }

  const distancePercent =
    ((currentPrice - nearestSupport.price) / nearestSupport.price) * 100;
  const nearSupport = distancePercent <= 2;

  const rsi = indicators.rsi;
  const oversold = rsi !== null && rsi < 40;

  const volumeRatio = indicators.volumeRatio;
  const volumeOk = volumeRatio !== null && volumeRatio >= 0.8;

  let confidence = 0;

  if (nearSupport) {
    confidence += Math.max(0, 0.4 * (1 - distancePercent / 2));
  }

  if (oversold && rsi !== null) {
    confidence += 0.3 * ((40 - rsi) / 40);
  }

  if (volumeOk && volumeRatio !== null) {
    confidence += Math.min(0.2, 0.2 * (volumeRatio - 0.8) / 0.5);
  }

  confidence += 0.1 * nearestSupport.strength;

  const detected = nearSupport && oversold && volumeOk;

  return {
    detected,
    confidence: detected ? Math.min(confidence, 1) : 0,
  };
}

/**
 * Categorize risk level based on analysis
 */
export function categorizeRisk(
  analysis: Partial<CoinAnalysis>
): Risk {
  let riskScore = 0;

  if (analysis.levels && analysis.levels.length > 0) {
    const supportLevels = analysis.levels.filter((l) => l.type === "support");
    if (supportLevels.length > 0) {
      const maxStrength = Math.max(...supportLevels.map((l) => l.strength));
      if (maxStrength > 0.7) {
        riskScore -= 1;
      } else if (maxStrength < 0.3) {
        riskScore += 1;
      }
    } else {
      riskScore += 1;
    }
  }

  if (analysis.indicators) {
    const volumeRatio = analysis.indicators.volumeRatio;
    if (volumeRatio !== null) {
      if (volumeRatio >= 1.5) {
        riskScore -= 1;
      } else if (volumeRatio < 0.5) {
        riskScore += 1;
      }
    } else {
      riskScore += 0.5;
    }

    const rsi = analysis.indicators.rsi;
    if (rsi !== null) {
      if (rsi < 20 || rsi > 80) {
        riskScore += 1;
      }
    }
  }

  if (riskScore <= -1) {
    return "low";
  } else if (riskScore >= 1) {
    return "high";
  }

  return "medium";
}

/**
 * Determine bias based on setup detection and price position
 */
function determineBias(
  setupDetected: boolean,
  currentPrice: number,
  levels: Level[]
): Bias {
  if (setupDetected) {
    return "bullish";
  }

  const resistanceLevels = levels
    .filter((l) => l.type === "resistance" && l.price > currentPrice)
    .sort((a, b) => a.price - b.price);

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
  client: Exchange,
  symbol: string,
  timeframe: string
): Promise<CoinAnalysis | null> {
  try {
    const candles = await client.getCandles(symbol, timeframe, 100);

    if (candles.length === 0) {
      return null;
    }

    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) {
      return null;
    }
    const currentPrice = lastCandle.close;

    const indicators = calculateIndicators(candles);
    const levels = detectLevels(candles);
    const trend = determineTrend(candles);
    const bounceResult = detectSupportBounce(candles, levels, indicators);
    const change24h = calculateChange24h(candles);
    const volume24h = calculateVolume24h(candles, timeframe);
    const bias = determineBias(bounceResult.detected, currentPrice, levels);

    const partialAnalysis: Partial<CoinAnalysis> = {
      indicators,
      levels,
    };

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
    logger.error("Failed to analyze coin", error as Error, { symbol });
    return null;
  }
}

function calculateChange24h(candles: Candle[]): number {
  if (candles.length < 2) {
    return 0;
  }

  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];

  if (!firstCandle || !lastCandle || firstCandle.open === 0) {
    return 0;
  }

  return ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
}

function calculateVolume24h(candles: Candle[], timeframe: string): number {
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
      candlesPer24h = 24;
  }

  const relevantCandles = candles.slice(-Math.min(candlesPer24h, candles.length));
  return relevantCandles.reduce((sum, c) => sum + c.volume, 0);
}

/**
 * Main scan function - fetches market data and ranks opportunities
 */
export async function scan(
  client: Exchange,
  options?: ScanOptions
): Promise<ScanResult> {
  const topN = options?.topN ?? 50;
  const requestedTimeframes = options?.timeframes ?? ["1h", "4h"];
  const primaryTimeframe = getPrimaryScanTimeframe(requestedTimeframes);
  const timeframes = [primaryTimeframe];
  const cacheKey = createScanCacheKey(client, topN, primaryTimeframe);

  const cachedResult = getCachedValue(scanCache, cacheKey);
  if (cachedResult) {
    logger.debug("Returning cached market scan", { topN, timeframes });
    return cachedResult;
  }

  const inFlight = inFlightScans.get(cacheKey);
  if (inFlight) {
    logger.debug("Joining in-flight market scan", { topN, timeframes });
    return inFlight;
  }

  const scanPromise = (async (): Promise<ScanResult> => {
    if (requestedTimeframes.length > 1) {
      logger.debug("Scanner using primary timeframe only", {
        requestedTimeframes,
        primaryTimeframe,
      });
    }

    logger.info("Starting market scan", { topN, timeframes });

    // Emit scan started event
    await emitEvent("scan:started", { universe: `top${topN}`, timeframes });

    const startTime = Date.now();

    // Get top symbols by volume
    const symbols = await getTopSymbolsCached(client, topN);
    logger.debug("Got top symbols", { count: symbols.length });

    const analysisResults = await mapWithConcurrency(
      symbols,
      SCAN_CONCURRENCY,
      (symbol) => analyzeCoin(client, symbol, primaryTimeframe)
    );

    // Filter out failed analyses and sort by setup confidence
    const coins = analysisResults
      .filter((result): result is CoinAnalysis => result !== null)
      .sort((a, b) => {
        if (a.setupDetected !== b.setupDetected) {
          return a.setupDetected ? -1 : 1;
        }
        return b.setupConfidence - a.setupConfidence;
      });

    const opportunitiesFound = coins.filter((c) => c.setupDetected).length;
    const duration = Date.now() - startTime;

    logger.info("Scan complete", {
      coinsScanned: coins.length,
      opportunitiesFound,
      duration,
    });

    // Emit scan completed event
    await emitEvent("scan:completed", {
      coinsScanned: coins.length,
      opportunitiesFound,
      duration,
    });

    const result: ScanResult = {
      timestamp: new Date().toISOString(),
      universe: `top${topN}`,
      timeframes,
      coins,
    };

    // Emit opportunity events for top setups AND persist to database
    for (const coin of coins.filter((c) => c.setupDetected).slice(0, 5)) {
      await emitEvent("scan:opportunity", {
        symbol: coin.symbol,
        confidence: coin.setupConfidence,
        bias: coin.bias,
      });

      // Persist opportunity to database for historical queries
      try {
        logScanOpportunity({
          symbol: coin.symbol,
          price: coin.price,
          confidence: coin.setupConfidence,
          bias: coin.bias,
          risk: coin.risk,
          change24h: coin.change24h,
        });
      } catch (error) {
        logger.warn("Failed to persist opportunity", { symbol: coin.symbol, error });
      }
    }

    setCachedValue(scanCache, cacheKey, result, SCAN_CACHE_TTL_MS);
    return result;
  })();

  inFlightScans.set(cacheKey, scanPromise);

  try {
    return await scanPromise;
  } finally {
    inFlightScans.delete(cacheKey);
  }
}

/**
 * Multi-Source Quote Aggregation Service
 *
 * Fetches prices from multiple sources in parallel (exchange adapters,
 * CoinGecko, etc.), merges them using median-based aggregation, and
 * optionally enriches the result with LLM analysis.
 */

import type { Exchange, Ticker24hr } from "../../exchange/types.ts";
import { CoinGeckoClient, getCoinGeckoClient } from "./coingecko.ts";
import type { CoinGeckoPrice } from "./coingecko.ts";
import {
  enrichQuoteWithLLM,
  type BaseQuote,
  type LLMEnrichment,
  type TrendDirection,
  type Momentum,
  type VolumeAssessment,
} from "../enrichment/llmEnrichment.ts";
import type { LLMClient } from "../../ai/llm/client.ts";
import type { Candle } from "../../../types/index.ts";
import { Cache } from "../../platform/cache/cache.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("multi-source-quote");

// ============================================================================
// Types
// ============================================================================

export interface EnrichedQuote {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  sources: string[];
  timestamp: number;
  /** ms epoch when source data was fetched. Cache hits keep the
   *  original value, so this is the staleness anchor for consumers. */
  fetchedAt: number;
  /** True when this quote should not be trusted for sizing/execution
   *  decisions (source disagreement, enrichment outage, …). */
  degraded: boolean;
  /** Machine-readable reasons behind `degraded`. */
  degradedReasons: string[];
  /** Sources attempted but yielding no usable price. */
  sourcesFailed: string[];
  // LLM enrichment (optional)
  trendDirection?: TrendDirection;
  momentum?: Momentum;
  volumeAssessment?: VolumeAssessment;
  summary?: string;
}

/** Max (max-min)/median spread across surviving sources before the
 *  quote is flagged degraded with "source disagreement". */
export const SOURCE_DISAGREEMENT_THRESHOLD = 0.05;

/**
 * Thrown when no source produced a usable (finite, positive) price.
 * Replaces the old price=0 sentinel quote, which silently flowed into
 * downstream sizing decisions. Fail closed: no price, no quote.
 */
export class QuoteUnavailableError extends Error {
  readonly symbol: string;
  readonly sourcesFailed: string[];

  constructor(symbol: string, sourcesFailed: string[]) {
    super(
      `No price source returned a usable quote for ${symbol}` +
        (sourcesFailed.length > 0 ? ` (failed: ${sourcesFailed.join(", ")})` : ""),
    );
    this.name = "QuoteUnavailableError";
    this.symbol = symbol;
    this.sourcesFailed = sourcesFailed;
  }
}

interface SourceQuote {
  source: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

export interface MultiSourceQuoteConfig {
  /** Whether to call the LLM for enrichment (default: true if client provided) */
  enableLLMEnrichment?: boolean;
  /** How many candles to fetch for LLM context (default: 50) */
  candleLookback?: number;
  /** Candle timeframe for LLM context (default: "1h") */
  candleTimeframe?: string;
  /** Quote cache TTL in ms (default: 30 000) */
  quoteCacheTtlMs?: number;
}

// ============================================================================
// Cache
// ============================================================================

const quoteCache = new Cache<EnrichedQuote>({
  defaultTtl: 30_000,
  maxEntries: 500,
  updateTtlOnAccess: false,
});

// ============================================================================
// Helpers
// ============================================================================

/** Compute median of a numeric array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Normalise a symbol: strip trailing quote currencies. */
function baseSymbol(symbol: string): string {
  return symbol
    .toUpperCase()
    .replace(/\/.*$/, "")
    .replace(/(USDT|USD|USDC|BUSD|PERP)$/, "");
}

/** Build a USDT pair from a base symbol. */
function toUsdtPair(symbol: string): string {
  const base = baseSymbol(symbol);
  return `${base}USDT`;
}

// ============================================================================
// Source Fetchers
// ============================================================================

async function fetchFromExchange(
  exchange: Exchange,
  symbol: string
): Promise<SourceQuote | null> {
  try {
    const pair = toUsdtPair(symbol);

    // Fetch 24hr ticker for comprehensive data
    const tickers = await exchange.get24hrTickers();
    const ticker = tickers.find(
      (t: Ticker24hr) => t.symbol.toUpperCase() === pair
    );

    if (!ticker) {
      // Fallback: just get current price
      const price = await exchange.getPrice(pair);
      if (price > 0) {
        return {
          source: exchange.displayName,
          price,
          change24h: 0,
          changePercent24h: 0,
          volume24h: 0,
          high24h: price,
          low24h: price,
        };
      }
      return null;
    }

    return {
      source: exchange.displayName,
      price: ticker.lastPrice,
      change24h: ticker.priceChange,
      changePercent24h: ticker.priceChangePercent,
      volume24h: ticker.quoteVolume,
      high24h: ticker.highPrice,
      low24h: ticker.lowPrice,
    };
  } catch (error) {
    logger.debug("Exchange fetch failed", {
      exchange: exchange.displayName,
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchFromCoinGecko(
  client: CoinGeckoClient,
  symbol: string
): Promise<SourceQuote | null> {
  try {
    const price = await client.getPrice(symbol);
    if (!price) return null;

    return {
      source: "CoinGecko",
      price: price.usd,
      change24h: 0, // CoinGecko returns percentage, not absolute
      changePercent24h: price.usd_24h_change,
      volume24h: price.usd_24h_vol,
      high24h: 0, // Not available from simple/price endpoint
      low24h: 0,
    };
  } catch (error) {
    logger.debug("CoinGecko fetch failed", {
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================================
// Merge Logic
// ============================================================================

/** Callers must pre-filter `quotes` to usable prices (finite, > 0). */
function mergeQuotes(
  symbol: string,
  quotes: SourceQuote[],
  sourcesFailed: string[]
): EnrichedQuote {
  const prices = quotes.map((q) => q.price);
  const mergedPrice = median(prices);

  // Cross-venue consensus check: surviving sources that disagree beyond
  // the threshold mean at least one of them is wrong — and the median
  // can't tell which. Flag instead of guessing.
  const degradedReasons: string[] = [];
  if (
    prices.length > 1 &&
    (Math.max(...prices) - Math.min(...prices)) / mergedPrice >
      SOURCE_DISAGREEMENT_THRESHOLD
  ) {
    degradedReasons.push("source disagreement");
  }

  // For percentage change, take median of non-zero values
  const changePercents = quotes
    .map((q) => q.changePercent24h)
    .filter((c) => c !== 0);
  const mergedChangePercent =
    changePercents.length > 0 ? median(changePercents) : 0;

  // For absolute change, compute from price and percent
  const mergedChange24h = mergedPrice * (mergedChangePercent / 100);

  // Volume: take the maximum reported (most accurate source wins)
  const volumes = quotes.map((q) => q.volume24h).filter((v) => v > 0);
  const mergedVolume = volumes.length > 0 ? Math.max(...volumes) : 0;

  // High/Low: take the widest range
  const highs = quotes.map((q) => q.high24h).filter((h) => h > 0);
  const lows = quotes.map((q) => q.low24h).filter((l) => l > 0);
  const mergedHigh =
    highs.length > 0 ? Math.max(...highs) : mergedPrice;
  const mergedLow =
    lows.length > 0 ? Math.min(...lows) : mergedPrice;

  const now = Date.now();
  return {
    symbol: baseSymbol(symbol),
    price: mergedPrice,
    change24h: mergedChange24h,
    changePercent24h: mergedChangePercent,
    volume24h: mergedVolume,
    high24h: mergedHigh,
    low24h: mergedLow,
    sources: quotes.map((q) => q.source),
    timestamp: now,
    fetchedAt: now,
    degraded: degradedReasons.length > 0,
    degradedReasons,
    sourcesFailed,
  };
}

// ============================================================================
// Service
// ============================================================================

export class MultiSourceQuoteService {
  private exchanges: Exchange[];
  private coinGecko: CoinGeckoClient;
  private llmClient: LLMClient | null;
  private config: Required<MultiSourceQuoteConfig>;

  constructor(
    exchanges: Exchange[],
    llmClient?: LLMClient | null,
    config?: MultiSourceQuoteConfig
  ) {
    this.exchanges = exchanges;
    this.coinGecko = getCoinGeckoClient();
    this.llmClient = llmClient ?? null;
    this.config = {
      enableLLMEnrichment: config?.enableLLMEnrichment ?? true,
      candleLookback: config?.candleLookback ?? 50,
      candleTimeframe: config?.candleTimeframe ?? "1h",
      quoteCacheTtlMs: config?.quoteCacheTtlMs ?? 30_000,
    };
  }

  /**
   * Get an enriched quote for a symbol, aggregating from all available sources.
   *
   * @throws QuoteUnavailableError when no source produced a usable
   *   (finite, positive) price. Never returns a price=0 sentinel.
   */
  async getQuote(symbol: string): Promise<EnrichedQuote> {
    const cacheKey = `quote:${baseSymbol(symbol)}`;
    const cached = quoteCache.get(cacheKey);
    if (cached) {
      logger.debug("Returning cached enriched quote", { symbol });
      return cached;
    }

    // Build fetch promises for all sources
    const fetchPromises: Promise<SourceQuote | null>[] = [];

    // Exchange adapters
    for (const exchange of this.exchanges) {
      fetchPromises.push(fetchFromExchange(exchange, symbol));
    }

    // CoinGecko (always attempted — free, no key)
    fetchPromises.push(fetchFromCoinGecko(this.coinGecko, symbol));

    // Index-aligned with fetchPromises so failures can be attributed.
    const sourceNames = [
      ...this.exchanges.map((e) => e.displayName),
      "CoinGecko",
    ];

    // Fetch all in parallel
    const results = await Promise.allSettled(fetchPromises);

    const quotes: SourceQuote[] = [];
    const sourcesFailed: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const quote = result.status === "fulfilled" ? result.value : null;
      if (quote && Number.isFinite(quote.price) && quote.price > 0) {
        quotes.push(quote);
      } else {
        sourcesFailed.push(sourceNames[i]!);
      }
    }

    if (quotes.length === 0) {
      logger.warn("No sources returned data", { symbol, sourcesFailed });
      throw new QuoteUnavailableError(baseSymbol(symbol), sourcesFailed);
    }

    // Merge
    const merged = mergeQuotes(symbol, quotes, sourcesFailed);

    // LLM enrichment
    if (this.config.enableLLMEnrichment && this.llmClient) {
      const baseQuote: BaseQuote = {
        symbol: merged.symbol,
        price: merged.price,
        change24h: merged.change24h,
        changePercent24h: merged.changePercent24h,
        volume24h: merged.volume24h,
        high24h: merged.high24h,
        low24h: merged.low24h,
      };

      // Optionally fetch candles from first available exchange
      let candles: Candle[] | undefined;
      if (this.exchanges.length > 0) {
        candles = await this.fetchCandlesSafe(symbol);
      }

      const enrichment = await enrichQuoteWithLLM(
        this.llmClient,
        baseQuote,
        candles
      );

      if (enrichment) {
        merged.trendDirection = enrichment.trendDirection;
        merged.momentum = enrichment.momentum;
        merged.volumeAssessment = enrichment.volumeAssessment;
        merged.summary = enrichment.summary;
      } else {
        // Enrichment was requested but unavailable — surface a
        // machine-readable flag instead of only logging.
        merged.degraded = true;
        merged.degradedReasons.push("enrichment unavailable");
      }
    }

    quoteCache.set(cacheKey, merged, this.config.quoteCacheTtlMs);
    return merged;
  }

  /**
   * Get quotes for multiple symbols. Symbols whose quote is unavailable
   * (QuoteUnavailableError) are omitted from the result map — absence is
   * the failure signal, never a zero-price entry.
   */
  async getQuotes(symbols: string[]): Promise<Map<string, EnrichedQuote>> {
    const results = new Map<string, EnrichedQuote>();
    const settled = await Promise.allSettled(
      symbols.map((s) => this.getQuote(s))
    );

    for (let i = 0; i < symbols.length; i++) {
      const result = settled[i];
      if (result && result.status === "fulfilled") {
        results.set(symbols[i]!, result.value);
      }
    }

    return results;
  }

  /**
   * Try to fetch candles from the first exchange that succeeds.
   */
  private async fetchCandlesSafe(symbol: string): Promise<Candle[] | undefined> {
    const pair = toUsdtPair(symbol);
    for (const exchange of this.exchanges) {
      try {
        const candles = await exchange.getCandles(
          pair,
          this.config.candleTimeframe,
          this.config.candleLookback
        );
        if (candles.length > 0) return candles;
      } catch {
        // Try next exchange
      }
    }
    return undefined;
  }

  /**
   * Clear the quote cache.
   */
  clearCache(): void {
    quoteCache.clear();
  }
}

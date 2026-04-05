/**
 * Binance API Client
 * Handles authenticated and public API requests to Binance
 */

import { createHmac } from "crypto";
import type { Candle } from "../../../../../types/index.ts";
import type {
  BinanceAccountInfo,
  BinanceKline,
  BinanceOrder,
  BinanceAPIError,
  BinanceTicker24hr,
  BinancePriceTicker,
  OrderParams,
  BinanceTrade,
  BinanceDeposit,
  BinanceWithdrawal,
  BinanceEarnPosition,
  BinanceAPIRestrictions,
  // New types
  BinanceOrderBook,
  BinanceRecentTrade,
  BinanceAggTrade,
  BinanceAvgPrice,
  BinanceBookTicker,
  OCOOrderParams,
  BinanceOCOOrder,
  BinanceOrderList,
  BinanceCancelReplaceResult,
  BinanceCoinInfo,
  BinanceAccountSnapshot,
  TransferType,
  BinanceTransferResponse,
  BinanceTransferHistory,
  BinanceDustTransfer,
  BinanceDustLog,
  BinanceAssetDividend,
  BinanceAssetDetail,
  BinanceTradeFee,
  BinanceUserAsset,
  BinanceDepositAddress,
  BinanceDustableAsset,
  BinanceWalletBalance,
  BinanceFlexibleProduct,
  BinanceLockedProduct,
  BinanceLockedPosition,
  BinanceEarnSubscription,
  BinanceEarnRedemption,
  BinanceEarnSubscriptionRecord,
  BinanceEarnRedemptionRecord,
  BinanceExchangeInfo,
} from "./types.ts";
import { BinanceError, RateLimitError } from "../../../../../errors/index.ts";
import { createModuleLogger } from "../../../../logger/index.ts";
import {
  withRetry,
  CircuitBreaker,
  type RetryConfig,
} from "../../../../retry.ts";

const logger = createModuleLogger("binance");

// Default retry config for Binance API calls
const BINANCE_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
};

// Circuit breaker for API protection
const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
});

// Rate limit tracking
interface RateLimitState {
  requestWeight: number;
  orderCount: number;
  lastReset: number;
  /** Timestamp of last throttle warning */
  lastThrottleWarn: number;
  /** Number of requests throttled in current window */
  throttledCount: number;
}

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  /** Maximum request weight per minute (Binance default: 1200) */
  maxWeight: 1200,
  /** Threshold percentage to start proactive throttling (80%) */
  throttleThreshold: 0.8,
  /** Warning threshold percentage (90%) */
  warningThreshold: 0.9,
  /** Delay in ms when approaching limit */
  throttleDelayMs: 100,
  /** Maximum delay in ms when very close to limit */
  maxThrottleDelayMs: 1000,
  /** How often to log throttle warnings (ms) */
  throttleWarnIntervalMs: 10000,
};

const TICKER_CACHE_TTL_MS = 15_000;
const TOP_SYMBOLS_CACHE_TTL_MS = 15_000;
const TRADE_HISTORY_CONCURRENCY = 3;

interface TickerCacheEntry {
  expiresAt: number;
  value: BinanceTicker24hr[];
}

interface TopSymbolsCacheEntry {
  expiresAt: number;
  count: number;
  value: string[];
}

/**
 * Binance API Client
 */
export class BinanceClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private rateLimitState: RateLimitState;
  private serverTimeOffset: number = 0;
  private serverTimeSynced: boolean = false;
  private tickers24hCache: TickerCacheEntry | null = null;
  private topSymbolsCache: TopSymbolsCacheEntry | null = null;
  private inFlight24hrTickers: Promise<BinanceTicker24hr[]> | null = null;

  private async mapWithConcurrency<TInput, TOutput>(
    items: TInput[],
    concurrency: number,
    mapper: (item: TInput) => Promise<TOutput>
  ): Promise<TOutput[]> {
    if (items.length === 0) {
      return [];
    }

    const results = new Array<TOutput>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(concurrency, 1), items.length);

    const worker = async (): Promise<void> => {
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

        results[currentIndex] = await mapper(item);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  constructor(apiKey: string, apiSecret: string, baseUrl = "https://api.binance.com") {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl;
    this.rateLimitState = {
      requestWeight: 0,
      orderCount: 0,
      lastReset: Date.now(),
      lastThrottleWarn: 0,
      throttledCount: 0,
    };
  }

  /**
   * Sync local clock with Binance server time to avoid timestamp drift errors.
   * Called once before the first signed request.
   */
  private async syncServerTime(): Promise<void> {
    if (this.serverTimeSynced) return;
    try {
      const before = Date.now();
      const res = await fetch(`${this.baseUrl}/api/v3/time`);
      const after = Date.now();
      const data = await res.json() as { serverTime: number };
      const localTime = Math.floor((before + after) / 2);
      this.serverTimeOffset = data.serverTime - localTime;
      this.serverTimeSynced = true;
      logger.info(`Server time synced (offset: ${this.serverTimeOffset}ms)`);
    } catch (error) {
      logger.warn("Failed to sync server time, using local clock");
    }
  }

  /**
   * Get current timestamp adjusted for Binance server time offset
   */
  private getTimestamp(): number {
    return Date.now() + this.serverTimeOffset;
  }

  /**
   * Generate HMAC SHA256 signature for authenticated requests
   */
  private sign(queryString: string): string {
    return createHmac("sha256", this.apiSecret)
      .update(queryString)
      .digest("hex");
  }

  /**
   * Build query string from parameters object
   */
  private buildQueryString(params: Record<string, string | number | undefined>): string {
    const filtered = Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
    return filtered.join("&");
  }

  /**
   * Check and update rate limit state
   */
  private checkRateLimit(): void {
    const now = Date.now();
    const minuteAgo = now - 60000;

    // Reset counters if a minute has passed
    if (this.rateLimitState.lastReset < minuteAgo) {
      // Log throttle stats before reset if any throttling occurred
      if (this.rateLimitState.throttledCount > 0) {
        logger.info("Rate limit window reset", {
          throttledRequests: this.rateLimitState.throttledCount,
          peakWeight: this.rateLimitState.requestWeight,
        });
      }
      this.rateLimitState.requestWeight = 0;
      this.rateLimitState.orderCount = 0;
      this.rateLimitState.lastReset = now;
      this.rateLimitState.throttledCount = 0;
    }

    // Calculate current usage percentage
    const usagePercent = this.rateLimitState.requestWeight / RATE_LIMIT_CONFIG.maxWeight;

    // Log warning at 90% (but not too frequently)
    if (usagePercent > RATE_LIMIT_CONFIG.warningThreshold) {
      const timeSinceLastWarn = now - this.rateLimitState.lastThrottleWarn;
      if (timeSinceLastWarn > RATE_LIMIT_CONFIG.throttleWarnIntervalMs) {
        logger.warn("Rate limit critical - approaching Binance limit", {
          weight: this.rateLimitState.requestWeight,
          maxWeight: RATE_LIMIT_CONFIG.maxWeight,
          usagePercent: Math.round(usagePercent * 100),
        });
        this.rateLimitState.lastThrottleWarn = now;
      }
    }
  }

  /**
   * Check if we should throttle requests based on current rate limit usage
   * Returns true if request should be delayed
   */
  shouldThrottle(): boolean {
    this.checkRateLimit();
    const usagePercent = this.rateLimitState.requestWeight / RATE_LIMIT_CONFIG.maxWeight;
    return usagePercent >= RATE_LIMIT_CONFIG.throttleThreshold;
  }

  /**
   * Calculate delay needed based on current rate limit usage
   * Returns 0 if no delay needed, otherwise returns delay in ms
   */
  private calculateThrottleDelay(): number {
    const usagePercent = this.rateLimitState.requestWeight / RATE_LIMIT_CONFIG.maxWeight;

    if (usagePercent < RATE_LIMIT_CONFIG.throttleThreshold) {
      return 0;
    }

    // Calculate delay based on how close we are to the limit
    // At 80% = throttleDelayMs, at 100% = maxThrottleDelayMs
    const throttleRange = 1 - RATE_LIMIT_CONFIG.throttleThreshold; // 0.2
    const throttleProgress = (usagePercent - RATE_LIMIT_CONFIG.throttleThreshold) / throttleRange;
    const delayRange = RATE_LIMIT_CONFIG.maxThrottleDelayMs - RATE_LIMIT_CONFIG.throttleDelayMs;

    return Math.floor(RATE_LIMIT_CONFIG.throttleDelayMs + (delayRange * throttleProgress));
  }

  /**
   * Apply throttling delay if needed
   * Proactively slows down requests at 80% capacity
   */
  private async applyThrottling(): Promise<void> {
    const delay = this.calculateThrottleDelay();

    if (delay > 0) {
      this.rateLimitState.throttledCount++;

      const usagePercent = Math.round(
        (this.rateLimitState.requestWeight / RATE_LIMIT_CONFIG.maxWeight) * 100
      );

      logger.debug("Throttling request", {
        delayMs: delay,
        currentWeight: this.rateLimitState.requestWeight,
        usagePercent,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): {
    currentWeight: number;
    maxWeight: number;
    usagePercent: number;
    isThrottling: boolean;
    throttledCount: number;
    timeUntilReset: number;
  } {
    const now = Date.now();
    const usagePercent = this.rateLimitState.requestWeight / RATE_LIMIT_CONFIG.maxWeight;
    const timeUntilReset = Math.max(0, 60000 - (now - this.rateLimitState.lastReset));

    return {
      currentWeight: this.rateLimitState.requestWeight,
      maxWeight: RATE_LIMIT_CONFIG.maxWeight,
      usagePercent: Math.round(usagePercent * 100),
      isThrottling: usagePercent >= RATE_LIMIT_CONFIG.throttleThreshold,
      throttledCount: this.rateLimitState.throttledCount,
      timeUntilReset,
    };
  }

  /**
   * Update rate limit counters from response headers
   */
  private updateRateLimitFromHeaders(headers: Headers): void {
    const usedWeight = headers.get("x-mbx-used-weight-1m");
    if (usedWeight) {
      this.rateLimitState.requestWeight = parseInt(usedWeight, 10);
    }
  }

  /**
   * Make a public API request (no authentication required)
   * Includes automatic retry with exponential backoff and predictive rate limiting
   */
  private async publicRequest<T>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    // Apply predictive throttling before making request
    await this.applyThrottling();

    return withRetry(async () => {
      this.checkRateLimit();

      const queryString = this.buildQueryString(params);
      const url = `${this.baseUrl}${endpoint}${queryString ? `?${queryString}` : ""}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });

        this.updateRateLimitFromHeaders(response.headers);

        if (!response.ok) {
          const error = (await response.json()) as BinanceAPIError;
          logger.error("Public API request failed", undefined, { endpoint, code: String(error.code), msg: error.msg });
          if (error.code === -1015 || error.code === -1003) {
            throw new RateLimitError(60);
          }
          throw new BinanceError(error.msg, error.code);
        }

        return response.json() as Promise<T>;
      } finally {
        clearTimeout(timeoutId);
      }
    }, BINANCE_RETRY_CONFIG);
  }

  /**
   * Make a signed API request (authentication required)
   * Includes automatic retry with exponential backoff, circuit breaker, and predictive rate limiting
   */
  private async signedRequest<T>(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    // Check circuit breaker before making request
    if (!apiCircuitBreaker.canExecute()) {
      throw new BinanceError("API circuit breaker is open - too many recent failures", -1);
    }

    // Apply predictive throttling before making request
    await this.applyThrottling();

    try {
      const result = await withRetry(async () => {
        this.checkRateLimit();

        // Sync server time on first signed request
        await this.syncServerTime();

        // Add timestamp and recvWindow
        const timestamp = this.getTimestamp();
        const allParams = {
          ...params,
          timestamp,
          recvWindow: 5000,
        };

        const queryString = this.buildQueryString(allParams);
        const signature = this.sign(queryString);
        const signedQueryString = `${queryString}&signature=${signature}`;

        const url = `${this.baseUrl}${endpoint}?${signedQueryString}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        try {
          const response = await fetch(url, {
            method,
            headers: {
              "Content-Type": "application/json",
              "X-MBX-APIKEY": this.apiKey,
            },
            signal: controller.signal,
          });

          this.updateRateLimitFromHeaders(response.headers);

          if (!response.ok) {
            const error = (await response.json()) as BinanceAPIError;
            logger.error("Signed API request failed", undefined, { endpoint, method, code: String(error.code), msg: error.msg });
            if (error.code === -1015 || error.code === -1003) {
              throw new RateLimitError(60);
            }
            throw new BinanceError(error.msg, error.code);
          }

          // Handle empty response (e.g., for DELETE requests)
          const text = await response.text();
          if (!text) {
            return {} as T;
          }

          return JSON.parse(text) as T;
        } finally {
          clearTimeout(timeoutId);
        }
      }, BINANCE_RETRY_CONFIG);

      apiCircuitBreaker.recordSuccess();
      return result;
    } catch (error) {
      apiCircuitBreaker.recordFailure();
      throw error;
    }
  }

  /**
   * Get circuit breaker state for monitoring
   */
  getCircuitBreakerState(): string {
    return apiCircuitBreaker.getState();
  }

  /**
   * Reset circuit breaker (use with caution)
   */
  resetCircuitBreaker(): void {
    apiCircuitBreaker.reset();
  }

  /**
   * Test connectivity to Binance API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.publicRequest("/api/v3/ping");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get account information (requires authentication)
   */
  async getAccountInfo(): Promise<BinanceAccountInfo> {
    return this.signedRequest<BinanceAccountInfo>("GET", "/api/v3/account");
  }

  /**
   * Get balance for a specific asset
   */
  async getBalance(asset: string): Promise<number> {
    const accountInfo = await this.getAccountInfo();
    const balance = accountInfo.balances.find(
      (b) => b.asset.toUpperCase() === asset.toUpperCase()
    );

    if (!balance) {
      return 0;
    }

    return parseFloat(balance.free) + parseFloat(balance.locked);
  }

  /**
   * Get candlestick/kline data and convert to our Candle format
   */
  async getCandles(
    symbol: string,
    interval: string,
    limit: number = 100
  ): Promise<Candle[]> {
    const klines = await this.publicRequest<BinanceKline[]>("/api/v3/klines", {
      symbol: symbol.toUpperCase(),
      interval,
      limit,
    });

    return klines.map((kline) => this.parseKlineToCandle(kline));
  }

  /**
   * Parse Binance kline array to our Candle type
   */
  private parseKlineToCandle(kline: BinanceKline): Candle {
    return {
      openTime: kline[0],
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
      closeTime: kline[6],
    };
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<number> {
    const ticker = await this.publicRequest<BinancePriceTicker>(
      "/api/v3/ticker/price",
      { symbol: symbol.toUpperCase() }
    );
    return parseFloat(ticker.price);
  }

  /**
   * Get top N symbols by 24h quote volume
   */
  async getTopSymbols(n: number): Promise<string[]> {
    const now = Date.now();
    if (this.topSymbolsCache && this.topSymbolsCache.expiresAt > now && this.topSymbolsCache.count >= n) {
      return this.topSymbolsCache.value.slice(0, n);
    }

    const tickers = await this.get24hrTickers();

    const topSymbols = tickers
      .filter((t) => t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .map((t) => t.symbol);

    this.topSymbolsCache = {
      value: topSymbols,
      count: topSymbols.length,
      expiresAt: now + TOP_SYMBOLS_CACHE_TTL_MS,
    };

    return topSymbols.slice(0, n);
  }

  /**
   * Get all 24hr tickers (useful for market scanning)
   */
  async get24hrTickers(): Promise<BinanceTicker24hr[]> {
    const now = Date.now();
    if (this.tickers24hCache && this.tickers24hCache.expiresAt > now) {
      return this.tickers24hCache.value;
    }

    if (this.inFlight24hrTickers) {
      return this.inFlight24hrTickers;
    }

    this.inFlight24hrTickers = this.publicRequest<BinanceTicker24hr[]>("/api/v3/ticker/24hr")
      .then((tickers) => {
        this.tickers24hCache = {
          value: tickers,
          expiresAt: Date.now() + TICKER_CACHE_TTL_MS,
        };
        return tickers;
      })
      .finally(() => {
        this.inFlight24hrTickers = null;
      });

    return this.inFlight24hrTickers;
  }

  /**
   * Get exchange information (trading rules, available symbols)
   */
  async getExchangeInfo(): Promise<BinanceExchangeInfo> {
    return this.publicRequest<BinanceExchangeInfo>("/api/v3/exchangeInfo");
  }

  /**
   * Place a new order
   */
  async placeOrder(params: OrderParams): Promise<BinanceOrder> {
    const orderParams: Record<string, string | number | undefined> = {
      symbol: params.symbol.toUpperCase(),
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      quoteOrderQty: params.quoteOrderQty,
      price: params.price,
      stopPrice: params.stopPrice,
      timeInForce: params.timeInForce,
      newClientOrderId: params.newClientOrderId,
    };

    // For LIMIT orders, timeInForce is required
    if (params.type === "LIMIT" && !params.timeInForce) {
      orderParams.timeInForce = "GTC";
    }

    return this.signedRequest<BinanceOrder>("POST", "/api/v3/order", orderParams);
  }

  /**
   * Cancel an existing order
   */
  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.signedRequest<BinanceOrder>("DELETE", "/api/v3/order", {
      symbol: symbol.toUpperCase(),
      orderId: parseInt(orderId, 10),
    });
  }

  /**
   * Get all open orders
   */
  async getOpenOrders(symbol?: string): Promise<BinanceOrder[]> {
    const params: Record<string, string | undefined> = {};
    if (symbol) {
      params.symbol = symbol.toUpperCase();
    }

    return this.signedRequest<BinanceOrder[]>("GET", "/api/v3/openOrders", params);
  }

  /**
   * Get funding wallet balances (fiat and crypto in funding wallet)
   * This is separate from spot wallet
   */
  async getFundingWallet(): Promise<Array<{ asset: string; free: string; locked: string; freeze: string; withdrawing: string }>> {
    try {
      const result = await this.signedRequest<Array<{
        asset: string;
        free: string;
        locked: string;
        freeze: string;
        withdrawing: string;
      }>>("POST", "/sapi/v1/asset/get-funding-asset", {});
      return result;
    } catch {
      // Return empty array if funding wallet API is not available
      return [];
    }
  }

  /**
   * Get all wallet balances (spot + funding combined)
   */
  async getAllBalances(): Promise<Array<{ asset: string; free: number; locked: number; wallet: "spot" | "funding" }>> {
    const balances: Array<{ asset: string; free: number; locked: number; wallet: "spot" | "funding" }> = [];

    // Get spot wallet
    try {
      const spotAccount = await this.getAccountInfo();
      for (const b of spotAccount.balances) {
        const free = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        if (free > 0 || locked > 0) {
          balances.push({ asset: b.asset, free, locked, wallet: "spot" });
        }
      }
    } catch (error) {
      logger.error("Failed to get spot balances", error instanceof Error ? error : undefined);
    }

    // Get funding wallet
    try {
      const fundingBalances = await this.getFundingWallet();
      for (const b of fundingBalances) {
        const free = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        if (free > 0 || locked > 0) {
          balances.push({ asset: b.asset, free, locked, wallet: "funding" });
        }
      }
    } catch (error) {
      logger.error("Failed to get funding balances", error instanceof Error ? error : undefined);
    }

    return balances;
  }

  /**
   * Get trade history for a symbol
   */
  async getTradeHistory(symbol: string, limit: number = 50): Promise<BinanceTrade[]> {
    try {
      return await this.signedRequest<BinanceTrade[]>("GET", "/api/v3/myTrades", {
        symbol: symbol.toUpperCase(),
        limit,
      });
    } catch {
      return [];
    }
  }

  /**
   * Get all trade history across all symbols (recent trades)
   */
  async getAllTradeHistory(limit: number = 100): Promise<BinanceTrade[]> {
    try {
      // Get top traded symbols first
      const topSymbols = await this.getTopSymbols(10);
      const allTrades: BinanceTrade[] = [];

      const results = await this.mapWithConcurrency(
        topSymbols,
        TRADE_HISTORY_CONCURRENCY,
        (symbol) => this.getTradeHistory(symbol, Math.ceil(limit / 10))
      );

      for (const trades of results) {
        allTrades.push(...trades);
      }

      // Sort by time (newest first) and limit
      return allTrades
        .sort((a, b) => b.time - a.time)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Get order history for a symbol
   */
  async getOrderHistory(symbol: string, limit: number = 50): Promise<BinanceOrder[]> {
    try {
      return await this.signedRequest<BinanceOrder[]>("GET", "/api/v3/allOrders", {
        symbol: symbol.toUpperCase(),
        limit,
      });
    } catch {
      return [];
    }
  }

  /**
   * Get deposit history
   */
  async getDepositHistory(limit: number = 50): Promise<BinanceDeposit[]> {
    try {
      return await this.signedRequest<BinanceDeposit[]>("GET", "/sapi/v1/capital/deposit/hisrec", {
        limit,
      });
    } catch {
      return [];
    }
  }

  /**
   * Get withdrawal history
   */
  async getWithdrawalHistory(limit: number = 50): Promise<BinanceWithdrawal[]> {
    try {
      return await this.signedRequest<BinanceWithdrawal[]>("GET", "/sapi/v1/capital/withdraw/history", {
        limit,
      });
    } catch {
      return [];
    }
  }

  /**
   * Get Simple Earn flexible positions
   */
  async getEarnPositions(): Promise<BinanceEarnPosition[]> {
    try {
      const response = await this.signedRequest<{ rows: BinanceEarnPosition[] }>(
        "GET",
        "/sapi/v1/simple-earn/flexible/position",
        {}
      );
      return response.rows || [];
    } catch {
      return [];
    }
  }

  /**
   * Get API key restrictions/permissions
   */
  async getAPIRestrictions(): Promise<BinanceAPIRestrictions | null> {
    try {
      return await this.signedRequest<BinanceAPIRestrictions>(
        "GET",
        "/sapi/v1/account/apiRestrictions",
        {}
      );
    } catch {
      return null;
    }
  }

  /**
   * Get comprehensive account details including all available information
   */
  async getFullAccountDetails(): Promise<{
    account: BinanceAccountInfo;
    apiRestrictions: BinanceAPIRestrictions | null;
    recentTrades: BinanceTrade[];
    deposits: BinanceDeposit[];
    withdrawals: BinanceWithdrawal[];
    earnPositions: BinanceEarnPosition[];
  }> {
    // Fetch all data in parallel for speed
    const [account, apiRestrictions, recentTrades, deposits, withdrawals, earnPositions] =
      await Promise.all([
        this.getAccountInfo(),
        this.getAPIRestrictions(),
        this.getAllTradeHistory(20),
        this.getDepositHistory(10),
        this.getWithdrawalHistory(10),
        this.getEarnPositions(),
      ]);

    return {
      account,
      apiRestrictions,
      recentTrades,
      deposits,
      withdrawals,
      earnPositions,
    };
  }

  // ============================================================================
  // MARKET DATA ENDPOINTS
  // ============================================================================

  /**
   * Get order book depth for a symbol
   */
  async getOrderBook(symbol: string, limit: number = 100): Promise<BinanceOrderBook> {
    return this.publicRequest<BinanceOrderBook>("/api/v3/depth", {
      symbol: symbol.toUpperCase(),
      limit: Math.min(limit, 5000),
    });
  }

  /**
   * Get recent trades for a symbol
   */
  async getRecentTrades(symbol: string, limit: number = 100): Promise<BinanceRecentTrade[]> {
    return this.publicRequest<BinanceRecentTrade[]>("/api/v3/trades", {
      symbol: symbol.toUpperCase(),
      limit: Math.min(limit, 1000),
    });
  }

  /**
   * Get aggregate trades for a symbol
   */
  async getAggTrades(
    symbol: string,
    options?: { fromId?: number; startTime?: number; endTime?: number; limit?: number }
  ): Promise<BinanceAggTrade[]> {
    return this.publicRequest<BinanceAggTrade[]>("/api/v3/aggTrades", {
      symbol: symbol.toUpperCase(),
      fromId: options?.fromId,
      startTime: options?.startTime,
      endTime: options?.endTime,
      limit: options?.limit ?? 500,
    });
  }

  /**
   * Get current average price for a symbol (5-minute weighted average)
   */
  async getAvgPrice(symbol: string): Promise<BinanceAvgPrice> {
    return this.publicRequest<BinanceAvgPrice>("/api/v3/avgPrice", {
      symbol: symbol.toUpperCase(),
    });
  }

  /**
   * Get best bid/ask prices for a symbol or all symbols
   */
  async getBookTicker(symbol?: string): Promise<BinanceBookTicker | BinanceBookTicker[]> {
    if (symbol) {
      return this.publicRequest<BinanceBookTicker>("/api/v3/ticker/bookTicker", {
        symbol: symbol.toUpperCase(),
      });
    }
    return this.publicRequest<BinanceBookTicker[]>("/api/v3/ticker/bookTicker");
  }

  /**
   * Get spread (difference between best ask and best bid) for a symbol
   */
  async getSpread(symbol: string): Promise<{ spread: number; spreadPercent: number; bidPrice: number; askPrice: number }> {
    const ticker = await this.getBookTicker(symbol) as BinanceBookTicker;
    const bidPrice = parseFloat(ticker.bidPrice);
    const askPrice = parseFloat(ticker.askPrice);
    const spread = askPrice - bidPrice;
    const spreadPercent = (spread / askPrice) * 100;

    return { spread, spreadPercent, bidPrice, askPrice };
  }

  // ============================================================================
  // TRADING ENDPOINTS
  // ============================================================================

  /**
   * Test new order creation without actually placing it
   */
  async testOrder(params: OrderParams): Promise<boolean> {
    try {
      const orderParams: Record<string, string | number | undefined> = {
        symbol: params.symbol.toUpperCase(),
        side: params.side,
        type: params.type,
        quantity: params.quantity,
        quoteOrderQty: params.quoteOrderQty,
        price: params.price,
        stopPrice: params.stopPrice,
        timeInForce: params.timeInForce ?? (params.type === "LIMIT" ? "GTC" : undefined),
        newClientOrderId: params.newClientOrderId,
      };

      await this.signedRequest<Record<string, never>>("POST", "/api/v3/order/test", orderParams);
      return true;
    } catch (error) {
      logger.error("Test order failed", error instanceof Error ? error : undefined);
      return false;
    }
  }

  /**
   * Cancel all open orders on a symbol
   */
  async cancelAllOrders(symbol: string): Promise<BinanceOrder[]> {
    return this.signedRequest<BinanceOrder[]>("DELETE", "/api/v3/openOrders", {
      symbol: symbol.toUpperCase(),
    });
  }

  /**
   * Cancel an existing order and place a new one atomically
   */
  async cancelReplaceOrder(
    symbol: string,
    cancelOrderId: number,
    newOrderParams: Omit<OrderParams, "symbol">
  ): Promise<BinanceCancelReplaceResult> {
    const params: Record<string, string | number | undefined> = {
      symbol: symbol.toUpperCase(),
      cancelOrderId,
      side: newOrderParams.side,
      type: newOrderParams.type,
      quantity: newOrderParams.quantity,
      quoteOrderQty: newOrderParams.quoteOrderQty,
      price: newOrderParams.price,
      stopPrice: newOrderParams.stopPrice,
      timeInForce: newOrderParams.timeInForce ?? (newOrderParams.type === "LIMIT" ? "GTC" : undefined),
      cancelReplaceMode: "STOP_ON_FAILURE",
    };

    return this.signedRequest<BinanceCancelReplaceResult>("POST", "/api/v3/order/cancelReplace", params);
  }

  /**
   * Place OCO order (One-Cancels-Other: limit + stop-loss combo)
   */
  async placeOCOOrder(params: OCOOrderParams): Promise<BinanceOCOOrder> {
    const orderParams: Record<string, string | number | undefined> = {
      symbol: params.symbol.toUpperCase(),
      side: params.side,
      quantity: params.quantity,
      price: params.price,
      stopPrice: params.stopPrice,
      stopLimitPrice: params.stopLimitPrice,
      stopLimitTimeInForce: params.stopLimitTimeInForce ?? "GTC",
      listClientOrderId: params.listClientOrderId,
      limitClientOrderId: params.limitClientOrderId,
      stopClientOrderId: params.stopClientOrderId,
    };

    return this.signedRequest<BinanceOCOOrder>("POST", "/api/v3/orderList/oco", orderParams);
  }

  /**
   * Cancel an order list (OCO, OTO, etc.)
   */
  async cancelOrderList(symbol: string, orderListId: number): Promise<BinanceOrderList> {
    return this.signedRequest<BinanceOrderList>("DELETE", "/api/v3/orderList", {
      symbol: symbol.toUpperCase(),
      orderListId,
    });
  }

  /**
   * Get status of a specific order
   */
  async getOrderStatus(symbol: string, orderId: number): Promise<BinanceOrder> {
    return this.signedRequest<BinanceOrder>("GET", "/api/v3/order", {
      symbol: symbol.toUpperCase(),
      orderId,
    });
  }

  /**
   * Get all open order lists (OCO, OTO, etc.)
   */
  async getOpenOrderLists(): Promise<BinanceOrderList[]> {
    return this.signedRequest<BinanceOrderList[]>("GET", "/api/v3/openOrderList");
  }

  /**
   * Get unfilled order count for rate limiting
   */
  async getOrderRateLimit(): Promise<Array<{ rateLimitType: string; interval: string; intervalNum: number; limit: number; count: number }>> {
    return this.signedRequest<Array<{ rateLimitType: string; interval: string; intervalNum: number; limit: number; count: number }>>(
      "GET",
      "/api/v3/rateLimit/order"
    );
  }

  // ============================================================================
  // WALLET ENDPOINTS
  // ============================================================================

  /**
   * Get all coin information (networks, fees, deposit/withdraw status)
   */
  async getCoinInfo(): Promise<BinanceCoinInfo[]> {
    return this.signedRequest<BinanceCoinInfo[]>("GET", "/sapi/v1/capital/config/getall");
  }

  /**
   * Get network info for a specific coin
   */
  async getCoinNetworks(coin: string): Promise<BinanceCoinInfo | null> {
    const allCoins = await this.getCoinInfo();
    return allCoins.find((c) => c.coin.toUpperCase() === coin.toUpperCase()) ?? null;
  }

  /**
   * Get daily account snapshot
   */
  async getAccountSnapshot(
    type: "SPOT" | "MARGIN" | "FUTURES" = "SPOT",
    limit: number = 7
  ): Promise<BinanceAccountSnapshot> {
    return this.signedRequest<BinanceAccountSnapshot>("GET", "/sapi/v1/accountSnapshot", {
      type,
      limit: Math.min(limit, 30),
    });
  }

  /**
   * Transfer between wallets (spot, funding, futures, margin)
   */
  async universalTransfer(
    type: TransferType,
    asset: string,
    amount: number
  ): Promise<BinanceTransferResponse> {
    return this.signedRequest<BinanceTransferResponse>("POST", "/sapi/v1/asset/transfer", {
      type,
      asset: asset.toUpperCase(),
      amount,
    });
  }

  /**
   * Get universal transfer history
   */
  async getTransferHistory(
    type: TransferType,
    options?: { startTime?: number; endTime?: number; current?: number; size?: number }
  ): Promise<{ total: number; rows: BinanceTransferHistory[] }> {
    return this.signedRequest<{ total: number; rows: BinanceTransferHistory[] }>(
      "GET",
      "/sapi/v1/asset/transfer",
      {
        type,
        startTime: options?.startTime,
        endTime: options?.endTime,
        current: options?.current ?? 1,
        size: options?.size ?? 10,
      }
    );
  }

  /**
   * Convert dust assets to BNB
   */
  async convertDust(assets: string[]): Promise<BinanceDustTransfer> {
    return this.signedRequest<BinanceDustTransfer>("POST", "/sapi/v1/asset/dust", {
      asset: assets.join(","),
    });
  }

  /**
   * Get dust conversion history
   */
  async getDustLog(options?: { startTime?: number; endTime?: number }): Promise<BinanceDustLog> {
    return this.signedRequest<BinanceDustLog>("GET", "/sapi/v1/asset/dribblet", {
      startTime: options?.startTime,
      endTime: options?.endTime,
    });
  }

  /**
   * Get assets that can be converted to BNB (dustable)
   */
  async getDustableAssets(): Promise<{ details: BinanceDustableAsset[]; totalTransferBtc: string; totalTransferBNB: string }> {
    return this.signedRequest<{ details: BinanceDustableAsset[]; totalTransferBtc: string; totalTransferBNB: string }>(
      "POST",
      "/sapi/v1/asset/dust-btc"
    );
  }

  /**
   * Get asset dividend history (airdrops, staking rewards, etc.)
   */
  async getAssetDividends(
    options?: { asset?: string; startTime?: number; endTime?: number; limit?: number }
  ): Promise<{ rows: BinanceAssetDividend[]; total: number }> {
    return this.signedRequest<{ rows: BinanceAssetDividend[]; total: number }>(
      "GET",
      "/sapi/v1/asset/assetDividend",
      {
        asset: options?.asset,
        startTime: options?.startTime,
        endTime: options?.endTime,
        limit: options?.limit ?? 20,
      }
    );
  }

  /**
   * Get asset details (min withdraw, fees, etc.)
   */
  async getAssetDetails(asset?: string): Promise<BinanceAssetDetail> {
    return this.signedRequest<BinanceAssetDetail>("GET", "/sapi/v1/asset/assetDetail", {
      asset: asset?.toUpperCase(),
    });
  }

  /**
   * Get trade fees for symbols
   */
  async getTradeFees(symbol?: string): Promise<BinanceTradeFee[]> {
    return this.signedRequest<BinanceTradeFee[]>("GET", "/sapi/v1/asset/tradeFee", {
      symbol: symbol?.toUpperCase(),
    });
  }

  /**
   * Get user assets with non-zero balances
   */
  async getUserAssets(needBtcValuation: boolean = true): Promise<BinanceUserAsset[]> {
    return this.signedRequest<BinanceUserAsset[]>("POST", "/sapi/v3/asset/getUserAsset", {
      needBtcValuation: needBtcValuation ? "true" : "false",
    });
  }

  /**
   * Get deposit address for a coin
   */
  async getDepositAddress(coin: string, network?: string): Promise<BinanceDepositAddress> {
    return this.signedRequest<BinanceDepositAddress>("GET", "/sapi/v1/capital/deposit/address", {
      coin: coin.toUpperCase(),
      network,
    });
  }

  /**
   * Get wallet balances summary
   */
  async getWalletBalances(): Promise<BinanceWalletBalance[]> {
    return this.signedRequest<BinanceWalletBalance[]>("GET", "/sapi/v1/asset/wallet/balance");
  }

  // ============================================================================
  // SIMPLE EARN ENDPOINTS
  // ============================================================================

  /**
   * Get list of flexible earn products
   */
  async getFlexibleProducts(
    options?: { asset?: string; current?: number; size?: number }
  ): Promise<{ rows: BinanceFlexibleProduct[]; total: number }> {
    return this.signedRequest<{ rows: BinanceFlexibleProduct[]; total: number }>(
      "GET",
      "/sapi/v1/simple-earn/flexible/list",
      {
        asset: options?.asset?.toUpperCase(),
        current: options?.current ?? 1,
        size: options?.size ?? 50,
      }
    );
  }

  /**
   * Get list of locked earn products
   */
  async getLockedProducts(
    options?: { asset?: string; current?: number; size?: number }
  ): Promise<{ rows: BinanceLockedProduct[]; total: number }> {
    return this.signedRequest<{ rows: BinanceLockedProduct[]; total: number }>(
      "GET",
      "/sapi/v1/simple-earn/locked/list",
      {
        asset: options?.asset?.toUpperCase(),
        current: options?.current ?? 1,
        size: options?.size ?? 50,
      }
    );
  }

  /**
   * Get locked earn positions
   */
  async getLockedPositions(
    options?: { asset?: string; positionId?: string; current?: number; size?: number }
  ): Promise<{ rows: BinanceLockedPosition[]; total: number }> {
    return this.signedRequest<{ rows: BinanceLockedPosition[]; total: number }>(
      "GET",
      "/sapi/v1/simple-earn/locked/position",
      {
        asset: options?.asset?.toUpperCase(),
        positionId: options?.positionId,
        current: options?.current ?? 1,
        size: options?.size ?? 50,
      }
    );
  }

  /**
   * Subscribe to flexible earn product
   */
  async subscribeFlexible(
    productId: string,
    amount: number,
    sourceAccount?: "SPOT" | "FUND"
  ): Promise<BinanceEarnSubscription> {
    return this.signedRequest<BinanceEarnSubscription>("POST", "/sapi/v1/simple-earn/flexible/subscribe", {
      productId,
      amount,
      sourceAccount: sourceAccount ?? "SPOT",
    });
  }

  /**
   * Redeem from flexible earn product
   */
  async redeemFlexible(
    productId: string,
    options?: { redeemAll?: boolean; amount?: number; destAccount?: "SPOT" | "FUND" }
  ): Promise<BinanceEarnRedemption> {
    return this.signedRequest<BinanceEarnRedemption>("POST", "/sapi/v1/simple-earn/flexible/redeem", {
      productId,
      redeemAll: (options?.redeemAll ?? false) ? "true" : "false",
      amount: options?.amount,
      destAccount: options?.destAccount ?? "SPOT",
    });
  }

  /**
   * Subscribe to locked earn product
   */
  async subscribeLocked(
    projectId: string,
    amount: number,
    sourceAccount?: "SPOT" | "FUND"
  ): Promise<BinanceEarnSubscription> {
    return this.signedRequest<BinanceEarnSubscription>("POST", "/sapi/v1/simple-earn/locked/subscribe", {
      projectId,
      amount,
      sourceAccount: sourceAccount ?? "SPOT",
    });
  }

  /**
   * Get flexible subscription history
   */
  async getFlexibleSubscriptionHistory(
    options?: { productId?: string; asset?: string; startTime?: number; endTime?: number; current?: number; size?: number }
  ): Promise<{ rows: BinanceEarnSubscriptionRecord[]; total: number }> {
    return this.signedRequest<{ rows: BinanceEarnSubscriptionRecord[]; total: number }>(
      "GET",
      "/sapi/v1/simple-earn/flexible/history/subscriptionRecord",
      {
        productId: options?.productId,
        asset: options?.asset?.toUpperCase(),
        startTime: options?.startTime,
        endTime: options?.endTime,
        current: options?.current ?? 1,
        size: options?.size ?? 50,
      }
    );
  }

  /**
   * Get flexible redemption history
   */
  async getFlexibleRedemptionHistory(
    options?: { productId?: string; asset?: string; startTime?: number; endTime?: number; current?: number; size?: number }
  ): Promise<{ rows: BinanceEarnRedemptionRecord[]; total: number }> {
    return this.signedRequest<{ rows: BinanceEarnRedemptionRecord[]; total: number }>(
      "GET",
      "/sapi/v1/simple-earn/flexible/history/redemptionRecord",
      {
        productId: options?.productId,
        asset: options?.asset?.toUpperCase(),
        startTime: options?.startTime,
        endTime: options?.endTime,
        current: options?.current ?? 1,
        size: options?.size ?? 50,
      }
    );
  }

  /**
   * Get all Simple Earn positions (flexible + locked)
   */
  async getAllEarnPositions(): Promise<{
    flexible: BinanceEarnPosition[];
    locked: BinanceLockedPosition[];
    totalValue: { asset: string; amount: number }[];
  }> {
    const [flexible, locked] = await Promise.all([
      this.getEarnPositions(),
      this.getLockedPositions(),
    ]);

    // Aggregate total value by asset
    const totals: Record<string, number> = {};

    for (const pos of flexible) {
      const asset = pos.asset;
      const amount = parseFloat(pos.totalAmount);
      totals[asset] = (totals[asset] ?? 0) + amount;
    }

    for (const pos of locked.rows) {
      const asset = pos.asset;
      const amount = parseFloat(pos.amount);
      totals[asset] = (totals[asset] ?? 0) + amount;
    }

    const totalValue = Object.entries(totals).map(([asset, amount]) => ({ asset, amount }));

    return {
      flexible,
      locked: locked.rows,
      totalValue,
    };
  }

  // ============================================================================
  // Withdrawal
  // ============================================================================

  /**
   * Submit a withdrawal request to an external address
   * Requires API key with withdrawal permissions enabled
   */
  async withdraw(
    coin: string,
    network: string,
    address: string,
    amount: number,
    addressTag?: string
  ): Promise<{ id: string }> {
    const params: Record<string, string | number> = {
      coin: coin.toUpperCase(),
      network,
      address,
      amount,
    };
    if (addressTag) params.addressTag = addressTag;
    return this.signedRequest<{ id: string }>("POST", "/sapi/v1/capital/withdraw/apply", params);
  }
}

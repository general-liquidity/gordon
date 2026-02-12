/**
 * Kraken API Client
 * Handles authenticated and public API requests to Kraken
 */

import { createHmac, createHash } from "crypto";
import type {
  KrakenResponse,
  KrakenAssetInfo,
  KrakenAssetPair,
  KrakenTicker,
  KrakenOHLC,
  KrakenOrderBook,
  KrakenBalance,
  KrakenExtendedBalance,
  KrakenTradeBalance,
  KrakenOrder,
  KrakenAddOrderResponse,
  KrakenCancelOrderResponse,
  KrakenTrade,
  KrakenDepositStatus,
  KrakenWithdrawStatus,
  KrakenServerTime,
  KrakenSystemStatus,
} from "./types.ts";
import { KrakenError, KrakenRateLimitError, KrakenAuthError } from "../../errors/index.ts";
import { createModuleLogger } from "../logger/index.ts";
import { withRetry, CircuitBreaker, type RetryConfig } from "../retry.ts";

const logger = createModuleLogger("kraken");

// Default retry config for Kraken API calls
const KRAKEN_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
};

// Circuit breaker for API protection
const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
});

// Kraken API base URLs
const BASE_URL = "https://api.kraken.com";

// Rate limit tracking (Kraken uses counter-based system)
interface RateLimitState {
  counter: number;
  lastUpdate: number;
  lastThrottleWarn: number;
  throttledCount: number;
}

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  maxCounter: 15, // Standard tier
  decayRate: 0.33, // Counter decreases per second
  throttleThreshold: 0.8,
  warningThreshold: 0.9,
  throttleDelayMs: 100,
  maxThrottleDelayMs: 1000,
  throttleWarnIntervalMs: 10000,
};

/**
 * Kraken API Client
 */
export class KrakenClient {
  private apiKey: string;
  private apiSecret: string;
  private rateLimitState: RateLimitState;
  private nonce: number;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.nonce = Date.now() * 1000;
    this.rateLimitState = {
      counter: 0,
      lastUpdate: Date.now(),
      lastThrottleWarn: 0,
      throttledCount: 0,
    };
  }

  /**
   * Generate nonce for requests (must be incrementing)
   */
  private getNonce(): string {
    this.nonce++;
    return this.nonce.toString();
  }

  /**
   * Generate HMAC SHA512 signature for authenticated requests
   * Kraken signature: HMAC-SHA512(path + SHA256(nonce + POST data), base64-decoded secret)
   */
  private sign(path: string, nonce: string, postData: string): string {
    const message = nonce + postData;
    const hash = createHash("sha256").update(message).digest();
    const secretBuffer = Buffer.from(this.apiSecret, "base64");
    const pathBuffer = Buffer.from(path);
    const signatureInput = Buffer.concat([pathBuffer, hash]);
    return createHmac("sha512", secretBuffer).update(signatureInput).digest("base64");
  }

  /**
   * Update rate limit counter with decay
   */
  private updateRateLimitCounter(): void {
    const now = Date.now();
    const elapsed = (now - this.rateLimitState.lastUpdate) / 1000;
    const decay = elapsed * RATE_LIMIT_CONFIG.decayRate;
    this.rateLimitState.counter = Math.max(0, this.rateLimitState.counter - decay);
    this.rateLimitState.lastUpdate = now;
  }

  /**
   * Check rate limit status
   */
  private checkRateLimit(): void {
    this.updateRateLimitCounter();

    const usagePercent = this.rateLimitState.counter / RATE_LIMIT_CONFIG.maxCounter;

    if (usagePercent > RATE_LIMIT_CONFIG.warningThreshold) {
      const now = Date.now();
      const timeSinceLastWarn = now - this.rateLimitState.lastThrottleWarn;
      if (timeSinceLastWarn > RATE_LIMIT_CONFIG.throttleWarnIntervalMs) {
        logger.warn("Rate limit critical - approaching Kraken limit", {
          counter: this.rateLimitState.counter.toFixed(2),
          maxCounter: RATE_LIMIT_CONFIG.maxCounter,
          usagePercent: Math.round(usagePercent * 100),
        });
        this.rateLimitState.lastThrottleWarn = now;
      }
    }
  }

  /**
   * Check if we should throttle requests
   */
  shouldThrottle(): boolean {
    this.updateRateLimitCounter();
    const usagePercent = this.rateLimitState.counter / RATE_LIMIT_CONFIG.maxCounter;
    return usagePercent >= RATE_LIMIT_CONFIG.throttleThreshold;
  }

  /**
   * Calculate throttle delay
   */
  private calculateThrottleDelay(): number {
    const usagePercent = this.rateLimitState.counter / RATE_LIMIT_CONFIG.maxCounter;

    if (usagePercent < RATE_LIMIT_CONFIG.throttleThreshold) {
      return 0;
    }

    const overThreshold = usagePercent - RATE_LIMIT_CONFIG.throttleThreshold;
    const maxOverThreshold = 1 - RATE_LIMIT_CONFIG.throttleThreshold;
    const delayPercent = Math.min(overThreshold / maxOverThreshold, 1);

    return Math.round(
      RATE_LIMIT_CONFIG.throttleDelayMs +
        delayPercent * (RATE_LIMIT_CONFIG.maxThrottleDelayMs - RATE_LIMIT_CONFIG.throttleDelayMs)
    );
  }

  /**
   * Apply throttling before requests
   */
  private async applyThrottling(): Promise<void> {
    const delay = this.calculateThrottleDelay();
    if (delay > 0) {
      this.rateLimitState.throttledCount++;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus(): {
    currentCounter: number;
    maxCounter: number;
    usagePercent: number;
    isThrottling: boolean;
    throttledCount: number;
    timeUntilReset: number;
  } {
    this.updateRateLimitCounter();
    const usagePercent = this.rateLimitState.counter / RATE_LIMIT_CONFIG.maxCounter;
    const timeUntilReset = Math.ceil(this.rateLimitState.counter / RATE_LIMIT_CONFIG.decayRate) * 1000;
    return {
      currentCounter: Math.round(this.rateLimitState.counter * 100) / 100,
      maxCounter: RATE_LIMIT_CONFIG.maxCounter,
      usagePercent: Math.round(usagePercent * 100),
      isThrottling: this.shouldThrottle(),
      throttledCount: this.rateLimitState.throttledCount,
      timeUntilReset,
    };
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): string {
    return apiCircuitBreaker.getState();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    apiCircuitBreaker.reset();
  }

  /**
   * Make authenticated request to Kraken API
   */
  private async signedRequest<T>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {},
    counterCost: number = 1
  ): Promise<T> {
    if (!apiCircuitBreaker.canExecute()) {
      throw new KrakenError(["API circuit breaker is open"]);
    }

    await this.applyThrottling();
    this.checkRateLimit();
    this.rateLimitState.counter += counterCost;

    return withRetry(async () => {
      const nonce = this.getNonce();
      const postParams = { ...params, nonce };

      // Build POST data
      const postData = Object.entries(postParams)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join("&");

      const path = `/0/private${endpoint}`;
      const signature = this.sign(path, nonce, postData);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(`${BASE_URL}${path}`, {
          method: "POST",
          headers: {
            "API-Key": this.apiKey,
            "API-Sign": signature,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: postData,
          signal: controller.signal,
        });

        const data = (await response.json()) as KrakenResponse<T>;

        if (data.error && data.error.length > 0) {
          logger.error("Kraken API request failed", undefined, {
            endpoint,
            errors: data.error,
          });

          const errorStr = data.error.join(" ");

          if (errorStr.includes("Rate limit")) {
            apiCircuitBreaker.recordFailure();
            throw new KrakenRateLimitError(undefined, endpoint);
          }

          if (errorStr.includes("Invalid key") || errorStr.includes("Invalid signature")) {
            throw new KrakenAuthError(errorStr);
          }

          if (errorStr.includes("Invalid nonce")) {
            // Increment nonce and retry
            this.nonce = Date.now() * 1000;
            throw new KrakenError(data.error, endpoint);
          }

          apiCircuitBreaker.recordFailure();
          throw new KrakenError(data.error, endpoint);
        }

        apiCircuitBreaker.recordSuccess();
        return data.result as T;
      } finally {
        clearTimeout(timeoutId);
      }
    }, KRAKEN_RETRY_CONFIG);
  }

  /**
   * Make public (unauthenticated) request
   */
  private async publicRequest<T>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    await this.applyThrottling();
    this.checkRateLimit();
    this.rateLimitState.counter += 1;

    return withRetry(async () => {
      const queryString = Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join("&");

      const url = `${BASE_URL}/0/public${endpoint}${queryString ? `?${queryString}` : ""}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });

        const data = (await response.json()) as KrakenResponse<T>;

        if (data.error && data.error.length > 0) {
          logger.error("Kraken public API request failed", undefined, {
            endpoint,
            errors: data.error,
          });

          if (data.error.some((e) => e.includes("Rate limit"))) {
            throw new KrakenRateLimitError(undefined, endpoint);
          }

          throw new KrakenError(data.error, endpoint);
        }

        return data.result as T;
      } finally {
        clearTimeout(timeoutId);
      }
    }, KRAKEN_RETRY_CONFIG);
  }

  // =========================================================================
  // Public Market Data
  // =========================================================================

  /**
   * Get server time
   */
  async getServerTime(): Promise<KrakenServerTime> {
    return this.publicRequest<KrakenServerTime>("/Time");
  }

  /**
   * Get system status
   */
  async getSystemStatus(): Promise<KrakenSystemStatus> {
    return this.publicRequest<KrakenSystemStatus>("/SystemStatus");
  }

  /**
   * Get asset info
   */
  async getAssets(assets?: string[]): Promise<Record<string, KrakenAssetInfo>> {
    const params: Record<string, string | undefined> = {};
    if (assets) params.asset = assets.join(",");
    return this.publicRequest<Record<string, KrakenAssetInfo>>("/Assets", params);
  }

  /**
   * Get asset pairs
   */
  async getAssetPairs(pairs?: string[]): Promise<Record<string, KrakenAssetPair>> {
    const params: Record<string, string | undefined> = {};
    if (pairs) params.pair = pairs.join(",");
    return this.publicRequest<Record<string, KrakenAssetPair>>("/AssetPairs", params);
  }

  /**
   * Get ticker information
   */
  async getTicker(pairs: string[]): Promise<Record<string, KrakenTicker>> {
    return this.publicRequest<Record<string, KrakenTicker>>("/Ticker", {
      pair: pairs.join(","),
    });
  }

  /**
   * Get OHLC data
   */
  async getOHLC(
    pair: string,
    interval?: number,
    since?: number
  ): Promise<Record<string, KrakenOHLC[] | number>> {
    return this.publicRequest<Record<string, KrakenOHLC[] | number>>("/OHLC", {
      pair,
      interval,
      since,
    });
  }

  /**
   * Get order book
   */
  async getOrderBook(pair: string, count?: number): Promise<Record<string, KrakenOrderBook>> {
    return this.publicRequest<Record<string, KrakenOrderBook>>("/Depth", {
      pair,
      count,
    });
  }

  // =========================================================================
  // Private Account Data
  // =========================================================================

  /**
   * Test connection by getting account balance
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getBalance();
      return true;
    } catch (error) {
      logger.error("Kraken connection test failed", error instanceof Error ? error : undefined);
      return false;
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<KrakenBalance> {
    return this.signedRequest<KrakenBalance>("/Balance");
  }

  /**
   * Get extended balance
   */
  async getExtendedBalance(): Promise<Record<string, KrakenExtendedBalance>> {
    return this.signedRequest<Record<string, KrakenExtendedBalance>>("/BalanceEx");
  }

  /**
   * Get trade balance
   */
  async getTradeBalance(asset?: string): Promise<KrakenTradeBalance> {
    return this.signedRequest<KrakenTradeBalance>("/TradeBalance", { asset });
  }

  // =========================================================================
  // Private Orders
  // =========================================================================

  /**
   * Get open orders
   */
  async getOpenOrders(trades?: boolean): Promise<{ open: Record<string, KrakenOrder> }> {
    return this.signedRequest<{ open: Record<string, KrakenOrder> }>("/OpenOrders", {
      trades: trades ? "true" : undefined,
    });
  }

  /**
   * Get closed orders
   */
  async getClosedOrders(params?: {
    trades?: boolean;
    start?: number;
    end?: number;
    ofs?: number;
    closetime?: string;
  }): Promise<{ closed: Record<string, KrakenOrder>; count: number }> {
    return this.signedRequest<{ closed: Record<string, KrakenOrder>; count: number }>(
      "/ClosedOrders",
      {
        trades: params?.trades ? "true" : undefined,
        start: params?.start,
        end: params?.end,
        ofs: params?.ofs,
        closetime: params?.closetime,
      }
    );
  }

  /**
   * Query orders info
   */
  async queryOrders(
    txids: string[],
    trades?: boolean
  ): Promise<Record<string, KrakenOrder>> {
    return this.signedRequest<Record<string, KrakenOrder>>("/QueryOrders", {
      txid: txids.join(","),
      trades: trades ? "true" : undefined,
    });
  }

  /**
   * Add order
   */
  async addOrder(params: {
    pair: string;
    type: "buy" | "sell";
    ordertype: string;
    price?: string;
    price2?: string;
    volume: string;
    leverage?: string;
    oflags?: string;
    timeinforce?: string;
    starttm?: string;
    expiretm?: string;
    validate?: boolean;
  }): Promise<KrakenAddOrderResponse> {
    return this.signedRequest<KrakenAddOrderResponse>("/AddOrder", {
      ...params,
      validate: params.validate ? "true" : undefined,
    });
  }

  /**
   * Cancel order
   */
  async cancelOrder(txid: string): Promise<KrakenCancelOrderResponse> {
    return this.signedRequest<KrakenCancelOrderResponse>("/CancelOrder", { txid });
  }

  /**
   * Cancel all orders
   */
  async cancelAllOrders(): Promise<KrakenCancelOrderResponse> {
    return this.signedRequest<KrakenCancelOrderResponse>("/CancelAll");
  }

  /**
   * Cancel all orders after timeout
   */
  async cancelAllOrdersAfter(timeout: number): Promise<{ currentTime: string; triggerTime: string }> {
    return this.signedRequest<{ currentTime: string; triggerTime: string }>(
      "/CancelAllOrdersAfter",
      { timeout }
    );
  }

  // =========================================================================
  // Private Trades
  // =========================================================================

  /**
   * Get trade history
   */
  async getTradesHistory(params?: {
    type?: string;
    trades?: boolean;
    start?: number;
    end?: number;
    ofs?: number;
  }): Promise<{ trades: Record<string, KrakenTrade>; count: number }> {
    return this.signedRequest<{ trades: Record<string, KrakenTrade>; count: number }>(
      "/TradesHistory",
      {
        type: params?.type,
        trades: params?.trades ? "true" : undefined,
        start: params?.start,
        end: params?.end,
        ofs: params?.ofs,
      }
    );
  }

  /**
   * Query trades info
   */
  async queryTrades(txids: string[], trades?: boolean): Promise<Record<string, KrakenTrade>> {
    return this.signedRequest<Record<string, KrakenTrade>>("/QueryTrades", {
      txid: txids.join(","),
      trades: trades ? "true" : undefined,
    });
  }

  // =========================================================================
  // Deposits & Withdrawals
  // =========================================================================

  /**
   * Get deposit status
   */
  async getDepositStatus(params?: {
    asset?: string;
    method?: string;
  }): Promise<KrakenDepositStatus[]> {
    return this.signedRequest<KrakenDepositStatus[]>("/DepositStatus", params);
  }

  /**
   * Get withdrawal status
   */
  async getWithdrawStatus(params?: {
    asset?: string;
    method?: string;
  }): Promise<KrakenWithdrawStatus[]> {
    return this.signedRequest<KrakenWithdrawStatus[]>("/WithdrawStatus", params);
  }

  /**
   * Submit a withdrawal request
   * @param asset - Kraken asset name (e.g., "XBT" for Bitcoin)
   * @param key - Pre-configured withdrawal address name in Kraken
   * @param amount - Amount to withdraw
   */
  async withdraw(asset: string, key: string, amount: string): Promise<{ refid: string }> {
    return this.signedRequest<{ refid: string }>("/Withdraw", { asset, key, amount });
  }

  /**
   * Get available withdrawal methods for an asset
   * @param asset - Kraken asset name (e.g., "XBT" for Bitcoin)
   */
  async getWithdrawMethods(asset: string): Promise<
    Array<{ method: string; limit: string | boolean; fee: string; "gen-address"?: boolean }>
  > {
    return this.signedRequest<
      Array<{ method: string; limit: string | boolean; fee: string; "gen-address"?: boolean }>
    >("/WithdrawMethods", { asset });
  }
}

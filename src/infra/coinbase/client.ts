/**
 * Coinbase Advanced Trade API Client
 * Handles authenticated and public API requests to Coinbase
 */

import { createHmac } from "crypto";
import type {
  CoinbaseAccount,
  CoinbaseAccountsResponse,
  CoinbaseProduct,
  CoinbaseProductsResponse,
  CoinbaseProductBook,
  CoinbaseCandle,
  CoinbaseCandlesResponse,
  CoinbaseOrder,
  CoinbaseOrdersResponse,
  CoinbaseCreateOrderRequest,
  CoinbaseCreateOrderResponse,
  CoinbaseCancelOrdersResponse,
  CoinbaseFill,
  CoinbaseFillsResponse,
  CoinbaseAPIError,
} from "./types.ts";
import { CoinbaseError, CoinbaseRateLimitError, CoinbaseAuthError } from "../../errors/index.ts";
import { createModuleLogger } from "../logger/index.ts";
import { withRetry, CircuitBreaker, type RetryConfig } from "../retry.ts";

const logger = createModuleLogger("coinbase");

// Default retry config for Coinbase API calls
const COINBASE_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
};

// Circuit breaker for API protection
const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
});

// Coinbase API base URL
const BASE_URL = "https://api.coinbase.com";

// Rate limit tracking
interface RateLimitState {
  requestCount: number;
  lastReset: number;
  lastThrottleWarn: number;
  throttledCount: number;
}

// Rate limit configuration (Coinbase: ~10 requests/second)
const RATE_LIMIT_CONFIG = {
  maxRequestsPerSecond: 10,
  throttleThreshold: 0.8,
  warningThreshold: 0.9,
  throttleDelayMs: 100,
  maxThrottleDelayMs: 1000,
  throttleWarnIntervalMs: 10000,
};

/**
 * Coinbase Advanced Trade API Client
 */
export class CoinbaseClient {
  private apiKey: string;
  private apiSecret: string;
  private passphrase: string;
  private rateLimitState: RateLimitState;

  constructor(apiKey: string, apiSecret: string, passphrase: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    this.rateLimitState = {
      requestCount: 0,
      lastReset: Date.now(),
      lastThrottleWarn: 0,
      throttledCount: 0,
    };
  }

  /**
   * Generate HMAC SHA256 signature for authenticated requests
   * Coinbase signature: HMAC_SHA256(timestamp + method + requestPath + body, secret)
   */
  private sign(timestamp: string, method: string, requestPath: string, body: string = ""): string {
    const message = timestamp + method + requestPath + body;
    return createHmac("sha256", this.apiSecret)
      .update(message)
      .digest("base64");
  }

  /**
   * Check and update rate limit state
   */
  private checkRateLimit(): void {
    const now = Date.now();
    const secondAgo = now - 1000;

    // Reset counter if a second has passed
    if (this.rateLimitState.lastReset < secondAgo) {
      if (this.rateLimitState.throttledCount > 0) {
        logger.info("Rate limit window reset", {
          throttledRequests: this.rateLimitState.throttledCount,
          peakRequests: this.rateLimitState.requestCount,
        });
      }
      this.rateLimitState.requestCount = 0;
      this.rateLimitState.lastReset = now;
      this.rateLimitState.throttledCount = 0;
    }

    const usagePercent = this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerSecond;

    if (usagePercent > RATE_LIMIT_CONFIG.warningThreshold) {
      const timeSinceLastWarn = now - this.rateLimitState.lastThrottleWarn;
      if (timeSinceLastWarn > RATE_LIMIT_CONFIG.throttleWarnIntervalMs) {
        logger.warn("Rate limit critical - approaching Coinbase limit", {
          requests: this.rateLimitState.requestCount,
          maxRequests: RATE_LIMIT_CONFIG.maxRequestsPerSecond,
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
    this.checkRateLimit();
    const usagePercent = this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerSecond;
    return usagePercent >= RATE_LIMIT_CONFIG.throttleThreshold;
  }

  /**
   * Calculate throttle delay
   */
  private calculateThrottleDelay(): number {
    const usagePercent = this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerSecond;

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
    currentRequests: number;
    maxRequests: number;
    usagePercent: number;
    isThrottling: boolean;
    throttledCount: number;
    timeUntilReset: number;
  } {
    this.checkRateLimit();
    const usagePercent = this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerSecond;
    return {
      currentRequests: this.rateLimitState.requestCount,
      maxRequests: RATE_LIMIT_CONFIG.maxRequestsPerSecond,
      usagePercent: Math.round(usagePercent * 100),
      isThrottling: this.shouldThrottle(),
      throttledCount: this.rateLimitState.throttledCount,
      timeUntilReset: Math.max(0, 1000 - (Date.now() - this.rateLimitState.lastReset)),
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
   * Make authenticated request to Coinbase API
   */
  private async signedRequest<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    if (!apiCircuitBreaker.canExecute()) {
      throw new CoinbaseError("API circuit breaker is open", "CIRCUIT_OPEN");
    }

    await this.applyThrottling();
    this.checkRateLimit();
    this.rateLimitState.requestCount++;

    return withRetry(async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const bodyStr = body ? JSON.stringify(body) : "";
      const signature = this.sign(timestamp, method, endpoint, bodyStr);

      const headers: Record<string, string> = {
        "CB-ACCESS-KEY": this.apiKey,
        "CB-ACCESS-SIGN": signature,
        "CB-ACCESS-TIMESTAMP": timestamp,
        "Content-Type": "application/json",
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
          method,
          headers,
          body: body ? bodyStr : undefined,
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = (await response.json()) as CoinbaseAPIError;
          logger.error("Coinbase API request failed", undefined, {
            endpoint,
            status: response.status,
            error: error.error,
            message: error.message,
          });

          if (response.status === 429) {
            apiCircuitBreaker.recordFailure();
            throw new CoinbaseRateLimitError(undefined, endpoint);
          }

          if (response.status === 401 || response.status === 403) {
            throw new CoinbaseAuthError(error.message || "Authentication failed");
          }

          apiCircuitBreaker.recordFailure();
          throw new CoinbaseError(error.message || "Unknown error", error.error, endpoint);
        }

        apiCircuitBreaker.recordSuccess();
        return response.json() as Promise<T>;
      } finally {
        clearTimeout(timeoutId);
      }
    }, COINBASE_RETRY_CONFIG);
  }

  /**
   * Make public (unauthenticated) request
   */
  private async publicRequest<T>(endpoint: string): Promise<T> {
    await this.applyThrottling();
    this.checkRateLimit();
    this.rateLimitState.requestCount++;

    return withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = (await response.json()) as CoinbaseAPIError;
          logger.error("Coinbase public API request failed", undefined, {
            endpoint,
            status: response.status,
            error: error.error,
          });

          if (response.status === 429) {
            throw new CoinbaseRateLimitError(undefined, endpoint);
          }

          throw new CoinbaseError(error.message || "Unknown error", error.error, endpoint);
        }

        return response.json() as Promise<T>;
      } finally {
        clearTimeout(timeoutId);
      }
    }, COINBASE_RETRY_CONFIG);
  }

  // =========================================================================
  // Connection
  // =========================================================================

  /**
   * Test connectivity to Coinbase
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getAccounts();
      return true;
    } catch (error) {
      logger.error("Coinbase connection test failed", error instanceof Error ? error : undefined);
      return false;
    }
  }

  // =========================================================================
  // Account Methods
  // =========================================================================

  /**
   * Get all accounts
   */
  async getAccounts(): Promise<CoinbaseAccount[]> {
    const response = await this.signedRequest<CoinbaseAccountsResponse>(
      "GET",
      "/api/v3/brokerage/accounts"
    );
    return response.accounts;
  }

  /**
   * Get specific account by UUID
   */
  async getAccount(accountId: string): Promise<CoinbaseAccount> {
    const response = await this.signedRequest<{ account: CoinbaseAccount }>(
      "GET",
      `/api/v3/brokerage/accounts/${accountId}`
    );
    return response.account;
  }

  // =========================================================================
  // Market Data Methods
  // =========================================================================

  /**
   * Get all products
   */
  async getProducts(): Promise<CoinbaseProduct[]> {
    const response = await this.publicRequest<CoinbaseProductsResponse>(
      "/api/v3/brokerage/market/products"
    );
    return response.products;
  }

  /**
   * Get specific product
   */
  async getProduct(productId: string): Promise<CoinbaseProduct> {
    const response = await this.publicRequest<{ product: CoinbaseProduct }>(
      `/api/v3/brokerage/market/products/${productId}`
    );
    // For some products, the response may just be the product directly
    return "product" in response ? response.product : (response as unknown as CoinbaseProduct);
  }

  /**
   * Get product book (order book)
   */
  async getProductBook(productId: string, limit?: number): Promise<CoinbaseProductBook> {
    const params = new URLSearchParams({ product_id: productId });
    if (limit) params.append("limit", limit.toString());
    return this.publicRequest<CoinbaseProductBook>(
      `/api/v3/brokerage/market/product_book?${params.toString()}`
    );
  }

  /**
   * Get candles/OHLCV data
   */
  async getCandles(
    productId: string,
    granularity: string,
    start?: string,
    end?: string
  ): Promise<CoinbaseCandle[]> {
    const params = new URLSearchParams({
      granularity: this.mapGranularity(granularity),
    });
    if (start) params.append("start", start);
    if (end) params.append("end", end);

    const response = await this.publicRequest<CoinbaseCandlesResponse>(
      `/api/v3/brokerage/market/products/${productId}/candles?${params.toString()}`
    );
    return response.candles;
  }

  /**
   * Map interval string to Coinbase granularity
   */
  private mapGranularity(interval: string): string {
    const map: Record<string, string> = {
      "1m": "ONE_MINUTE",
      "5m": "FIVE_MINUTE",
      "15m": "FIFTEEN_MINUTE",
      "30m": "THIRTY_MINUTE",
      "1h": "ONE_HOUR",
      "2h": "TWO_HOUR",
      "6h": "SIX_HOUR",
      "1d": "ONE_DAY",
    };
    return map[interval] || "ONE_HOUR";
  }

  /**
   * Get best bid/ask (ticker)
   */
  async getBestBidAsk(productIds: string[]): Promise<
    Array<{
      product_id: string;
      bids: Array<{ price: string; size: string }>;
      asks: Array<{ price: string; size: string }>;
    }>
  > {
    const params = new URLSearchParams();
    productIds.forEach((id) => params.append("product_ids", id));

    const response = await this.publicRequest<{
      pricebooks: Array<{
        product_id: string;
        bids: Array<{ price: string; size: string }>;
        asks: Array<{ price: string; size: string }>;
      }>;
    }>(`/api/v3/brokerage/best_bid_ask?${params.toString()}`);

    return response.pricebooks;
  }

  // =========================================================================
  // Order Methods
  // =========================================================================

  /**
   * Create order
   */
  async createOrder(order: CoinbaseCreateOrderRequest): Promise<CoinbaseCreateOrderResponse> {
    return this.signedRequest<CoinbaseCreateOrderResponse>(
      "POST",
      "/api/v3/brokerage/orders",
      order as unknown as Record<string, unknown>
    );
  }

  /**
   * Cancel orders
   */
  async cancelOrders(orderIds: string[]): Promise<CoinbaseCancelOrdersResponse> {
    return this.signedRequest<CoinbaseCancelOrdersResponse>(
      "POST",
      "/api/v3/brokerage/orders/batch_cancel",
      { order_ids: orderIds }
    );
  }

  /**
   * List orders
   */
  async listOrders(params?: {
    product_id?: string;
    order_status?: string[];
    limit?: number;
    start_date?: string;
    end_date?: string;
    order_type?: string;
    order_side?: string;
    cursor?: string;
    product_type?: string;
  }): Promise<CoinbaseOrdersResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      if (params.product_id) searchParams.append("product_id", params.product_id);
      if (params.order_status) {
        params.order_status.forEach((s) => searchParams.append("order_status", s));
      }
      if (params.limit) searchParams.append("limit", params.limit.toString());
      if (params.start_date) searchParams.append("start_date", params.start_date);
      if (params.end_date) searchParams.append("end_date", params.end_date);
      if (params.order_type) searchParams.append("order_type", params.order_type);
      if (params.order_side) searchParams.append("order_side", params.order_side);
      if (params.cursor) searchParams.append("cursor", params.cursor);
      if (params.product_type) searchParams.append("product_type", params.product_type);
    }

    const query = searchParams.toString();
    return this.signedRequest<CoinbaseOrdersResponse>(
      "GET",
      `/api/v3/brokerage/orders/historical/batch${query ? `?${query}` : ""}`
    );
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<CoinbaseOrder> {
    const response = await this.signedRequest<{ order: CoinbaseOrder }>(
      "GET",
      `/api/v3/brokerage/orders/historical/${orderId}`
    );
    return response.order;
  }

  // =========================================================================
  // Fill Methods
  // =========================================================================

  /**
   * List fills (trades)
   */
  async listFills(params?: {
    order_id?: string;
    product_id?: string;
    start_sequence_timestamp?: string;
    end_sequence_timestamp?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CoinbaseFillsResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      if (params.order_id) searchParams.append("order_id", params.order_id);
      if (params.product_id) searchParams.append("product_id", params.product_id);
      if (params.start_sequence_timestamp) {
        searchParams.append("start_sequence_timestamp", params.start_sequence_timestamp);
      }
      if (params.end_sequence_timestamp) {
        searchParams.append("end_sequence_timestamp", params.end_sequence_timestamp);
      }
      if (params.limit) searchParams.append("limit", params.limit.toString());
      if (params.cursor) searchParams.append("cursor", params.cursor);
    }

    const query = searchParams.toString();
    return this.signedRequest<CoinbaseFillsResponse>(
      "GET",
      `/api/v3/brokerage/orders/historical/fills${query ? `?${query}` : ""}`
    );
  }
}

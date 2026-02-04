/**
 * Bitfinex API v2 Client
 * Handles authenticated and public API requests to Bitfinex
 */

import { createHmac } from "crypto";
import type {
  BitfinexTicker,
  BitfinexTickerParsed,
  BitfinexCandle,
  BitfinexOrderBookEntry,
  BitfinexOrderBookParsed,
  BitfinexWallet,
  BitfinexWalletParsed,
  BitfinexOrder,
  BitfinexOrderParsed,
  BitfinexUserTrade,
  BitfinexUserTradeParsed,
  BitfinexMovement,
  BitfinexMovementParsed,
  BitfinexSymbolDetails,
  BitfinexOrderParams,
  BitfinexOrderResponse,
  BitfinexAPIError,
} from "./types.ts";
import { BitfinexError, BitfinexRateLimitError, BitfinexAuthError } from "../../errors/index.ts";
import { createModuleLogger } from "../logger/index.ts";
import { withRetry, CircuitBreaker, type RetryConfig } from "../retry.ts";

const logger = createModuleLogger("bitfinex");

// Default retry config for Bitfinex API calls
const BITFINEX_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
};

// Circuit breaker for API protection
const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
});

// Bitfinex API base URLs
const BASE_URL = "https://api.bitfinex.com";
const PUBLIC_URL = "https://api-pub.bitfinex.com";

// Rate limit tracking
interface RateLimitState {
  requestCount: number;
  lastReset: number;
  lastThrottleWarn: number;
  throttledCount: number;
}

// Rate limit configuration (Bitfinex: varies, but ~90 requests/minute for authenticated)
const RATE_LIMIT_CONFIG = {
  maxRequestsPerMinute: 90,
  throttleThreshold: 0.8,
  warningThreshold: 0.9,
  throttleDelayMs: 100,
  maxThrottleDelayMs: 2000,
  throttleWarnIntervalMs: 10000,
};

/**
 * Bitfinex API v2 Client
 */
export class BitfinexClient {
  private apiKey: string;
  private apiSecret: string;
  private rateLimitState: RateLimitState;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.rateLimitState = {
      requestCount: 0,
      lastReset: Date.now(),
      lastThrottleWarn: 0,
      throttledCount: 0,
    };
  }

  /**
   * Generate HMAC SHA384 signature for authenticated requests
   * Bitfinex signature: HMAC_SHA384("/api/v2" + path + nonce + body, secret)
   */
  private sign(path: string, nonce: string, body: string = "{}"): string {
    const signature = `/api/v2${path}${nonce}${body}`;
    return createHmac("sha384", this.apiSecret)
      .update(signature)
      .digest("hex");
  }

  /**
   * Check and update rate limit state
   */
  private checkRateLimit(): void {
    const now = Date.now();
    const minuteAgo = now - 60000;

    // Reset counter if a minute has passed
    if (this.rateLimitState.lastReset < minuteAgo) {
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

    const usagePercent = this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerMinute;

    if (usagePercent > RATE_LIMIT_CONFIG.warningThreshold) {
      const timeSinceLastWarn = now - this.rateLimitState.lastThrottleWarn;
      if (timeSinceLastWarn > RATE_LIMIT_CONFIG.throttleWarnIntervalMs) {
        logger.warn("Rate limit critical - approaching Bitfinex limit", {
          requests: this.rateLimitState.requestCount,
          maxRequests: RATE_LIMIT_CONFIG.maxRequestsPerMinute,
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
    const usagePercent = this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerMinute;
    return usagePercent >= RATE_LIMIT_CONFIG.throttleThreshold;
  }

  /**
   * Calculate throttle delay
   */
  private calculateThrottleDelay(): number {
    const usagePercent = this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerMinute;

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
    const usagePercent = this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerMinute;
    return {
      currentRequests: this.rateLimitState.requestCount,
      maxRequests: RATE_LIMIT_CONFIG.maxRequestsPerMinute,
      usagePercent: Math.round(usagePercent * 100),
      isThrottling: this.shouldThrottle(),
      throttledCount: this.rateLimitState.throttledCount,
      timeUntilReset: Math.max(0, 60000 - (Date.now() - this.rateLimitState.lastReset)),
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
   * Make authenticated request to Bitfinex API
   */
  private async signedRequest<T>(
    path: string,
    body: Record<string, unknown> = {}
  ): Promise<T> {
    if (!apiCircuitBreaker.canExecute()) {
      throw new BitfinexError("API circuit breaker is open", "CIRCUIT_OPEN");
    }

    await this.applyThrottling();
    this.checkRateLimit();
    this.rateLimitState.requestCount++;

    return withRetry(async () => {
      const nonce = Date.now().toString();
      const bodyStr = JSON.stringify(body);
      const signature = this.sign(path, nonce, bodyStr);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "bfx-nonce": nonce,
        "bfx-apikey": this.apiKey,
        "bfx-signature": signature,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(`${BASE_URL}/v2${path}`, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: controller.signal,
        });

        const data = await response.json();

        // Bitfinex returns ["error", code, "message"] for errors
        if (Array.isArray(data) && data[0] === "error") {
          const errorCode = data[1] as number;
          const errorMessage = data[2] as string;

          logger.error("Bitfinex API request failed", undefined, {
            path,
            status: response.status,
            code: errorCode,
            message: errorMessage,
          });

          if (response.status === 429 || errorCode === 10114) {
            apiCircuitBreaker.recordFailure();
            throw new BitfinexRateLimitError(undefined, path);
          }

          if (errorCode === 10100 || errorCode === 10111 || errorCode === 10112) {
            throw new BitfinexAuthError(errorMessage || "Authentication failed");
          }

          apiCircuitBreaker.recordFailure();
          throw new BitfinexError(errorMessage || "Unknown error", String(errorCode), path);
        }

        apiCircuitBreaker.recordSuccess();
        return data as T;
      } finally {
        clearTimeout(timeoutId);
      }
    }, BITFINEX_RETRY_CONFIG);
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
        const response = await fetch(`${PUBLIC_URL}/v2${endpoint}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });

        const data = await response.json();

        // Check for error response
        if (Array.isArray(data) && data[0] === "error") {
          const errorCode = data[1] as number;
          const errorMessage = data[2] as string;

          logger.error("Bitfinex public API request failed", undefined, {
            endpoint,
            status: response.status,
            code: errorCode,
            message: errorMessage,
          });

          if (response.status === 429) {
            throw new BitfinexRateLimitError(undefined, endpoint);
          }

          throw new BitfinexError(errorMessage || "Unknown error", String(errorCode), endpoint);
        }

        return data as T;
      } finally {
        clearTimeout(timeoutId);
      }
    }, BITFINEX_RETRY_CONFIG);
  }

  // =========================================================================
  // Connection
  // =========================================================================

  /**
   * Test connectivity to Bitfinex
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getWallets();
      return true;
    } catch (error) {
      logger.error("Bitfinex connection test failed", error instanceof Error ? error : undefined);
      return false;
    }
  }

  // =========================================================================
  // Market Data Methods (Public)
  // =========================================================================

  /**
   * Get ticker for a symbol
   * Symbol format: tBTCUSD (trading pair) or fUSD (funding)
   */
  async getTicker(symbol: string): Promise<BitfinexTickerParsed> {
    const data = await this.publicRequest<BitfinexTicker>(`/ticker/${symbol}`);
    return {
      symbol,
      bid: data[0],
      bidSize: data[1],
      ask: data[2],
      askSize: data[3],
      dailyChange: data[4],
      dailyChangePercent: data[5] * 100, // Convert to percentage
      lastPrice: data[6],
      volume: data[7],
      high: data[8],
      low: data[9],
    };
  }

  /**
   * Get tickers for multiple symbols
   */
  async getTickers(symbols: string[]): Promise<BitfinexTickerParsed[]> {
    const symbolsParam = symbols.join(",");
    const data = await this.publicRequest<Array<[string, ...BitfinexTicker]>>(
      `/tickers?symbols=${symbolsParam}`
    );

    return data.map((item) => ({
      symbol: item[0],
      bid: item[1],
      bidSize: item[2],
      ask: item[3],
      askSize: item[4],
      dailyChange: item[5],
      dailyChangePercent: item[6] * 100,
      lastPrice: item[7],
      volume: item[8],
      high: item[9],
      low: item[10],
    }));
  }

  /**
   * Get candles/OHLCV data
   * @param symbol Symbol in Bitfinex format (tBTCUSD)
   * @param timeframe Timeframe (1m, 5m, 15m, 30m, 1h, 3h, 6h, 12h, 1D, 1W, 14D, 1M)
   * @param limit Max number of candles (default 100)
   * @param sort Sort direction: 1 = oldest first, -1 = newest first
   */
  async getCandles(
    symbol: string,
    timeframe: string,
    limit: number = 100,
    sort: 1 | -1 = -1
  ): Promise<BitfinexCandle[]> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      sort: sort.toString(),
    });

    return this.publicRequest<BitfinexCandle[]>(
      `/candles/trade:${timeframe}:${symbol}/hist?${params.toString()}`
    );
  }

  /**
   * Get order book
   * @param symbol Symbol in Bitfinex format
   * @param precision Price level precision (P0, P1, P2, P3, P4, R0)
   * @param len Number of price levels (1, 25, 100)
   */
  async getOrderBook(
    symbol: string,
    precision: string = "P0",
    len: number = 25
  ): Promise<BitfinexOrderBookParsed> {
    const data = await this.publicRequest<BitfinexOrderBookEntry[]>(
      `/book/${symbol}/${precision}?len=${len}`
    );

    const bids: Array<{ price: number; count: number; amount: number }> = [];
    const asks: Array<{ price: number; count: number; amount: number }> = [];

    for (const entry of data) {
      const [price, count, amount] = entry;
      if (amount > 0) {
        bids.push({ price, count, amount });
      } else {
        asks.push({ price, count, amount: Math.abs(amount) });
      }
    }

    return { bids, asks };
  }

  /**
   * Get available trading pairs
   */
  async getSymbols(): Promise<string[]> {
    // Returns array of symbol strings
    return this.publicRequest<string[]>("/conf/pub:list:pair:exchange");
  }

  /**
   * Get symbol details
   */
  async getSymbolDetails(): Promise<BitfinexSymbolDetails[]> {
    // Use the v1 API for symbol details as it's more complete
    const response = await fetch(`${BASE_URL}/v1/symbols_details`);
    return response.json() as Promise<BitfinexSymbolDetails[]>;
  }

  // =========================================================================
  // Account Methods (Authenticated)
  // =========================================================================

  /**
   * Get all wallets
   */
  async getWallets(): Promise<BitfinexWalletParsed[]> {
    const data = await this.signedRequest<BitfinexWallet[]>("/auth/r/wallets");
    return data.map((wallet) => ({
      walletType: wallet[0],
      currency: wallet[1],
      balance: wallet[2],
      unsettledInterest: wallet[3] || 0,
      availableBalance: wallet[4] || wallet[2], // Use balance if available not provided
    }));
  }

  /**
   * Get exchange wallet balances only (not margin/funding)
   */
  async getExchangeWallets(): Promise<BitfinexWalletParsed[]> {
    const wallets = await this.getWallets();
    return wallets.filter((w) => w.walletType === "exchange");
  }

  // =========================================================================
  // Order Methods (Authenticated)
  // =========================================================================

  /**
   * Submit a new order
   */
  async submitOrder(params: BitfinexOrderParams): Promise<BitfinexOrderParsed> {
    const orderPayload: Record<string, unknown> = {
      type: params.type,
      symbol: params.symbol,
      amount: params.amount.toString(),
    };

    if (params.price !== undefined) {
      orderPayload.price = params.price.toString();
    }

    if (params.clientOrderId !== undefined) {
      orderPayload.cid = params.clientOrderId;
    }

    if (params.flags !== undefined) {
      orderPayload.flags = params.flags;
    }

    if (params.priceTrailing !== undefined) {
      orderPayload.price_trailing = params.priceTrailing.toString();
    }

    if (params.priceAuxLimit !== undefined) {
      orderPayload.price_aux_limit = params.priceAuxLimit.toString();
    }

    const response = await this.signedRequest<BitfinexOrderResponse>("/auth/w/order/submit", orderPayload);

    if (response[6] !== "SUCCESS" || !response[4]) {
      throw new BitfinexError(response[7] || "Order submission failed", String(response[5]));
    }

    return this.parseOrder(response[4]);
  }

  /**
   * Cancel an order by ID
   */
  async cancelOrder(orderId: number): Promise<BitfinexOrderParsed> {
    const response = await this.signedRequest<BitfinexOrderResponse>("/auth/w/order/cancel", {
      id: orderId,
    });

    if (response[6] !== "SUCCESS" || !response[4]) {
      throw new BitfinexError(response[7] || "Order cancellation failed", String(response[5]));
    }

    return this.parseOrder(response[4]);
  }

  /**
   * Cancel multiple orders
   */
  async cancelOrders(orderIds: number[]): Promise<void> {
    await this.signedRequest("/auth/w/order/cancel/multi", {
      id: orderIds,
    });
  }

  /**
   * Get active orders
   */
  async getActiveOrders(symbol?: string): Promise<BitfinexOrderParsed[]> {
    const path = symbol ? `/auth/r/orders/${symbol}` : "/auth/r/orders";
    const data = await this.signedRequest<BitfinexOrder[]>(path);
    return data.map((order) => this.parseOrder(order));
  }

  /**
   * Get order history
   */
  async getOrderHistory(symbol?: string, limit: number = 100): Promise<BitfinexOrderParsed[]> {
    const path = symbol ? `/auth/r/orders/${symbol}/hist` : "/auth/r/orders/hist";
    const data = await this.signedRequest<BitfinexOrder[]>(path, { limit });
    return data.map((order) => this.parseOrder(order));
  }

  /**
   * Parse raw order array to typed object
   */
  private parseOrder(order: BitfinexOrder): BitfinexOrderParsed {
    return {
      id: order[0],
      groupId: order[1],
      clientOrderId: order[2],
      symbol: order[3],
      createdAt: order[4],
      updatedAt: order[5],
      amount: order[6],
      amountOrig: order[7],
      type: order[8],
      status: order[13],
      price: order[16],
      priceAvg: order[17],
      priceTrailing: order[18],
      priceAuxLimit: order[19],
      hidden: order[24] === 1,
    };
  }

  // =========================================================================
  // Trade/Fill Methods (Authenticated)
  // =========================================================================

  /**
   * Get trade history
   */
  async getTradeHistory(
    symbol?: string,
    limit: number = 100
  ): Promise<BitfinexUserTradeParsed[]> {
    const path = symbol ? `/auth/r/trades/${symbol}/hist` : "/auth/r/trades/hist";
    const data = await this.signedRequest<BitfinexUserTrade[]>(path, { limit });
    return data.map((trade) => this.parseTrade(trade));
  }

  /**
   * Parse raw trade array to typed object
   */
  private parseTrade(trade: BitfinexUserTrade): BitfinexUserTradeParsed {
    return {
      id: trade[0],
      symbol: trade[1],
      timestamp: trade[2],
      orderId: trade[3],
      amount: trade[4],
      price: trade[5],
      orderType: trade[6],
      orderPrice: trade[7],
      isMaker: trade[8] === 1,
      fee: trade[9],
      feeCurrency: trade[10],
      clientOrderId: trade[11],
    };
  }

  // =========================================================================
  // Movement Methods (Deposits/Withdrawals)
  // =========================================================================

  /**
   * Get deposit/withdrawal history
   */
  async getMovements(
    currency?: string,
    limit: number = 100
  ): Promise<BitfinexMovementParsed[]> {
    const path = currency ? `/auth/r/movements/${currency}/hist` : "/auth/r/movements/hist";
    const data = await this.signedRequest<BitfinexMovement[]>(path, { limit });
    return data.map((movement) => this.parseMovement(movement));
  }

  /**
   * Parse raw movement array to typed object
   */
  private parseMovement(movement: BitfinexMovement): BitfinexMovementParsed {
    return {
      id: movement[0],
      currency: movement[1],
      currencyName: movement[2],
      startedAt: movement[5],
      updatedAt: movement[6],
      status: movement[9],
      amount: movement[12],
      fees: movement[13],
      address: movement[16],
      transactionId: movement[20],
      note: movement[21],
    };
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Convert standard symbol format to Bitfinex format
   * e.g., BTCUSD -> tBTCUSD, BTCUSDT -> tBTCUST
   */
  static toBitfinexSymbol(symbol: string): string {
    // Remove any existing prefix
    const cleanSymbol = symbol.replace(/^[tf]/, "");
    // Bitfinex uses UST for USDT
    const normalized = cleanSymbol.replace("USDT", "UST");
    return `t${normalized}`;
  }

  /**
   * Convert Bitfinex symbol format to standard format
   * e.g., tBTCUSD -> BTCUSD, tBTCUST -> BTCUSDT
   */
  static fromBitfinexSymbol(symbol: string): string {
    // Remove prefix
    const withoutPrefix = symbol.replace(/^[tf]/, "");
    // Convert UST back to USDT
    return withoutPrefix.replace("UST", "USDT");
  }

  /**
   * Map standard interval to Bitfinex timeframe
   */
  static mapTimeframe(interval: string): string {
    const map: Record<string, string> = {
      "1m": "1m",
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1h": "1h",
      "2h": "2h",
      "3h": "3h",
      "4h": "4h",
      "6h": "6h",
      "12h": "12h",
      "1d": "1D",
      "1D": "1D",
      "1w": "1W",
      "1W": "1W",
      "1M": "1M",
    };
    return map[interval] || "1h";
  }
}

/**
 * Hyperliquid API Client
 * Handles API requests to Hyperliquid DEX
 *
 * Note: Hyperliquid is a perpetuals-only exchange using wallet-based authentication
 */

import { HyperliquidSigner } from "./signer.ts";
import type {
  HyperliquidMeta,
  HyperliquidAssetCtx,
  HyperliquidUserState,
  HyperliquidOrder,
  HyperliquidOrderStatus,
  HyperliquidPlaceOrderResponse,
  HyperliquidCancelResponse,
  HyperliquidFill,
  HyperliquidL2Book,
  HyperliquidFundingHistory,
  HyperliquidOrderRequest,
  HyperliquidAPIError,
} from "./types.ts";
import {
  HyperliquidError,
  HyperliquidRateLimitError,
  WalletSigningError,
} from "../../../../../errors/index.ts";
import { createModuleLogger } from "../../../../logger/index.ts";
import { withRetry, CircuitBreaker, type RetryConfig } from "../../../../retry.ts";

const logger = createModuleLogger("hyperliquid");

// Default retry config
const HYPERLIQUID_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
};

// Circuit breaker for API protection
const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
});

// Hyperliquid API endpoints
const MAINNET_BASE_URL = "https://api.hyperliquid.xyz";
const TESTNET_BASE_URL = "https://api.hyperliquid-testnet.xyz";

// Rate limit tracking
interface RateLimitState {
  requestCount: number;
  lastReset: number;
  lastThrottleWarn: number;
  throttledCount: number;
}

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  maxRequestsPerSecond: 10,
  throttleThreshold: 0.8,
  warningThreshold: 0.9,
  throttleDelayMs: 100,
  maxThrottleDelayMs: 1000,
  throttleWarnIntervalMs: 10000,
};

/**
 * Hyperliquid API Client
 */
export class HyperliquidClient {
  private signer: HyperliquidSigner;
  private rateLimitState: RateLimitState;
  private readonly infoUrl: string;
  private readonly exchangeUrl: string;
  readonly isTestnet: boolean;

  constructor(privateKey: string, sandbox: boolean = false) {
    this.signer = new HyperliquidSigner(privateKey);
    this.isTestnet = sandbox;
    const base = sandbox ? TESTNET_BASE_URL : MAINNET_BASE_URL;
    this.infoUrl = `${base}/info`;
    this.exchangeUrl = `${base}/exchange`;
    this.rateLimitState = {
      requestCount: 0,
      lastReset: Date.now(),
      lastThrottleWarn: 0,
      throttledCount: 0,
    };
  }

  /**
   * Get the wallet address
   */
  get address(): string {
    return this.signer.address;
  }

  /**
   * Check rate limit status
   */
  private checkRateLimit(): void {
    const now = Date.now();
    const secondAgo = now - 1000;

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
        logger.warn("Rate limit critical - approaching Hyperliquid limit", {
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
   * Make info request (read-only, no signature required)
   */
  private async infoRequest<T>(body: Record<string, unknown>): Promise<T> {
    await this.applyThrottling();
    this.checkRateLimit();
    this.rateLimitState.requestCount++;

    return withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(this.infoUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const data = await response.json() as Record<string, unknown>;

        if (!response.ok || data.error) {
          const error = data as unknown as HyperliquidAPIError;
          logger.error("Hyperliquid info request failed", undefined, {
            status: response.status,
            error: error.error,
          });

          if (response.status === 429) {
            throw new HyperliquidRateLimitError(undefined, "/info");
          }

          throw new HyperliquidError(error.error || "Unknown error", error.code, "/info");
        }

        return data as T;
      } finally {
        clearTimeout(timeoutId);
      }
    }, HYPERLIQUID_RETRY_CONFIG);
  }

  /**
   * Make exchange request (requires signature)
   */
  private async exchangeRequest<T>(
    action: Record<string, unknown>,
    vaultAddress?: string
  ): Promise<T> {
    if (!apiCircuitBreaker.canExecute()) {
      throw new HyperliquidError("API circuit breaker is open", "CIRCUIT_OPEN");
    }

    await this.applyThrottling();
    this.checkRateLimit();
    this.rateLimitState.requestCount++;

    return withRetry(async () => {
      const nonce = this.signer.getNonce();
      const signature = await this.signer.signAction(action, nonce, vaultAddress);

      const body = {
        action,
        nonce,
        signature,
        vaultAddress: vaultAddress || null,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(this.exchangeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const data = await response.json() as Record<string, unknown>;

        if (!response.ok || data.status === "err") {
          const error = (data.error as string) || "Unknown error";
          logger.error("Hyperliquid exchange request failed", undefined, {
            status: response.status,
            error,
            action: action.type,
          });

          if (response.status === 429) {
            apiCircuitBreaker.recordFailure();
            throw new HyperliquidRateLimitError(undefined, "/exchange");
          }

          apiCircuitBreaker.recordFailure();
          throw new HyperliquidError(error, "EXCHANGE_ERROR", "/exchange");
        }

        apiCircuitBreaker.recordSuccess();
        return data as T;
      } finally {
        clearTimeout(timeoutId);
      }
    }, HYPERLIQUID_RETRY_CONFIG);
  }

  // =========================================================================
  // Info Endpoints (Read-only)
  // =========================================================================

  /**
   * Test connection by fetching meta
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getMeta();
      return true;
    } catch (error) {
      logger.error("Hyperliquid connection test failed", error instanceof Error ? error : undefined);
      return false;
    }
  }

  /**
   * Get exchange metadata (assets, leverage, etc.)
   */
  async getMeta(): Promise<HyperliquidMeta> {
    return this.infoRequest<HyperliquidMeta>({ type: "meta" });
  }

  /**
   * Get all asset contexts (funding, open interest, prices)
   */
  async getAllAssetCtxs(): Promise<HyperliquidAssetCtx[]> {
    const response = await this.infoRequest<[HyperliquidMeta, HyperliquidAssetCtx[]]>({
      type: "metaAndAssetCtxs",
    });
    return response[1];
  }

  /**
   * Get user state (positions, margin, etc.)
   */
  async getUserState(user?: string): Promise<HyperliquidUserState> {
    return this.infoRequest<HyperliquidUserState>({
      type: "clearinghouseState",
      user: user || this.address,
    });
  }

  /**
   * Get open orders for user
   */
  async getOpenOrders(user?: string): Promise<HyperliquidOrder[]> {
    return this.infoRequest<HyperliquidOrder[]>({
      type: "openOrders",
      user: user || this.address,
    });
  }

  /**
   * Get all orders (open and historical)
   */
  async getAllOrders(user?: string): Promise<HyperliquidOrderStatus[]> {
    return this.infoRequest<HyperliquidOrderStatus[]>({
      type: "orderStatus",
      user: user || this.address,
    });
  }

  /**
   * Get user fills/trades
   */
  async getUserFills(user?: string): Promise<HyperliquidFill[]> {
    return this.infoRequest<HyperliquidFill[]>({
      type: "userFills",
      user: user || this.address,
    });
  }

  /**
   * Get L2 order book
   */
  async getL2Book(coin: string): Promise<HyperliquidL2Book> {
    return this.infoRequest<HyperliquidL2Book>({
      type: "l2Book",
      coin,
    });
  }

  /**
   * Get user non-funding ledger updates (deposits, withdrawals, transfers, liquidations)
   */
  async getUserNonFundingLedgerUpdates(
    user?: string,
    startTime?: number,
    endTime?: number
  ): Promise<Array<{
    time: number;
    hash: string;
    delta: {
      type: string;
      usdc: string;
      token?: string;
      amount?: string;
      nonce?: number;
      fee?: string;
    };
  }>> {
    return this.infoRequest<Array<{
      time: number;
      hash: string;
      delta: {
        type: string;
        usdc: string;
        token?: string;
        amount?: string;
        nonce?: number;
        fee?: string;
      };
    }>>({
      type: "userNonFundingLedgerUpdates",
      user: user || this.address,
      startTime: startTime || 0,
      endTime: endTime || Date.now(),
    });
  }

  /**
   * Get spot clearinghouse state (non-USD token balances)
   */
  async getSpotClearinghouseState(user?: string): Promise<{
    balances: Array<{
      coin: string;
      token: number;
      hold: string;
      total: string;
      entryNtl: string;
    }>;
  }> {
    return this.infoRequest<{
      balances: Array<{
        coin: string;
        token: number;
        hold: string;
        total: string;
        entryNtl: string;
      }>;
    }>({
      type: "spotClearinghouseState",
      user: user || this.address,
    });
  }

  /**
   * Get funding history
   */
  async getFundingHistory(
    coin: string,
    startTime: number,
    endTime?: number
  ): Promise<HyperliquidFundingHistory[]> {
    return this.infoRequest<HyperliquidFundingHistory[]>({
      type: "fundingHistory",
      coin,
      startTime,
      endTime: endTime || Date.now(),
    });
  }

  /**
   * Get candles/OHLCV
   */
  async getCandles(
    coin: string,
    interval: string,
    startTime: number,
    endTime?: number
  ): Promise<Array<[number, string, string, string, string, string]>> {
    return this.infoRequest<Array<[number, string, string, string, string, string]>>({
      type: "candleSnapshot",
      req: {
        coin,
        interval,
        startTime,
        endTime: endTime || Date.now(),
      },
    });
  }

  // =========================================================================
  // Exchange Endpoints (Require Signature)
  // =========================================================================

  /**
   * Place an order
   */
  async placeOrder(
    assetIndex: number,
    isBuy: boolean,
    price: string,
    size: string,
    reduceOnly: boolean = false,
    orderType: { limit: { tif: string } } | { trigger: { triggerPx: string; isMarket: boolean; tpsl: string } } = { limit: { tif: "Gtc" } },
    cloid?: string
  ): Promise<HyperliquidPlaceOrderResponse> {
    const order: HyperliquidOrderRequest = {
      a: assetIndex,
      b: isBuy,
      p: price,
      s: size,
      r: reduceOnly,
      t: orderType as HyperliquidOrderRequest["t"],
      c: cloid,
    };

    return this.exchangeRequest<HyperliquidPlaceOrderResponse>({
      type: "order",
      orders: [order],
      grouping: "na",
    });
  }

  /**
   * Place multiple orders
   */
  async placeOrders(
    orders: HyperliquidOrderRequest[]
  ): Promise<HyperliquidPlaceOrderResponse> {
    return this.exchangeRequest<HyperliquidPlaceOrderResponse>({
      type: "order",
      orders,
      grouping: "na",
    });
  }

  /**
   * Cancel order
   */
  async cancelOrder(assetIndex: number, oid: number): Promise<HyperliquidCancelResponse> {
    return this.exchangeRequest<HyperliquidCancelResponse>({
      type: "cancel",
      cancels: [{ a: assetIndex, o: oid }],
    });
  }

  /**
   * Cancel multiple orders
   */
  async cancelOrders(
    cancels: Array<{ assetIndex: number; oid: number }>
  ): Promise<HyperliquidCancelResponse> {
    return this.exchangeRequest<HyperliquidCancelResponse>({
      type: "cancel",
      cancels: cancels.map((c) => ({ a: c.assetIndex, o: c.oid })),
    });
  }

  /**
   * Update leverage
   */
  async updateLeverage(
    assetIndex: number,
    isCross: boolean,
    leverage: number
  ): Promise<{ status: string }> {
    return this.exchangeRequest<{ status: string }>({
      type: "updateLeverage",
      asset: assetIndex,
      isCross,
      leverage,
    });
  }

  /**
   * Update isolated margin
   */
  async updateIsolatedMargin(
    assetIndex: number,
    isBuy: boolean,
    ntli: number
  ): Promise<{ status: string }> {
    return this.exchangeRequest<{ status: string }>({
      type: "updateIsolatedMargin",
      asset: assetIndex,
      isBuy,
      ntli,
    });
  }

  /**
   * Withdraw USDC via L1 bridge to Arbitrum
   * @param destination - Destination address on Arbitrum
   * @param amount - Amount of USDC to withdraw (will be converted to raw units)
   */
  async withdrawUsdc(
    destination: string,
    amount: string
  ): Promise<{ status: string; response?: { type: string } }> {
    const nonce = this.signer.getNonce();
    const action = {
      type: "withdraw3",
      hyperliquidChain: "Arbitrum",
      signatureChainId: "0xa4b1",
      destination,
      amount,
      time: nonce,
    };

    const signature = await this.signer.signL1Action(action, null, nonce);

    const body = {
      action,
      nonce,
      signature,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(this.exchangeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok || data.status === "err") {
        const error = (data.error as string) || "Withdrawal failed";
        throw new HyperliquidError(error, "WITHDRAW_ERROR", "/exchange");
      }

      return data as { status: string; response?: { type: string } };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

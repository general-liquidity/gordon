/**
 * Binance API Client
 * Handles authenticated and public API requests to Binance
 */

import { createHmac } from "crypto";
import type { Candle } from "../../types/index.ts";
import type {
  BinanceAccountInfo,
  BinanceKline,
  BinanceOrder,
  BinanceAPIError,
  BinanceTicker24hr,
  BinancePriceTicker,
  OrderParams,
} from "./types.ts";

// Binance API base URL
const BASE_URL = "https://api.binance.com";

// Rate limit tracking
interface RateLimitState {
  requestWeight: number;
  orderCount: number;
  lastReset: number;
}

// Custom error class for Binance API errors
export class BinanceError extends Error {
  public code: number;
  public isRateLimit: boolean;

  constructor(error: BinanceAPIError) {
    super(error.msg);
    this.name = "BinanceError";
    this.code = error.code;
    this.isRateLimit = error.code === -1015 || error.code === -1003;
  }
}

/**
 * Binance API Client
 */
export class BinanceClient {
  private apiKey: string;
  private apiSecret: string;
  private rateLimitState: RateLimitState;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.rateLimitState = {
      requestWeight: 0,
      orderCount: 0,
      lastReset: Date.now(),
    };
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
      this.rateLimitState.requestWeight = 0;
      this.rateLimitState.orderCount = 0;
      this.rateLimitState.lastReset = now;
    }

    // Binance limit is 1200 weight per minute, warn at 80%
    if (this.rateLimitState.requestWeight > 960) {
      console.warn("Warning: Approaching Binance rate limit");
    }
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
   */
  private async publicRequest<T>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    this.checkRateLimit();

    const queryString = this.buildQueryString(params);
    const url = `${BASE_URL}${endpoint}${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.updateRateLimitFromHeaders(response.headers);

    if (!response.ok) {
      const error = (await response.json()) as BinanceAPIError;
      throw new BinanceError(error);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Make a signed API request (authentication required)
   */
  private async signedRequest<T>(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    this.checkRateLimit();

    // Add timestamp and recvWindow
    const timestamp = Date.now();
    const allParams = {
      ...params,
      timestamp,
      recvWindow: 5000,
    };

    const queryString = this.buildQueryString(allParams);
    const signature = this.sign(queryString);
    const signedQueryString = `${queryString}&signature=${signature}`;

    const url = `${BASE_URL}${endpoint}?${signedQueryString}`;

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-MBX-APIKEY": this.apiKey,
      },
    });

    this.updateRateLimitFromHeaders(response.headers);

    if (!response.ok) {
      const error = (await response.json()) as BinanceAPIError;
      throw new BinanceError(error);
    }

    // Handle empty response (e.g., for DELETE requests)
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
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
    const tickers = await this.publicRequest<BinanceTicker24hr[]>(
      "/api/v3/ticker/24hr"
    );

    // Filter for USDT pairs and sort by quote volume (USDT volume)
    const usdtPairs = tickers
      .filter((t) => t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    return usdtPairs.slice(0, n).map((t) => t.symbol);
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
}

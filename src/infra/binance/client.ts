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
  BinanceTrade,
  BinanceDeposit,
  BinanceWithdrawal,
  BinanceEarnPosition,
  BinanceAPIRestrictions,
} from "./types.ts";
import { BinanceError, RateLimitError } from "../../errors/index.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("binance");

// Binance API base URL
const BASE_URL = "https://api.binance.com";

// Rate limit tracking
interface RateLimitState {
  requestWeight: number;
  orderCount: number;
  lastReset: number;
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
      logger.warn("Approaching Binance rate limit", { weight: this.rateLimitState.requestWeight });
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
      logger.error("Public API request failed", undefined, { endpoint, code: String(error.code), msg: error.msg });
      if (error.code === -1015 || error.code === -1003) {
        throw new RateLimitError(60);
      }
      throw new BinanceError(error.msg, error.code);
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

      // Fetch trades for each symbol in parallel
      const tradePromises = topSymbols.map((symbol) =>
        this.getTradeHistory(symbol, Math.ceil(limit / 10))
      );
      const results = await Promise.all(tradePromises);

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
}

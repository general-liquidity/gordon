/**
 * OKX Exchange Adapter
 * Implements the abstract Exchange interface for OKX (v5 API)
 *
 * OKX API v5 docs: https://www.okx.com/docs-v5/en/
 *
 * Authentication: HMAC-SHA256 signature
 *   OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP, OK-ACCESS-PASSPHRASE
 *   Signature = base64(hmac-sha256(timestamp + method + requestPath + body, secretKey))
 *
 * Symbol format: "BTC-USDT" (dash-separated instId)
 */

import { createHmac } from "crypto";
import type {
  Exchange,
  ExchangeId,
  ExchangeInfo,
  Ticker24hr,
  OrderBook,
  BookTicker,
  SpreadInfo,
  AvgPrice,
  AccountInfo,
  AccountDetails,
  Balance,
  OrderParams,
  Order,
  Trade,
  Deposit,
  Withdrawal,
  RateLimitStatus,
  SymbolInfo,
  OrderType,
  OrderStatus,
  OrderSide,
  WithdrawalResult,
  WithdrawalInfo,
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";

// ============================================================================
// Constants
// ============================================================================

const OKX_BASE_URL = "https://www.okx.com";
const OKX_DEMO_BASE_URL = "https://www.okx.com"; // Demo uses same URL, different header

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "6h": "6Hutc",
  "12h": "12Hutc",
  "1d": "1Dutc",
  "1w": "1Wutc",
  "1M": "1Mutc",
};

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

// ============================================================================
// Rate Limiter
// ============================================================================

class OkxRateLimiter {
  private requestCount = 0;
  private windowStart = Date.now();
  private readonly maxRequests = 20; // OKX allows 20 req/2s per endpoint
  private readonly windowMs = 2000;
  private throttledCount = 0;

  async throttle(): Promise<void> {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    if (this.requestCount >= this.maxRequests) {
      this.throttledCount++;
      const waitMs = this.windowMs - (now - this.windowStart);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.requestCount = 0;
      this.windowStart = Date.now();
    }

    this.requestCount++;
  }

  shouldThrottle(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) return false;
    return this.requestCount >= this.maxRequests;
  }

  getStatus(): RateLimitStatus {
    const now = Date.now();
    const elapsed = now - this.windowStart;
    return {
      currentWeight: this.requestCount,
      maxWeight: this.maxRequests,
      usagePercent: (this.requestCount / this.maxRequests) * 100,
      isThrottling: this.shouldThrottle(),
      throttledCount: this.throttledCount,
      timeUntilReset: Math.max(0, this.windowMs - elapsed),
    };
  }
}

// ============================================================================
// Circuit Breaker
// ============================================================================

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

class OkxCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;
  private readonly maxFailures = 5;
  private readonly resetTimeoutMs = 30_000;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
      } else {
        throw new Error("[OKX] Circuit breaker is OPEN — too many consecutive failures");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "CLOSED";
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.maxFailures) {
      this.state = "OPEN";
    }
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
  }
}

// ============================================================================
// OKX Adapter
// ============================================================================

/**
 * OkxAdapter - Implements the Exchange interface for OKX v5 API
 *
 * Makes direct HTTP calls to OKX REST endpoints with HMAC-SHA256 auth.
 * Includes rate limiting, circuit breaker, and full symbol normalization.
 */
export class OkxAdapter implements Exchange {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly passphrase: string;
  private readonly baseUrl: string;
  private readonly isDemo: boolean;

  private readonly rateLimiter = new OkxRateLimiter();
  private readonly circuitBreaker = new OkxCircuitBreaker();

  readonly exchangeId: ExchangeId = "okx";
  readonly displayName = "OKX";

  constructor(apiKey: string, apiSecret: string, passphrase: string, demo = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    this.isDemo = demo;
    this.baseUrl = demo ? OKX_DEMO_BASE_URL : OKX_BASE_URL;
  }

  // -------------------------------------------------------------------------
  // Symbol Conversion Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert standard symbol (BTCUSDT, BTC/USDT) to OKX instId (BTC-USDT)
   */
  private toOkxSymbol(symbol: string): string {
    // Already in OKX format
    if (symbol.includes("-")) return symbol;

    // Slash-separated: BTC/USDT → BTC-USDT
    if (symbol.includes("/")) return symbol.replace("/", "-");

    // Concatenated: BTCUSDT → BTC-USDT
    const quotes = ["USDT", "USDC", "USD", "EUR", "BTC", "ETH", "DAI"];
    for (const quote of quotes) {
      if (symbol.endsWith(quote)) {
        const base = symbol.slice(0, -quote.length);
        if (base.length > 0) return `${base}-${quote}`;
      }
    }

    return symbol;
  }

  /**
   * Convert OKX instId (BTC-USDT) to standard concatenated format (BTCUSDT)
   */
  private fromOkxSymbol(instId: string): string {
    return instId.replace(/-/g, "");
  }

  // -------------------------------------------------------------------------
  // HTTP Helpers
  // -------------------------------------------------------------------------

  /**
   * Generate OKX API signature
   */
  private sign(timestamp: string, method: string, requestPath: string, body: string): string {
    const prehash = timestamp + method.toUpperCase() + requestPath + body;
    return createHmac("sha256", this.apiSecret).update(prehash).digest("base64");
  }

  /**
   * Build auth headers for authenticated requests
   */
  private getAuthHeaders(method: string, requestPath: string, body = ""): Record<string, string> {
    const timestamp = new Date().toISOString();
    const sign = this.sign(timestamp, method, requestPath, body);

    const headers: Record<string, string> = {
      "OK-ACCESS-KEY": this.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": this.passphrase,
      "Content-Type": "application/json",
    };

    if (this.isDemo) {
      headers["x-simulated-trading"] = "1";
    }

    return headers;
  }

  /**
   * Make a public (unauthenticated) GET request
   */
  private async publicGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    await this.rateLimiter.throttle();

    return this.circuitBreaker.execute(async () => {
      const url = new URL(path, this.baseUrl);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== "") url.searchParams.set(k, v);
        }
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.isDemo) headers["x-simulated-trading"] = "1";

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        throw new Error(`[OKX] HTTP ${res.status}: ${res.statusText} — ${await res.text()}`);
      }

      const json = await res.json() as { code: string; msg: string; data: T };
      if (json.code !== "0") {
        throw new Error(`[OKX] API error ${json.code}: ${json.msg}`);
      }

      return json.data;
    });
  }

  /**
   * Make an authenticated GET request
   */
  private async authGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    await this.rateLimiter.throttle();

    return this.circuitBreaker.execute(async () => {
      const url = new URL(path, this.baseUrl);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== "") url.searchParams.set(k, v);
        }
      }

      // OKX signature uses the path + query string (no host)
      const requestPath = url.pathname + url.search;
      const headers = this.getAuthHeaders("GET", requestPath);

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        throw new Error(`[OKX] HTTP ${res.status}: ${res.statusText} — ${await res.text()}`);
      }

      const json = await res.json() as { code: string; msg: string; data: T };
      if (json.code !== "0") {
        throw new Error(`[OKX] API error ${json.code}: ${json.msg}`);
      }

      return json.data;
    });
  }

  /**
   * Make an authenticated POST request
   */
  private async authPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    await this.rateLimiter.throttle();

    return this.circuitBreaker.execute(async () => {
      const bodyStr = JSON.stringify(body);
      const headers = this.getAuthHeaders("POST", path, bodyStr);

      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: bodyStr,
      });

      if (!res.ok) {
        throw new Error(`[OKX] HTTP ${res.status}: ${res.statusText} — ${await res.text()}`);
      }

      const json = await res.json() as { code: string; msg: string; data: T };
      if (json.code !== "0") {
        throw new Error(`[OKX] API error ${json.code}: ${json.msg}`);
      }

      return json.data;
    });
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    try {
      await this.publicGet("/api/v5/public/time");
      return true;
    } catch {
      return false;
    }
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const [timeData, instruments] = await Promise.all([
      this.publicGet<Array<{ ts: string }>>("/api/v5/public/time"),
      this.publicGet<Array<{
        instId: string;
        instType: string;
        baseCcy: string;
        quoteCcy: string;
        state: string;
        lotSz: string;
        minSz: string;
        maxLmtSz: string;
        tickSz: string;
      }>>("/api/v5/public/instruments", { instType: "SPOT" }),
    ]);

    const serverTime = timeData[0] ? parseInt(timeData[0].ts) : Date.now();

    return {
      timezone: "UTC",
      serverTime,
      symbols: instruments.map(
        (inst): SymbolInfo => ({
          symbol: this.fromOkxSymbol(inst.instId),
          status: inst.state === "live" ? "TRADING" : inst.state.toUpperCase(),
          baseAsset: inst.baseCcy,
          quoteAsset: inst.quoteCcy,
          baseAssetPrecision: this.getPrecision(inst.lotSz),
          quoteAssetPrecision: this.getPrecision(inst.tickSz),
          orderTypes: ["MARKET", "LIMIT", "STOP_LOSS", "STOP_LOSS_LIMIT"] as OrderType[],
          isSpotTradingAllowed: inst.state === "live",
          filters: [
            {
              filterType: "LOT_SIZE",
              minQty: inst.minSz,
              maxQty: inst.maxLmtSz,
              stepSize: inst.lotSz,
            },
            {
              filterType: "PRICE_FILTER",
              tickSize: inst.tickSz,
            },
          ],
        })
      ),
    };
  }

  private getPrecision(sizeStr: string): number {
    if (!sizeStr || !sizeStr.includes(".")) return 0;
    return sizeStr.split(".")[1].length;
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    const instId = this.toOkxSymbol(symbol);
    const data = await this.publicGet<Array<{ last: string }>>("/api/v5/market/ticker", {
      instId,
    });

    if (!data[0]) throw new Error(`[OKX] No ticker data for ${symbol}`);
    return parseFloat(data[0].last);
  }

  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    const instId = this.toOkxSymbol(symbol);
    const bar = INTERVAL_MAP[interval] || interval;
    const candleLimit = Math.min(limit || 100, 300); // OKX max is 300

    const data = await this.publicGet<string[][]>("/api/v5/market/candles", {
      instId,
      bar,
      limit: candleLimit.toString(),
    });

    // OKX returns: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    // Returned in reverse chronological order (newest first), so reverse
    return data
      .reverse()
      .map(
        (c): Candle => ({
          openTime: parseInt(c[0]),
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5]),
          closeTime: parseInt(c[0]) + (INTERVAL_MS[interval] || 3_600_000),
        })
      );
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    const data = await this.publicGet<Array<{
      instId: string;
      last: string;
      open24h: string;
      high24h: string;
      low24h: string;
      vol24h: string;
      volCcy24h: string;
      ts: string;
    }>>("/api/v5/market/tickers", { instType: "SPOT" });

    return data.map((t): Ticker24hr => {
      const lastPrice = parseFloat(t.last);
      const openPrice = parseFloat(t.open24h);
      const priceChange = lastPrice - openPrice;
      const priceChangePercent = openPrice > 0 ? (priceChange / openPrice) * 100 : 0;

      return {
        symbol: this.fromOkxSymbol(t.instId),
        priceChange,
        priceChangePercent,
        lastPrice,
        highPrice: parseFloat(t.high24h),
        lowPrice: parseFloat(t.low24h),
        volume: parseFloat(t.vol24h),
        quoteVolume: parseFloat(t.volCcy24h),
        openTime: parseInt(t.ts) - 86_400_000,
        closeTime: parseInt(t.ts),
      };
    });
  }

  async getTopSymbols(n: number): Promise<string[]> {
    const tickers = await this.get24hrTickers();
    return tickers
      .filter((t) => t.symbol.endsWith("USDT") || t.symbol.endsWith("USD"))
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, n)
      .map((t) => t.symbol);
  }

  async getOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    const instId = this.toOkxSymbol(symbol);
    const sz = Math.min(limit || 25, 400).toString(); // OKX max depth is 400

    const data = await this.publicGet<Array<{
      asks: string[][];
      bids: string[][];
      ts: string;
    }>>("/api/v5/market/books", { instId, sz });

    if (!data[0]) throw new Error(`[OKX] No order book data for ${symbol}`);

    const book = data[0];
    return {
      lastUpdateId: parseInt(book.ts),
      // OKX format: [price, size, liquidatedOrders, numberOfOrders]
      bids: book.bids.map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty),
      })),
      asks: book.asks.map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty),
      })),
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const instId = this.toOkxSymbol(symbol);
    const data = await this.publicGet<Array<{
      instId: string;
      bidPx: string;
      bidSz: string;
      askPx: string;
      askSz: string;
    }>>("/api/v5/market/ticker", { instId });

    if (!data[0]) throw new Error(`[OKX] No ticker data for ${symbol}`);

    const t = data[0];
    return {
      symbol,
      bidPrice: parseFloat(t.bidPx),
      bidQty: parseFloat(t.bidSz),
      askPrice: parseFloat(t.askPx),
      askQty: parseFloat(t.askSz),
    };
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    const ticker = await this.getBookTicker(symbol);
    const spread = ticker.askPrice - ticker.bidPrice;
    const midPrice = (ticker.askPrice + ticker.bidPrice) / 2;
    return {
      spread,
      spreadPercent: midPrice > 0 ? (spread / midPrice) * 100 : 0,
      bidPrice: ticker.bidPrice,
      askPrice: ticker.askPrice,
    };
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    // OKX doesn't have a dedicated average price endpoint.
    // Use the ticker's 24h VWAP approximation: volCcy / vol
    const instId = this.toOkxSymbol(symbol);
    const data = await this.publicGet<Array<{
      vol24h: string;
      volCcy24h: string;
    }>>("/api/v5/market/ticker", { instId });

    if (!data[0]) throw new Error(`[OKX] No ticker data for ${symbol}`);

    const vol = parseFloat(data[0].vol24h);
    const volCcy = parseFloat(data[0].volCcy24h);
    const avgPrice = vol > 0 ? volCcy / vol : 0;

    return {
      mins: 1440, // 24h approximation
      price: avgPrice,
    };
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const data = await this.authGet<Array<{
      totalEq: string;
      uTime: string;
      details: Array<{
        ccy: string;
        availBal: string;
        frozenBal: string;
        cashBal: string;
        eq: string;
      }>;
    }>>("/api/v5/account/balance");

    if (!data[0]) throw new Error("[OKX] No account data returned");

    const acct = data[0];
    return {
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      accountType: "SPOT",
      updateTime: parseInt(acct.uTime),
      balances: acct.details.map(
        (d): Balance => {
          const free = parseFloat(d.availBal) || 0;
          const locked = parseFloat(d.frozenBal) || 0;
          return {
            asset: d.ccy,
            free,
            locked,
            total: free + locked,
          };
        }
      ),
    };
  }

  async getBalance(asset: string): Promise<number> {
    const data = await this.authGet<Array<{
      details: Array<{ ccy: string; cashBal: string; availBal: string; frozenBal: string }>;
    }>>("/api/v5/account/balance", { ccy: asset.toUpperCase() });

    if (!data[0]) return 0;

    const detail = data[0].details.find((d) => d.ccy === asset.toUpperCase());
    if (!detail) return 0;

    return parseFloat(detail.cashBal) || 0;
  }

  async getAllBalances(): Promise<Balance[]> {
    const info = await this.getAccountInfo();
    return info.balances.filter((b) => b.total > 0);
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    const accountInfo = await this.getAccountInfo();
    const nonZeroBalances = accountInfo.balances.filter((b) => b.total > 0);

    // OKX provides totalEq in the balance response (total equity in USD)
    const data = await this.authGet<Array<{ totalEq: string }>>("/api/v5/account/balance");
    const totalUsdtValue = data[0] ? parseFloat(data[0].totalEq) : 0;

    return {
      accountInfo,
      totalUsdtValue,
      nonZeroBalances,
    };
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  async placeOrder(params: OrderParams): Promise<Order> {
    const instId = this.toOkxSymbol(params.symbol);
    const okxSide = params.side.toLowerCase(); // "buy" | "sell"
    const okxOrdType = this.mapOrderTypeToOkx(params.type);

    const body: Record<string, unknown> = {
      instId,
      tdMode: "cash", // Spot trading
      side: okxSide,
      ordType: okxOrdType,
    };

    if (params.quantity) body.sz = params.quantity.toString();
    if (params.price) body.px = params.price.toString();
    if (params.newClientOrderId) body.clOrdId = params.newClientOrderId;
    if (params.stopPrice) body.slTriggerPx = params.stopPrice.toString();

    // For market buy orders with quoteOrderQty, use tgtCcy = "quote_ccy"
    if (params.type === "MARKET" && params.quoteOrderQty) {
      body.sz = params.quoteOrderQty.toString();
      body.tgtCcy = "quote_ccy";
    }

    const data = await this.authPost<Array<{
      ordId: string;
      clOrdId: string;
      sCode: string;
      sMsg: string;
    }>>("/api/v5/trade/order", body);

    if (!data[0] || data[0].sCode !== "0") {
      const msg = data[0]?.sMsg || "Unknown order error";
      throw new Error(`[OKX] Order failed: ${msg}`);
    }

    // Fetch the full order details
    const orderId = data[0].ordId;
    return this.getOrderStatus(params.symbol, orderId);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const instId = this.toOkxSymbol(symbol);

    const data = await this.authPost<Array<{
      ordId: string;
      sCode: string;
      sMsg: string;
    }>>("/api/v5/trade/cancel-order", { instId, ordId: orderId });

    if (!data[0] || data[0].sCode !== "0") {
      const msg = data[0]?.sMsg || "Unknown cancel error";
      throw new Error(`[OKX] Cancel failed: ${msg}`);
    }
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    const openOrders = await this.getOpenOrders(symbol);

    // OKX supports batch cancel (up to 20 orders)
    const instId = this.toOkxSymbol(symbol);
    const batches: Array<Array<{ instId: string; ordId: string }>> = [];

    for (let i = 0; i < openOrders.length; i += 20) {
      batches.push(
        openOrders.slice(i, i + 20).map((o) => ({
          instId,
          ordId: o.orderId,
        }))
      );
    }

    for (const batch of batches) {
      await this.authPost("/api/v5/trade/cancel-batch-orders", batch as unknown as Record<string, unknown>);
    }

    return openOrders;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const params: Record<string, string> = { instType: "SPOT" };
    if (symbol) params.instId = this.toOkxSymbol(symbol);

    const data = await this.authGet<Array<Record<string, string>>>(
      "/api/v5/trade/orders-pending",
      params,
    );

    return data.map((o) => this.normalizeOrder(o));
  }

  async getOrderStatus(symbol: string, orderId: number | string): Promise<Order> {
    const instId = this.toOkxSymbol(symbol);

    const data = await this.authGet<Array<Record<string, string>>>(
      "/api/v5/trade/order",
      { instId, ordId: orderId.toString() },
    );

    if (!data[0]) throw new Error(`[OKX] Order ${orderId} not found`);
    return this.normalizeOrder(data[0]);
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    // OKX does not have a test/validate order endpoint.
    // Perform basic client-side validation instead.
    try {
      if (!params.symbol) return false;
      if (!params.side) return false;
      if (!params.type) return false;
      if (params.type === "LIMIT" && !params.price) return false;
      if (!params.quantity && !params.quoteOrderQty) return false;

      // Verify the instrument exists
      const instId = this.toOkxSymbol(params.symbol);
      await this.publicGet("/api/v5/market/ticker", { instId });
      return true;
    } catch {
      return false;
    }
  }

  private mapOrderTypeToOkx(type: OrderType): string {
    const map: Record<OrderType, string> = {
      MARKET: "market",
      LIMIT: "limit",
      STOP_LOSS: "trigger",
      STOP_LOSS_LIMIT: "trigger",
      TAKE_PROFIT: "trigger",
      TAKE_PROFIT_LIMIT: "trigger",
      LIMIT_MAKER: "post_only",
    };
    return map[type] || "market";
  }

  private reverseMapOrderType(ordType: string): OrderType {
    const map: Record<string, OrderType> = {
      market: "MARKET",
      limit: "LIMIT",
      trigger: "STOP_LOSS",
      post_only: "LIMIT_MAKER",
      ioc: "MARKET",
      fok: "LIMIT",
      optimal_limit_ioc: "MARKET",
    };
    return map[ordType] || "MARKET";
  }

  private mapOrderStatus(state: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      live: "NEW",
      partially_filled: "PARTIALLY_FILLED",
      filled: "FILLED",
      canceled: "CANCELED",
      mmp_canceled: "CANCELED",
    };
    return map[state] || "NEW";
  }

  private normalizeOrder(o: Record<string, string>): Order {
    return {
      orderId: o.ordId,
      clientOrderId: o.clOrdId || undefined,
      symbol: this.fromOkxSymbol(o.instId),
      side: (o.side?.toUpperCase() || "BUY") as OrderSide,
      type: this.reverseMapOrderType(o.ordType),
      status: this.mapOrderStatus(o.state),
      price: parseFloat(o.px || o.avgPx || "0"),
      quantity: parseFloat(o.sz || "0"),
      executedQty: parseFloat(o.accFillSz || o.fillSz || "0"),
      cummulativeQuoteQty: parseFloat(o.fillNotionalUsd || "0"),
      timeInForce: o.ordType === "post_only" ? "GTC" : undefined,
      time: parseInt(o.cTime) || undefined,
      updateTime: parseInt(o.uTime) || undefined,
      isWorking: o.state === "live" || o.state === "partially_filled",
    };
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit?: number): Promise<Trade[]> {
    const instId = this.toOkxSymbol(symbol);
    const tradeLimit = Math.min(limit || 50, 100).toString();

    const data = await this.authGet<Array<{
      tradeId: string;
      ordId: string;
      instId: string;
      side: string;
      fillPx: string;
      fillSz: string;
      fee: string;
      feeCcy: string;
      ts: string;
      execType: string;
    }>>("/api/v5/trade/fills", { instId, limit: tradeLimit });

    return data.map(
      (t): Trade => ({
        id: t.tradeId,
        orderId: t.ordId,
        symbol: this.fromOkxSymbol(t.instId),
        side: t.side.toUpperCase() as OrderSide,
        price: parseFloat(t.fillPx),
        quantity: parseFloat(t.fillSz),
        commission: Math.abs(parseFloat(t.fee)),
        commissionAsset: t.feeCcy,
        time: parseInt(t.ts),
        isMaker: t.execType === "M",
      })
    );
  }

  async getOrderHistory(symbol: string, limit?: number): Promise<Order[]> {
    const instId = this.toOkxSymbol(symbol);
    const orderLimit = Math.min(limit || 50, 100).toString();

    const data = await this.authGet<Array<Record<string, string>>>(
      "/api/v5/trade/orders-history",
      { instId, instType: "SPOT", limit: orderLimit },
    );

    return data.map((o) => this.normalizeOrder(o));
  }

  async getDepositHistory(limit?: number): Promise<Deposit[]> {
    const depositLimit = Math.min(limit || 50, 100).toString();

    const data = await this.authGet<Array<{
      depId: string;
      amt: string;
      ccy: string;
      chain: string;
      state: string;
      to: string;
      txId: string;
      ts: string;
      actualDepBlkConfirm: string;
    }>>("/api/v5/asset/deposit-history", { limit: depositLimit });

    return data.map(
      (d): Deposit => ({
        id: d.depId,
        amount: parseFloat(d.amt),
        coin: d.ccy,
        network: d.chain || "unknown",
        status: this.mapDepositStatus(d.state),
        address: d.to,
        txId: d.txId || undefined,
        insertTime: parseInt(d.ts),
        confirmTimes: d.actualDepBlkConfirm || undefined,
      })
    );
  }

  private mapDepositStatus(state: string): number {
    // OKX deposit states: 0-waiting, 1-deposited (not credited), 2-credited
    const s = parseInt(state);
    if (s === 2) return 1; // completed
    if (s === 0 || s === 1) return 0; // pending
    return 0;
  }

  async getWithdrawalHistory(limit?: number): Promise<Withdrawal[]> {
    const wdLimit = Math.min(limit || 50, 100).toString();

    const data = await this.authGet<Array<{
      wdId: string;
      amt: string;
      ccy: string;
      chain: string;
      state: string;
      to: string;
      txId: string;
      ts: string;
      fee: string;
    }>>("/api/v5/asset/withdrawal-history", { limit: wdLimit });

    return data.map(
      (w): Withdrawal => ({
        id: w.wdId,
        amount: parseFloat(w.amt),
        coin: w.ccy,
        network: w.chain || "unknown",
        status: this.mapWithdrawalStatus(w.state),
        address: w.to,
        txId: w.txId || undefined,
        applyTime: parseInt(w.ts),
        transactionFee: w.fee ? parseFloat(w.fee) : undefined,
      })
    );
  }

  private mapWithdrawalStatus(state: string): number {
    // OKX: -3 canceling, -2 canceled, -1 failed, 0 pending, 1..3 sending, 4..5 sent, 6..7 confirmed
    const s = parseInt(state);
    if (s >= 4) return 6; // completed
    if (s === -2 || s === -3) return 5; // canceled
    if (s === -1) return 5; // failed
    return 4; // pending
  }

  // -------------------------------------------------------------------------
  // Withdrawals (ExchangeExtended)
  // -------------------------------------------------------------------------

  async withdraw(
    coin: string,
    network: string,
    address: string,
    amount: number,
    tag?: string,
  ): Promise<WithdrawalResult> {
    const body: Record<string, unknown> = {
      ccy: coin.toUpperCase(),
      amt: amount.toString(),
      dest: "4", // 4 = on-chain withdrawal
      toAddr: address,
      chain: network,
      fee: "0", // Will be auto-calculated by OKX
    };

    if (tag) body.tag = tag;

    const data = await this.authPost<Array<{
      wdId: string;
      ccy: string;
      amt: string;
      chain: string;
    }>>("/api/v5/asset/withdrawal", body);

    if (!data[0]) throw new Error("[OKX] Withdrawal request failed");

    return {
      id: data[0].wdId,
      coin: coin.toUpperCase(),
      amount,
      network,
      address,
      fee: 0, // OKX returns fee in withdrawal history, not on submit
      status: "pending",
    };
  }

  async getWithdrawalInfo(coin: string, _network?: string): Promise<WithdrawalInfo> {
    const data = await this.publicGet<Array<{
      ccy: string;
      chain: string;
      canWd: boolean;
      minWd: string;
      maxWd: string;
      wdTickSz: string;
      minFee: string;
      maxFee: string;
    }>>("/api/v5/asset/currencies", { ccy: coin.toUpperCase() });

    return {
      coin: coin.toUpperCase(),
      networks: data.map((c) => ({
        network: c.chain,
        name: c.chain,
        withdrawEnabled: c.canWd,
        withdrawFee: parseFloat(c.minFee) || 0,
        withdrawMin: parseFloat(c.minWd) || 0,
        withdrawMax: parseFloat(c.maxWd) || 0,
        estimatedArrivalMins: 30, // OKX doesn't provide ETA
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Rate Limiting & Status
  // -------------------------------------------------------------------------

  shouldThrottle(): boolean {
    return this.rateLimiter.shouldThrottle();
  }

  getRateLimitStatus(): RateLimitStatus {
    return this.rateLimiter.getStatus();
  }

  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }

  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }
}

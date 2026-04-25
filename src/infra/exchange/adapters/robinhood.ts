/**
 * Robinhood Crypto Exchange Adapter
 * Implements the Exchange interface using Robinhood Crypto Trading API endpoints.
 */

import { createPrivateKey, sign as cryptoSign, randomUUID, type KeyObject } from "node:crypto";
import { registerExchangeInfoSymbols } from "./_symbolRegistration.ts";
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
  OrderStatus,
  OrderType,
  TimeInForce,
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";

const DEFAULT_BASE_URL = "https://trading.robinhood.com";
const POPULAR_SYMBOLS = [
  "BTCUSD",
  "ETHUSD",
  "SOLUSD",
  "DOGEUSD",
  "LTCUSD",
  "XRPUSD",
  "AVAXUSD",
  "LINKUSD",
];

interface IntervalMapping {
  interval: string;
  span: string;
  intervalMs: number;
}

const INTERVAL_MAP: Record<string, IntervalMapping> = {
  "1m": { interval: "15second", span: "hour", intervalMs: 60_000 },
  "5m": { interval: "5minute", span: "day", intervalMs: 300_000 },
  "15m": { interval: "10minute", span: "week", intervalMs: 900_000 },
  "30m": { interval: "30minute", span: "week", intervalMs: 1_800_000 },
  "1h": { interval: "hour", span: "month", intervalMs: 3_600_000 },
  "4h": { interval: "hour", span: "3month", intervalMs: 14_400_000 },
  "1d": { interval: "day", span: "year", intervalMs: 86_400_000 },
  "1w": { interval: "week", span: "5year", intervalMs: 604_800_000 },
};

/**
 * Ordered list of intervals from smallest to largest for fallback resolution.
 */
const INTERVAL_KEYS_ORDERED = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

/**
 * Map an interval string to its approximate milliseconds for comparison.
 */
function intervalToMs(interval: string): number {
  const units: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const match = interval.match(/^(\d+)([mhdw])$/);
  if (!match) return 3_600_000; // default to 1h
  return parseInt(match[1]!, 10) * (units[match[2]!] ?? 3_600_000);
}

function parseNumber(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.amount !== undefined) return parseNumber(obj.amount);
    if (obj.value !== undefined) return parseNumber(obj.value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOrderStatus(value: unknown): OrderStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "new":
    case "queued":
    case "confirmed":
    case "open":
      return "NEW";
    case "partially_filled":
      return "PARTIALLY_FILLED";
    case "filled":
      return "FILLED";
    case "canceled":
    case "cancelled":
      return "CANCELED";
    case "pending_cancel":
      return "PENDING_CANCEL";
    case "rejected":
      return "REJECTED";
    case "expired":
      return "EXPIRED";
    default:
      return "NEW";
  }
}

function normalizeOrderType(value: unknown): OrderType {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "market":
      return "MARKET";
    case "limit":
      return "LIMIT";
    case "stop_loss":
      return "STOP_LOSS";
    case "stop_loss_limit":
      return "STOP_LOSS_LIMIT";
    case "take_profit":
      return "TAKE_PROFIT";
    case "take_profit_limit":
      return "TAKE_PROFIT_LIMIT";
    default:
      return "MARKET";
  }
}

function normalizeTimeInForce(value: unknown): TimeInForce | undefined {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "IOC" || normalized === "FOK" || normalized === "GTC") {
    return normalized;
  }
  return undefined;
}

function normalizeOrderSymbol(value: unknown): string {
  return String(value ?? "").replace("-", "").toUpperCase();
}

function hasResultsArray<T>(payload: unknown): payload is { results: T[]; next?: string | null } {
  return !!payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown[] }).results);
}

/**
 * Robinhood adapter implementation.
 */
export class RobinhoodAdapter implements Exchange {
  readonly exchangeId: ExchangeId = "robinhood";
  readonly displayName = "Robinhood Crypto";

  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly privateKey: KeyObject;

  private readonly rateLimitStatus: RateLimitStatus = {
    currentWeight: 0,
    maxWeight: 100,
    usagePercent: 0,
    isThrottling: false,
    throttledCount: 0,
    timeUntilReset: 0,
  };

  private circuitBreakerState: "CLOSED" | "OPEN" = "CLOSED";
  private consecutiveFailures = 0;

  constructor(apiKey: string, apiSecret: string, baseUrl = DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl;
    this.privateKey = this.createSigningKey(apiSecret);
  }

  private createSigningKey(privateKeyInput: string): KeyObject {
    const sanitized = privateKeyInput.trim().replace(/\\n/g, "\n");

    if (sanitized.includes("BEGIN PRIVATE KEY")) {
      return createPrivateKey(sanitized);
    }

    const decoded = Buffer.from(sanitized, "base64");
    if (decoded.length === 0) {
      throw new Error("Invalid ROBINHOOD_API_SECRET format");
    }

    // Try PKCS8 DER first.
    try {
      return createPrivateKey({ key: decoded, format: "der", type: "pkcs8" });
    } catch {
      // Fallback: treat as 32-byte Ed25519 seed and wrap in PKCS8 container.
      if (decoded.length !== 32) {
        throw new Error("ROBINHOOD_API_SECRET must be PEM, PKCS8 base64, or 32-byte base64 seed");
      }
      const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
      const pkcs8 = Buffer.concat([pkcs8Prefix, decoded]);
      return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    }
  }

  private toRobinhoodSymbol(symbol: string): string {
    const normalized = symbol.replace("/", "").replace("-", "").toUpperCase();
    if (symbol.includes("-")) return symbol.toUpperCase();
    if (normalized.endsWith("USDT")) return `${normalized.slice(0, -4)}-USD`;
    if (normalized.endsWith("USDC")) return `${normalized.slice(0, -4)}-USD`;
    if (normalized.endsWith("USD")) return `${normalized.slice(0, -3)}-USD`;
    if (normalized.endsWith("BTC")) return `${normalized.slice(0, -3)}-BTC`;
    if (normalized.endsWith("ETH")) return `${normalized.slice(0, -3)}-ETH`;
    return normalized;
  }

  private mapTif(value: TimeInForce | undefined): string {
    if (!value) return "gtc";
    return value.toLowerCase();
  }

  private signRequest(path: string, method: string, body: string, timestamp: string): string {
    const message = `${this.apiKey}${timestamp}${path}${method}${body}`;
    return cryptoSign(null, Buffer.from(message, "utf8"), this.privateKey).toString("base64");
  }

  private updateRateStatus(response: Response): void {
    const limit = Number(response.headers.get("x-ratelimit-limit") || response.headers.get("x-rate-limit-limit"));
    const remaining = Number(response.headers.get("x-ratelimit-remaining") || response.headers.get("x-rate-limit-remaining"));
    const reset = Number(response.headers.get("x-ratelimit-reset") || response.headers.get("x-rate-limit-reset"));

    if (Number.isFinite(limit) && limit > 0) {
      this.rateLimitStatus.maxWeight = limit;
    }
    if (Number.isFinite(remaining) && Number.isFinite(this.rateLimitStatus.maxWeight)) {
      this.rateLimitStatus.currentWeight = Math.max(this.rateLimitStatus.maxWeight - remaining, 0);
      this.rateLimitStatus.usagePercent = this.rateLimitStatus.maxWeight > 0
        ? this.rateLimitStatus.currentWeight / this.rateLimitStatus.maxWeight
        : 0;
      this.rateLimitStatus.isThrottling = this.rateLimitStatus.usagePercent >= 0.9;
    }
    if (Number.isFinite(reset)) {
      const resetMs = reset * 1000;
      this.rateLimitStatus.timeUntilReset = Math.max(resetMs - Date.now(), 0);
    }
  }

  private onRequestFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 5) {
      this.circuitBreakerState = "OPEN";
    }
  }

  private onRequestSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitBreakerState === "OPEN") {
      this.circuitBreakerState = "CLOSED";
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (this.circuitBreakerState === "OPEN") {
      throw new Error("Robinhood circuit breaker is OPEN");
    }

    const method = (init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.signRequest(path, method, body, timestamp);

    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    headers.set("x-api-key", this.apiKey);
    headers.set("x-signature", signature);
    headers.set("x-timestamp", timestamp);
    if (body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      method,
      headers,
      body: body || undefined,
    });

    this.updateRateStatus(response);

    if (response.status === 429) {
      this.rateLimitStatus.isThrottling = true;
      this.rateLimitStatus.throttledCount += 1;
      this.onRequestFailure();
      throw new Error("Robinhood rate limit exceeded (429)");
    }

    if (!response.ok) {
      const details = await response.text();
      this.onRequestFailure();
      throw new Error(`Robinhood API ${response.status}: ${details || response.statusText}`);
    }

    if (response.status === 204) {
      this.onRequestSuccess();
      return undefined as T;
    }

    const text = await response.text();
    this.onRequestSuccess();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private async requestAllResults<T>(path: string, maxPages = 5): Promise<T[]> {
    const rows: T[] = [];
    let nextPath: string | null = path;
    let page = 0;

    while (nextPath && page < maxPages) {
      const payload: unknown = await this.request<unknown>(nextPath);

      if (!hasResultsArray<T>(payload)) {
        break;
      }

      rows.push(...payload.results);
      page += 1;

      if (!payload.next) {
        nextPath = null;
        continue;
      }

      if (payload.next.startsWith("http://") || payload.next.startsWith("https://")) {
        const nextUrl: URL = new URL(payload.next);
        nextPath = `${nextUrl.pathname}${nextUrl.search}`;
      } else {
        nextPath = payload.next;
      }
    }

    return rows;
  }

  private normalizeOrder(raw: Record<string, unknown>): Order {
    const qty = parseNumber(raw.asset_quantity ?? raw.quantity);
    const executedQty = parseNumber(raw.filled_asset_quantity ?? raw.executed_quantity);
    const avgPrice = parseNumber(raw.average_price ?? raw.limit_price ?? raw.price);
    return {
      orderId: String(raw.id ?? raw.order_id ?? ""),
      clientOrderId: String(raw.client_order_id ?? "").trim() || undefined,
      symbol: normalizeOrderSymbol(raw.symbol),
      side: String(raw.side ?? "buy").toLowerCase() === "sell" ? "SELL" : "BUY",
      type: normalizeOrderType(raw.type),
      status: normalizeOrderStatus(raw.state ?? raw.status),
      price: avgPrice,
      quantity: qty,
      executedQty,
      cummulativeQuoteQty: avgPrice * executedQty,
      timeInForce: normalizeTimeInForce(raw.time_in_force),
      stopPrice: parseNumber(raw.stop_price || undefined) || undefined,
      time: raw.created_at ? Date.parse(String(raw.created_at)) : undefined,
      updateTime: raw.updated_at ? Date.parse(String(raw.updated_at)) : undefined,
      isWorking: normalizeOrderStatus(raw.state ?? raw.status) === "NEW",
    };
  }

  private async getBestBidAsk(symbols: string[]): Promise<Array<Record<string, unknown>>> {
    if (symbols.length === 0) return [];
    const params = new URLSearchParams();
    for (const symbol of symbols) {
      params.append("symbol", this.toRobinhoodSymbol(symbol));
    }
    const payload = await this.request<unknown>(`/api/v1/crypto/marketdata/best_bid_ask/?${params.toString()}`);
    if (hasResultsArray<Record<string, unknown>>(payload)) {
      return payload.results;
    }
    return [];
  }

  private getIntervalConfig(interval: string): IntervalMapping {
    const direct = INTERVAL_MAP[interval];
    if (direct) return direct;

    // Fallback: find the closest available interval by duration
    const requestedMs = intervalToMs(interval);
    let bestKey = "1h";
    let bestDiff = Infinity;
    for (const key of INTERVAL_KEYS_ORDERED) {
      const diff = Math.abs(INTERVAL_MAP[key]!.intervalMs - requestedMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestKey = key;
      }
    }
    console.warn(`[robinhood] Interval "${interval}" is not supported. Falling back to closest available interval "${bestKey}".`);
    return INTERVAL_MAP[bestKey]!;
  }

  private async getRawAccount(): Promise<Record<string, unknown>> {
    const payload = await this.request<unknown>("/api/v1/crypto/trading/accounts/");
    if (hasResultsArray<Record<string, unknown>>(payload) && payload.results.length > 0) {
      return payload.results[0] || {};
    }
    if (payload && typeof payload === "object") return payload as Record<string, unknown>;
    return {};
  }

  private async getRawHoldings(): Promise<Array<Record<string, unknown>>> {
    return this.requestAllResults<Record<string, unknown>>("/api/v1/crypto/trading/holdings/");
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    try {
      await this.getAccountInfo();
      return true;
    } catch {
      return false;
    }
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const pairs = await this.requestAllResults<Record<string, unknown>>("/api/v1/crypto/trading/trading_pairs/");
    const symbols: SymbolInfo[] = pairs.map((pair) => {
      const pairSymbol = String(pair.symbol ?? "");
      const [baseAsset, quoteAsset] = pairSymbol.split("-");
      const minQty = String(pair.min_order_size ?? pair.min_order_quantity ?? "");
      const maxQty = String(pair.max_order_size ?? pair.max_order_quantity ?? "");

      return {
        symbol: normalizeOrderSymbol(pairSymbol),
        status: String(pair.status ?? "active"),
        baseAsset: String(pair.asset_code ?? baseAsset ?? "").toUpperCase(),
        quoteAsset: String(pair.quote_code ?? quoteAsset ?? "USD").toUpperCase(),
        baseAssetPrecision: 8,
        quoteAssetPrecision: 2,
        orderTypes: ["MARKET", "LIMIT", "STOP_LOSS", "STOP_LOSS_LIMIT"] as OrderType[],
        isSpotTradingAllowed: String(pair.status ?? "").toLowerCase() !== "inactive",
        filters: [
          {
            filterType: "LOT_SIZE",
            minQty,
            maxQty,
            stepSize: String(pair.increment ?? "0.00000001"),
          },
        ],
      };
    });

    const result: ExchangeInfo = {
      timezone: "UTC",
      serverTime: Date.now(),
      symbols,
    };
    registerExchangeInfoSymbols(result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    const quotes = await this.getBestBidAsk([symbol]);
    const first = quotes[0];
    if (!first) throw new Error(`No Robinhood quote available for ${symbol}`);

    const bid = parseNumber(first.bid_price ?? first.bid_inclusive_of_sell_spread);
    const ask = parseNumber(first.ask_price ?? first.ask_inclusive_of_buy_spread);
    if (bid > 0 && ask > 0) {
      return (bid + ask) / 2;
    }
    return Math.max(bid, ask);
  }

  async getCandles(symbol: string, interval: string, limit = 100): Promise<Candle[]> {
    const robinhoodSymbol = this.toRobinhoodSymbol(symbol);
    const cfg = this.getIntervalConfig(interval);
    const payload = await this.request<unknown>(
      `/api/v1/crypto/marketdata/historicals/${robinhoodSymbol}/?interval=${cfg.interval}&span=${cfg.span}&bounds=24_7`
    );
    if (!hasResultsArray<Record<string, unknown>>(payload)) return [];

    const rows = payload.results
      .map((row): Candle => {
        const beginsAt = Date.parse(String(row.begins_at ?? row.timestamp ?? ""));
        const open = parseNumber(row.open_price ?? row.open);
        const high = parseNumber(row.high_price ?? row.high);
        const low = parseNumber(row.low_price ?? row.low);
        const close = parseNumber(row.close_price ?? row.close);
        const volume = parseNumber(row.volume);
        return {
          openTime: beginsAt,
          open,
          high,
          low,
          close,
          volume,
          closeTime: beginsAt + cfg.intervalMs,
        };
      })
      .filter((c) => Number.isFinite(c.openTime) && c.openTime > 0);

    if (rows.length <= limit) return rows;
    return rows.slice(rows.length - limit);
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    const info = await this.getExchangeInfo();
    const symbols = info.symbols.slice(0, 100).map((entry) => entry.symbol);
    const quotes = await this.getBestBidAsk(symbols);

    return quotes.map((quote) => {
      const symbol = normalizeOrderSymbol(quote.symbol ?? "");
      const bid = parseNumber(quote.bid_price ?? quote.bid_inclusive_of_sell_spread);
      const ask = parseNumber(quote.ask_price ?? quote.ask_inclusive_of_buy_spread);
      const lastPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask);
      const volume = parseNumber(quote.volume_24h ?? quote.volume);
      return {
        symbol,
        priceChange: 0,
        priceChangePercent: 0,
        lastPrice,
        highPrice: parseNumber(quote.high_price ?? lastPrice),
        lowPrice: parseNumber(quote.low_price ?? lastPrice),
        volume,
        quoteVolume: volume * lastPrice,
        openTime: Date.now() - 86_400_000,
        closeTime: Date.now(),
      };
    });
  }

  async getTopSymbols(n: number): Promise<string[]> {
    const info = await this.getExchangeInfo();
    const available = new Set(info.symbols.map((entry) => entry.symbol));
    const ranked = POPULAR_SYMBOLS.filter((symbol) => available.has(symbol));
    if (ranked.length >= n) return ranked.slice(0, n);
    const fallback = info.symbols.map((entry) => entry.symbol);
    return [...new Set([...ranked, ...fallback])].slice(0, n);
  }

  async getOrderBook(symbol: string, limit = 20): Promise<OrderBook> {
    const robinhoodSymbol = this.toRobinhoodSymbol(symbol);
    const payload = await this.request<unknown>(`/api/v1/crypto/marketdata/orderbook/?symbol=${robinhoodSymbol}`);
    if (!hasResultsArray<Record<string, unknown>>(payload) || payload.results.length === 0) {
      return { lastUpdateId: Date.now(), bids: [], asks: [] };
    }

    const first = payload.results[0] || {};
    const bidsRaw = Array.isArray(first.bids) ? first.bids : [];
    const asksRaw = Array.isArray(first.asks) ? first.asks : [];

    const bids = bidsRaw.slice(0, limit).map((entry) => {
      const row = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
      return {
        price: parseNumber(row.price),
        quantity: parseNumber(row.quantity),
      };
    });
    const asks = asksRaw.slice(0, limit).map((entry) => {
      const row = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
      return {
        price: parseNumber(row.price),
        quantity: parseNumber(row.quantity),
      };
    });

    return {
      lastUpdateId: Date.now(),
      bids,
      asks,
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const quotes = await this.getBestBidAsk([symbol]);
    const first = quotes[0];
    if (!first) {
      throw new Error(`No Robinhood quote available for ${symbol}`);
    }

    return {
      symbol: normalizeOrderSymbol(first.symbol ?? this.toRobinhoodSymbol(symbol)),
      bidPrice: parseNumber(first.bid_price ?? first.bid_inclusive_of_sell_spread),
      bidQty: parseNumber(first.bid_size ?? first.bid_quantity),
      askPrice: parseNumber(first.ask_price ?? first.ask_inclusive_of_buy_spread),
      askQty: parseNumber(first.ask_size ?? first.ask_quantity),
    };
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    const ticker = await this.getBookTicker(symbol);
    const spread = ticker.askPrice - ticker.bidPrice;
    const mid = (ticker.askPrice + ticker.bidPrice) / 2;
    return {
      spread,
      spreadPercent: mid > 0 ? (spread / mid) * 100 : 0,
      bidPrice: ticker.bidPrice,
      askPrice: ticker.askPrice,
    };
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    const candles = await this.getCandles(symbol, "1h", 24);
    if (candles.length === 0) {
      return { mins: 60, price: await this.getPrice(symbol) };
    }
    const avg = candles.reduce((sum, candle) => sum + candle.close, 0) / candles.length;
    return { mins: 60, price: avg };
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const [account, holdings] = await Promise.all([this.getRawAccount(), this.getRawHoldings()]);
    const buyingPower = parseNumber(account.buying_power ?? account.buying_power_amount);
    const balances: Balance[] = holdings
      .map((row) => {
        const total = parseNumber(row.total_quantity ?? row.quantity ?? row.asset_quantity);
        const free = parseNumber(row.quantity_available_for_trading ?? row.available_quantity ?? total);
        const locked = Math.max(total - free, 0);
        return {
          asset: String(row.asset_code ?? row.symbol ?? "").toUpperCase(),
          free,
          locked,
          total,
        };
      })
      .filter((balance) => balance.asset.length > 0 && balance.total > 0);

    if (buyingPower > 0) {
      balances.unshift({
        asset: "USD",
        free: buyingPower,
        locked: 0,
        total: buyingPower,
      });
    }

    return {
      canTrade: String(account.status ?? "active").toLowerCase() === "active",
      canWithdraw: true,
      canDeposit: true,
      accountType: "SPOT",
      balances,
      updateTime: Date.now(),
    };
  }

  async getBalance(asset: string): Promise<number> {
    const balances = await this.getAllBalances();
    const target = balances.find((row) => row.asset.toUpperCase() === asset.toUpperCase());
    return target?.total || 0;
  }

  async getAllBalances(): Promise<Balance[]> {
    const info = await this.getAccountInfo();
    return info.balances.filter((balance) => balance.total > 0);
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    const accountInfo = await this.getAccountInfo();
    const nonZeroBalances = accountInfo.balances.filter((balance) => balance.total > 0);

    const stableAssets = new Set(["USD", "USDT", "USDC"]);
    const stableValue = nonZeroBalances
      .filter((balance) => stableAssets.has(balance.asset))
      .reduce((sum, balance) => sum + balance.total, 0);

    const volatileBalances = nonZeroBalances.filter((balance) => !stableAssets.has(balance.asset));
    const quoteValues = await Promise.allSettled(
      volatileBalances.map(async (balance) => {
        const symbol = `${balance.asset}USD`;
        const price = await this.getPrice(symbol);
        return balance.total * price;
      })
    );

    const volatileValue = quoteValues.reduce((sum, result) => {
      if (result.status !== "fulfilled") return sum;
      return sum + result.value;
    }, 0);

    return {
      accountInfo,
      totalUsdtValue: stableValue + volatileValue,
      nonZeroBalances,
    };
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  async placeOrder(params: OrderParams): Promise<Order> {
    const type = normalizeOrderType(params.type);
    const symbol = this.toRobinhoodSymbol(params.symbol);
    const side = params.side.toLowerCase();
    const clientOrderId = params.newClientOrderId || randomUUID();

    const payload: Record<string, unknown> = {
      client_order_id: clientOrderId,
      side,
      symbol,
      type: type.toLowerCase(),
    };

    switch (type) {
      case "MARKET": {
        const marketConfig: Record<string, string> = {};
        if (params.quoteOrderQty !== undefined) {
          marketConfig.quote_amount = String(params.quoteOrderQty);
        } else if (params.quantity !== undefined) {
          marketConfig.asset_quantity = String(params.quantity);
        } else {
          throw new Error("Robinhood market orders require quantity or quoteOrderQty");
        }
        payload.market_order_config = marketConfig;
        break;
      }
      case "LIMIT": {
        if (params.quantity === undefined || params.price === undefined) {
          throw new Error("Robinhood limit orders require quantity and price");
        }
        payload.limit_order_config = {
          asset_quantity: String(params.quantity),
          limit_price: String(params.price),
          time_in_force: this.mapTif(params.timeInForce),
        };
        break;
      }
      case "STOP_LOSS": {
        if (params.quantity === undefined || params.stopPrice === undefined) {
          throw new Error("Robinhood stop-loss orders require quantity and stopPrice");
        }
        payload.stop_loss_order_config = {
          asset_quantity: String(params.quantity),
          stop_price: String(params.stopPrice),
        };
        break;
      }
      case "STOP_LOSS_LIMIT": {
        if (params.quantity === undefined || params.stopPrice === undefined || params.price === undefined) {
          throw new Error("Robinhood stop-loss-limit orders require quantity, stopPrice, and price");
        }
        payload.stop_limit_order_config = {
          asset_quantity: String(params.quantity),
          stop_price: String(params.stopPrice),
          limit_price: String(params.price),
          time_in_force: this.mapTif(params.timeInForce),
        };
        break;
      }
      default:
        throw new Error(`Robinhood order type not supported: ${params.type}`);
    }

    const response = await this.request<Record<string, unknown>>("/api/v1/crypto/trading/orders/", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return this.normalizeOrder(response);
  }

  async cancelOrder(_symbol: string, orderId: string): Promise<void> {
    await this.request<void>(`/api/v1/crypto/trading/orders/${orderId}/cancel/`, {
      method: "POST",
      body: "{}",
    });
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    const openOrders = await this.getOpenOrders(symbol);
    const cancelled: Order[] = [];
    for (const order of openOrders) {
      try {
        await this.cancelOrder(symbol, order.orderId);
        cancelled.push({
          ...order,
          status: "CANCELED",
          updateTime: Date.now(),
        });
      } catch {
        // continue cancelling the rest
      }
    }
    return cancelled;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const history = await this.getOrderHistory(symbol || "", 250);
    return history.filter((order) => order.status === "NEW" || order.status === "PARTIALLY_FILLED");
  }

  async getOrderStatus(_symbol: string, orderId: number | string): Promise<Order> {
    const response = await this.request<Record<string, unknown>>(`/api/v1/crypto/trading/orders/${orderId}/`);
    return this.normalizeOrder(response);
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    try {
      const type = normalizeOrderType(params.type);
      if (type === "MARKET") {
        if (params.quantity === undefined && params.quoteOrderQty === undefined) return false;
      }
      if (type === "LIMIT" && (params.quantity === undefined || params.price === undefined)) return false;
      if (type === "STOP_LOSS" && (params.quantity === undefined || params.stopPrice === undefined)) return false;
      if (type === "STOP_LOSS_LIMIT" && (params.quantity === undefined || params.stopPrice === undefined || params.price === undefined)) {
        return false;
      }
      await this.getPrice(params.symbol);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit = 100): Promise<Trade[]> {
    const orders = await this.getOrderHistory(symbol, Math.max(limit, 200));
    const trades: Trade[] = [];

    for (const order of orders) {
      if (order.status !== "FILLED" && order.status !== "PARTIALLY_FILLED") continue;

      trades.push({
        id: `${order.orderId}-fill`,
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        price: order.price,
        quantity: order.executedQty > 0 ? order.executedQty : order.quantity,
        commission: 0,
        commissionAsset: "USD",
        time: order.updateTime || order.time || Date.now(),
        isMaker: false,
      });
    }

    return trades.slice(0, limit);
  }

  async getOrderHistory(symbol: string, limit = 100): Promise<Order[]> {
    const response = await this.requestAllResults<Record<string, unknown>>("/api/v1/crypto/trading/orders/");
    const normalized = response.map((row) => this.normalizeOrder(row));
    const filtered = symbol
      ? normalized.filter((order) => order.symbol === normalizeOrderSymbol(this.toRobinhoodSymbol(symbol)))
      : normalized;
    return filtered.slice(0, limit);
  }

  async getDepositHistory(_limit = 100): Promise<Deposit[]> {
    // Robinhood crypto trading API does not currently expose a standardized deposit history endpoint.
    console.warn("[robinhood] Deposit/withdrawal history not available via Robinhood Crypto API. Use Robinhood app for fund transfer records.");
    return [];
  }

  async getWithdrawalHistory(_limit = 100): Promise<Withdrawal[]> {
    // Robinhood crypto trading API does not currently expose a standardized withdrawal history endpoint.
    console.warn("[robinhood] Deposit/withdrawal history not available via Robinhood Crypto API. Use Robinhood app for fund transfer records.");
    return [];
  }

  // -------------------------------------------------------------------------
  // Rate Limiting & Status
  // -------------------------------------------------------------------------

  shouldThrottle(): boolean {
    return this.circuitBreakerState === "OPEN" || this.rateLimitStatus.isThrottling;
  }

  getRateLimitStatus(): RateLimitStatus {
    return { ...this.rateLimitStatus };
  }

  getCircuitBreakerState(): string {
    return this.circuitBreakerState;
  }

  resetCircuitBreaker(): void {
    this.circuitBreakerState = "CLOSED";
    this.consecutiveFailures = 0;
    this.rateLimitStatus.isThrottling = false;
  }
}

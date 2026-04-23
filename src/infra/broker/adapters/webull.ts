/**
 * Webull Broker Adapter
 * Implements the broker abstraction with Webull OpenAPI signed requests.
 *
 * The adapter supports endpoint fallbacks because Webull has multiple API path
 * variants across API generations.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Candle } from "../../../types/index.ts";
import type {
  BrokerAdapter,
  BrokerAccount,
  BrokerCapabilities,
  BrokerClock,
  BrokerCredentials,
  BrokerHistoricalBarsParams,
  BrokerId,
  BrokerOrder,
  BrokerOrderListParams,
  BrokerOrderRequest,
  BrokerOrderStatus,
  BrokerOrderType,
  BrokerPosition,
  BrokerQuote,
  BrokerTimeInForce,
} from "../types.ts";

const DEFAULT_WEBULL_LIVE_BASE_URL = "https://api.webull.com";
const DEFAULT_WEBULL_PAPER_BASE_URL = "https://us-openapi-alb.uat.webullbroker.com";

class WebullApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WebullApiError";
    this.status = status;
  }
}

function parseNumber(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function upperMd5(input: string): string {
  return createHash("md5").update(input).digest("hex").toUpperCase();
}

function upperHmacSha1(secret: string, payload: string): string {
  return createHmac("sha1", secret).update(payload).digest("hex").toUpperCase();
}

function encodeRfc3986(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeOrderType(value: unknown): BrokerOrderType {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "market":
    case "mkt":
      return "market";
    case "limit":
    case "lmt":
      return "limit";
    case "stop":
    case "stp":
      return "stop";
    case "stop_limit":
    case "stoplimit":
    case "stp_lmt":
      return "stop_limit";
    case "trailing_stop":
    case "trailingstop":
    case "trail":
      return "trailing_stop";
    default:
      return "market";
  }
}

function toWebullOrderType(value: BrokerOrderType): string {
  switch (value) {
    case "market":
      return "MARKET";
    case "limit":
      return "LIMIT";
    case "stop":
      return "STOP";
    case "stop_limit":
      return "STOP_LIMIT";
    case "trailing_stop":
      return "TRAILING_STOP";
    default:
      return "MARKET";
  }
}

function normalizeTimeInForce(value: unknown): BrokerTimeInForce {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "day":
      return "day";
    case "gtc":
      return "gtc";
    case "opg":
      return "opg";
    case "cls":
      return "cls";
    case "ioc":
      return "ioc";
    case "fok":
      return "fok";
    default:
      return "day";
  }
}

function normalizeOrderStatus(value: unknown): BrokerOrderStatus {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "new":
    case "accepted":
    case "partially_filled":
    case "filled":
    case "done_for_day":
    case "canceled":
    case "cancelled":
      return "canceled";
    case "expired":
    case "replaced":
    case "pending_cancel":
    case "pending_replace":
    case "pending_new":
    case "rejected":
    case "stopped":
    case "suspended":
    case "calculated":
      return normalized as BrokerOrderStatus;
    default:
      return "unknown";
  }
}

function normalizeSide(value: unknown): "buy" | "sell" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "sell" || normalized === "s") return "sell";
  return "buy";
}

function extractArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];

  const obj = input as Record<string, unknown>;
  const keys = ["items", "records", "list", "orders", "positions", "accounts", "result"];
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function isSuccessCode(code: unknown, success: unknown): boolean {
  if (success === true) return true;
  if (code === undefined || code === null || code === "") return success !== false;

  const normalized = String(code).trim().toLowerCase();
  return normalized === "0" || normalized === "200" || normalized === "ok" || normalized === "success";
}

function buildUsMarketClockFallback(): BrokerClock {
  const now = new Date();
  const open = new Date(now);
  const close = new Date(now);

  // Approximate U.S. regular session in UTC (DST-aware handling is outside scope here).
  open.setUTCHours(14, 30, 0, 0);
  close.setUTCHours(21, 0, 0, 0);

  let nextOpen = new Date(open);
  let nextClose = new Date(close);
  const isOpen = now >= open && now <= close;

  if (now > close) {
    nextOpen.setUTCDate(nextOpen.getUTCDate() + 1);
    nextClose.setUTCDate(nextClose.getUTCDate() + 1);
  }

  return {
    timestamp: now.toISOString(),
    isOpen,
    nextOpen: nextOpen.toISOString(),
    nextClose: nextClose.toISOString(),
  };
}

interface RequestOptions {
  dataApi?: boolean;
  retryOnAuth?: boolean;
}

/**
 * Webull adapter implementation.
 */
export class WebullAdapter implements BrokerAdapter {
  readonly brokerId: BrokerId = "webull";
  readonly displayName = "Webull";
  readonly capabilities: BrokerCapabilities = {
    supportsMarketOrders: true,
    supportsLimitOrders: true,
    supportsExtendedHours: true,
    supportsFractionalShares: true,
    supportsShortSelling: true,
    supportsOptions: true,
    supportsStreaming: false,
    supportsPaperTrading: true,
    supportsHistoricalBars: false,
  };

  readonly isPaper: boolean;
  private readonly credentials: BrokerCredentials;
  private readonly baseUrl: string;
  private readonly dataBaseUrl: string;
  private accountIdCache?: string;
  private accessToken?: string;
  private accessTokenExpiresAt = 0;
  private tokenFetchFailedAt = 0;

  constructor(credentials: BrokerCredentials) {
    this.credentials = credentials;

    const paper = credentials.paper ?? true;
    this.isPaper = paper;
    this.baseUrl = credentials.baseUrl || (paper ? DEFAULT_WEBULL_PAPER_BASE_URL : DEFAULT_WEBULL_LIVE_BASE_URL);
    this.dataBaseUrl = credentials.dataBaseUrl || this.baseUrl;
    this.accountIdCache = credentials.accountId;
  }

  private buildSignedHeaders(url: URL, body: string, initHeaders?: HeadersInit): Headers {
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const uri = encodeRfc3986(`${url.pathname}${url.search}`);
    const preSign = `${this.credentials.apiKey}${timestamp}${uri}${body}${nonce}`;
    const signature = upperHmacSha1(this.credentials.apiSecret, upperMd5(preSign));

    const headers = new Headers(initHeaders);
    headers.set("accept", "application/json");
    headers.set("host", url.host);
    headers.set("x-app-key", this.credentials.apiKey);
    headers.set("x-timestamp", timestamp);
    headers.set("x-signature", signature);
    headers.set("x-sign-nonce", nonce);
    headers.set("x-nonce", nonce);

    if (this.accessToken) {
      headers.set("authorization", `Bearer ${this.accessToken}`);
    }
    return headers;
  }

  private unwrapResponse<T>(payload: unknown): T {
    if (payload === undefined || payload === null) {
      return payload as T;
    }
    if (typeof payload !== "object") {
      return payload as T;
    }

    const obj = payload as Record<string, unknown>;
    const code = obj.code ?? obj.status ?? obj.errorCode ?? obj.retCode;
    const success = obj.success;

    if (!isSuccessCode(code, success)) {
      const message = String(obj.message ?? obj.msg ?? obj.errorMessage ?? "Webull API request failed");
      throw new Error(message);
    }

    if (obj.data !== undefined) return obj.data as T;
    if (obj.result !== undefined) return obj.result as T;
    if (obj.payload !== undefined) return obj.payload as T;

    return payload as T;
  }

  private async tryRefreshAccessToken(): Promise<boolean> {
    const now = Date.now();
    if (this.accessToken && this.accessTokenExpiresAt - now > 5_000) {
      return true;
    }
    if (this.tokenFetchFailedAt > 0 && now - this.tokenFetchFailedAt < 60_000) {
      return false;
    }

    const url = new URL("/oauth2/token", this.baseUrl).toString();
    const attempts: Array<RequestInit> = [
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          grant_type: "client_credentials",
          app_key: this.credentials.apiKey,
          app_secret: this.credentials.apiSecret,
        }),
      },
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.credentials.apiKey,
          client_secret: this.credentials.apiSecret,
        }).toString(),
      },
    ];

    for (const init of attempts) {
      try {
        const response = await fetch(url, init);
        if (!response.ok) continue;

        const payload = JSON.parse(await response.text()) as Record<string, unknown>;
        const token = String(
          payload.access_token
            ?? payload.accessToken
            ?? payload.token
            ?? ""
        ).trim();
        if (!token) continue;

        const expiresIn = parseNumber(payload.expires_in ?? payload.expiresIn);
        this.accessToken = token;
        this.accessTokenExpiresAt = now + (expiresIn > 0 ? expiresIn * 1_000 : 55 * 60 * 1_000);
        this.tokenFetchFailedAt = 0;
        return true;
      } catch {
        // Ignore and try next auth style.
      }
    }

    this.tokenFetchFailedAt = now;
    return false;
  }

  private async request<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T> {
    const baseUrl = options?.dataApi ? this.dataBaseUrl : this.baseUrl;
    const url = new URL(path, baseUrl);

    const body = typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";

    const headers = this.buildSignedHeaders(url, body, init?.headers);
    if (body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url.toString(), {
      ...init,
      headers,
    });

    if ((response.status === 401 || response.status === 403) && options?.retryOnAuth !== false) {
      const refreshed = await this.tryRefreshAccessToken();
      if (refreshed) {
        return this.request<T>(path, init, { ...options, retryOnAuth: false });
      }
    }

    if (!response.ok) {
      const bodyText = await response.text();
      const details = bodyText.trim().length > 0 ? `: ${bodyText}` : "";
      throw new WebullApiError(response.status, `Webull API ${response.status} ${response.statusText}${details}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) return undefined as T;

    return this.unwrapResponse<T>(JSON.parse(text));
  }

  private async requestWithCandidates<T>(
    candidates: Array<{ path: string; init?: RequestInit; dataApi?: boolean }>,
  ): Promise<T> {
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        return await this.request<T>(candidate.path, candidate.init, { dataApi: candidate.dataApi });
      } catch (error) {
        lastError = error;
        // Keep trying candidate paths for compatibility.
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Webull request failed");
  }

  private async resolveAccountId(): Promise<string> {
    if (this.accountIdCache) {
      return this.accountIdCache;
    }

    const raw = await this.requestWithCandidates<unknown>([
      { path: "/openapi/account/list" },
      { path: "/api/account/list" },
      { path: "/app/subscriptions/list" },
    ]);

    const rows = extractArray(raw);
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const accountId = String(
        item.accountId
          ?? item.account_id
          ?? item.secAccountId
          ?? item.sec_account_id
          ?? item.id
          ?? ""
      ).trim();
      if (accountId) {
        this.accountIdCache = accountId;
        return accountId;
      }
    }

    throw new Error("Webull account ID not found. Set WEBULL_ACCOUNT_ID or configure account access.");
  }

  private toBrokerOrder(rawOrder: unknown): BrokerOrder {
    const raw = (rawOrder && typeof rawOrder === "object") ? rawOrder as Record<string, unknown> : {};
    const side = normalizeSide(raw.side ?? raw.orderSide ?? raw.action);
    const qty = parseNumber(raw.qty ?? raw.quantity ?? raw.orderQty ?? raw.totalQuantity ?? raw.entrustAmount);
    const filledQty = parseNumber(raw.filledQty ?? raw.filled_quantity ?? raw.dealQuantity ?? raw.executedQty);

    return {
      id: String(raw.id ?? raw.orderId ?? raw.order_id ?? ""),
      clientOrderId: String(raw.clientOrderId ?? raw.client_order_id ?? "").trim() || undefined,
      symbol: String(raw.symbol ?? raw.ticker ?? raw.stockCode ?? raw.stock_code ?? ""),
      side,
      type: normalizeOrderType(raw.type ?? raw.orderType ?? raw.order_type),
      timeInForce: normalizeTimeInForce(raw.timeInForce ?? raw.tif ?? raw.orderTif),
      status: normalizeOrderStatus(raw.status ?? raw.orderStatus ?? raw.order_status),
      qty,
      filledQty,
      notional: raw.notional !== undefined ? parseNumber(raw.notional) : undefined,
      limitPrice: raw.limitPrice !== undefined
        ? parseNumber(raw.limitPrice)
        : raw.price !== undefined
          ? parseNumber(raw.price)
          : raw.entrustPrice !== undefined
            ? parseNumber(raw.entrustPrice)
            : undefined,
      stopPrice: raw.stopPrice !== undefined ? parseNumber(raw.stopPrice) : undefined,
      extendedHours: parseBoolean(raw.extendedHours ?? raw.outsideRth ?? raw.orderOutsideRth),
      submittedAt: String(raw.submittedAt ?? raw.createdAt ?? raw.createTime ?? raw.entrustTime ?? "").trim() || undefined,
      filledAt: String(raw.filledAt ?? raw.lastFillTime ?? raw.updatedAt ?? "").trim() || undefined,
      canceledAt: String(raw.canceledAt ?? raw.cancelTime ?? "").trim() || undefined,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getAccount();
      return true;
    } catch {
      return false;
    }
  }

  async getClock(): Promise<BrokerClock> {
    try {
      const raw = await this.requestWithCandidates<Record<string, unknown>>([
        { path: "/openapi/market-data/trading/clock", dataApi: true },
        { path: "/openapi/market/clock", dataApi: true },
        { path: "/api/market/clock", dataApi: true },
      ]);

      return {
        timestamp: String(raw.timestamp ?? raw.time ?? new Date().toISOString()),
        isOpen: parseBoolean(raw.isOpen ?? raw.open ?? raw.marketOpen),
        nextOpen: String(raw.nextOpen ?? raw.next_open ?? new Date().toISOString()),
        nextClose: String(raw.nextClose ?? raw.next_close ?? new Date().toISOString()),
      };
    } catch {
      return buildUsMarketClockFallback();
    }
  }

  async getAccount(): Promise<BrokerAccount> {
    const accountId = await this.resolveAccountId();
    const query = new URLSearchParams({
      accountId,
      account_id: accountId,
      secAccountId: accountId,
      sec_account_id: accountId,
    }).toString();

    const raw = await this.requestWithCandidates<Record<string, unknown>>([
      { path: `/openapi/account/balance?${query}` },
      { path: `/openapi/account/getSecAccountInfo?${query}` },
      { path: `/api/account/getSecAccountInfo?${query}` },
    ]);

    const cash = parseNumber(raw.cash ?? raw.cashBalance ?? raw.currentBalance);
    const buyingPower = parseNumber(raw.buyingPower ?? raw.dayTradingBuyingPower ?? raw.buying_power);
    const portfolioValue = parseNumber(raw.portfolioValue ?? raw.netLiquidation ?? raw.totalAssets);

    return {
      id: String(raw.id ?? raw.accountId ?? raw.account_id ?? accountId),
      status: String(raw.status ?? raw.accountStatus ?? "active"),
      currency: String(raw.currency ?? raw.baseCurrency ?? "USD"),
      cash,
      buyingPower,
      portfolioValue,
      patternDayTrader: parseBoolean(raw.patternDayTrader ?? raw.pdtFlag),
      shortingEnabled: parseBoolean(raw.shortingEnabled ?? raw.shortStatus ?? true),
      tradingBlocked: parseBoolean(raw.tradingBlocked ?? raw.tradeBlocked ?? false),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const accountId = await this.resolveAccountId();
    const query = new URLSearchParams({
      accountId,
      secAccountId: accountId,
      sec_account_id: accountId,
    }).toString();

    const raw = await this.requestWithCandidates<unknown>([
      { path: `/openapi/account/positions?${query}` },
      { path: `/openapi/account/getPositionList?${query}` },
      { path: `/api/account/getPositionList?${query}` },
    ]);

    const positions = extractArray(raw);
    return positions.map((entry) => {
      const item = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
      const qty = parseNumber(item.qty ?? item.quantity ?? item.position ?? item.holdVolume);
      const marketValue = parseNumber(item.marketValue ?? item.market_value ?? item.positionValue);
      const avgEntryPrice = parseNumber(item.avgEntryPrice ?? item.avg_price ?? item.costPrice);
      const unrealizedPl = parseNumber(item.unrealizedPl ?? item.unrealized_profit_loss ?? item.unrealizedPnL);
      const unrealizedPlPercent = parseNumber(
        item.unrealizedPlPercent ?? item.unrealized_profit_loss_ratio ?? item.unrealizedPnLRate
      );
      const side = qty < 0 ? "short" : "long";

      return {
        symbol: String(item.symbol ?? item.ticker ?? item.stockCode ?? ""),
        qty: Math.abs(qty),
        side,
        marketValue,
        avgEntryPrice,
        unrealizedPl,
        unrealizedPlPercent,
      };
    });
  }

  async getOpenOrders(limit = 50): Promise<BrokerOrder[]> {
    return this.listOrders({ status: "open", limit });
  }

  async listOrders(params?: BrokerOrderListParams): Promise<BrokerOrder[]> {
    const accountId = await this.resolveAccountId();
    const status = params?.status ?? "open";
    const limit = params?.limit ?? 50;
    const query = new URLSearchParams();
    query.set("accountId", accountId);
    query.set("secAccountId", accountId);
    query.set("limit", String(limit));
    query.set("pageSize", String(limit));
    if (params?.after) query.set("after", params.after);
    if (params?.until) query.set("until", params.until);
    if (params?.direction) query.set("direction", params.direction);
    if (params?.symbols && params.symbols.length > 0) query.set("symbols", params.symbols.join(","));
    if (status !== "open") query.set("status", status);

    const path = query.toString();
    const candidates = status === "open"
      ? [
          { path: `/openapi/trade/order/list?${path}` },
          { path: `/openapi/order/listOpenOrders?${path}` },
          { path: `/api/order/listOpenOrders?${path}` },
        ]
      : [
          { path: `/openapi/trade/order/history?${path}` },
          { path: `/openapi/order/listHistoryOrders?${path}` },
          { path: `/api/order/listHistoryOrders?${path}` },
        ];

    const raw = await this.requestWithCandidates<unknown>(candidates);
    const rows = extractArray(raw);
    return rows.map((row) => this.toBrokerOrder(row));
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    const accountId = await this.resolveAccountId();
    const query = new URLSearchParams({
      orderId,
      accountId,
      secAccountId: accountId,
    }).toString();

    const raw = await this.requestWithCandidates<unknown>([
      { path: `/openapi/trade/order/detail?${query}` },
      { path: `/openapi/order/getOrderDetail?${query}` },
      { path: `/api/order/getOrderDetail?${query}` },
    ]);
    return this.toBrokerOrder(raw);
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrder> {
    if (params.qty === undefined && params.notional === undefined) {
      throw new Error("Broker order requires either qty or notional");
    }

    const accountId = await this.resolveAccountId();
    const body: Record<string, unknown> = {
      accountId,
      secAccountId: accountId,
      symbol: params.symbol.toUpperCase(),
      ticker: params.symbol.toUpperCase(),
      side: params.side.toUpperCase(),
      type: toWebullOrderType(params.type),
      timeInForce: params.timeInForce.toUpperCase(),
      extendedHours: params.extendedHours ?? false,
      clientOrderId: params.clientOrderId ?? randomUUID(),
    };

    if (params.qty !== undefined) body.qty = params.qty;
    if (params.notional !== undefined) body.notional = params.notional;
    if (params.limitPrice !== undefined) body.limitPrice = params.limitPrice;
    if (params.stopPrice !== undefined) body.stopPrice = params.stopPrice;
    if (params.trailPercent !== undefined) body.trailPercent = params.trailPercent;
    if (params.trailPrice !== undefined) body.trailPrice = params.trailPrice;

    const raw = await this.requestWithCandidates<unknown>([
      {
        path: "/openapi/trade/order/place",
        init: { method: "POST", body: JSON.stringify(body) },
      },
      {
        path: "/openapi/order/placeOrder",
        init: { method: "POST", body: JSON.stringify(body) },
      },
      {
        path: "/api/order/placeOrder",
        init: { method: "POST", body: JSON.stringify(body) },
      },
    ]);

    // If API returns only ID metadata, fetch canonical order.
    const rawObj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const placedOrderId = String(rawObj.id ?? rawObj.orderId ?? rawObj.order_id ?? "").trim();
    if (placedOrderId) {
      try {
        return await this.getOrder(placedOrderId);
      } catch {
        // Fallback to normalized partial order from create response.
      }
    }

    return this.toBrokerOrder({
      ...rawObj,
      id: placedOrderId || rawObj.id || rawObj.orderId || `webull-${Date.now()}`,
      symbol: body.symbol,
      side: params.side,
      type: params.type,
      timeInForce: params.timeInForce,
      qty: params.qty ?? 0,
      filledQty: 0,
      status: rawObj.status ?? "accepted",
      limitPrice: params.limitPrice,
      stopPrice: params.stopPrice,
      extendedHours: params.extendedHours ?? false,
    });
  }

  async cancelOrder(orderId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    const body = {
      accountId,
      secAccountId: accountId,
      orderId,
    };

    await this.requestWithCandidates<void>([
      {
        path: "/openapi/trade/order/cancel",
        init: { method: "POST", body: JSON.stringify(body) },
      },
      {
        path: "/openapi/order/cancelOrder",
        init: { method: "POST", body: JSON.stringify(body) },
      },
      {
        path: "/api/order/cancelOrder",
        init: { method: "POST", body: JSON.stringify(body) },
      },
    ]);
  }

  async cancelAllOrders(): Promise<void> {
    const accountId = await this.resolveAccountId();
    const body = {
      accountId,
      secAccountId: accountId,
    };

    await this.requestWithCandidates<void>([
      {
        path: "/openapi/trade/order/cancel-all",
        init: { method: "POST", body: JSON.stringify(body) },
      },
      {
        path: "/openapi/order/cancelAllOrders",
        init: { method: "POST", body: JSON.stringify(body) },
      },
      {
        path: "/api/order/cancelAllOrders",
        init: { method: "POST", body: JSON.stringify(body) },
      },
    ]);
  }

  async getLatestQuote(symbol: string): Promise<BrokerQuote> {
    const normalizedSymbol = symbol.toUpperCase();
    const query = new URLSearchParams({ symbols: normalizedSymbol, ticker: normalizedSymbol }).toString();

    const raw = await this.requestWithCandidates<unknown>([
      { path: `/openapi/market-data/stock/quotes?${query}`, dataApi: true },
      { path: `/api/market-data/stock/quotes?${query}`, dataApi: true },
    ]);

    let quoteRaw: Record<string, unknown> = {};
    if (Array.isArray(raw) && raw.length > 0 && raw[0] && typeof raw[0] === "object") {
      quoteRaw = raw[0] as Record<string, unknown>;
    } else if (raw && typeof raw === "object") {
      const rawObj = raw as Record<string, unknown>;
      const list = extractArray(rawObj);
      if (list.length > 0 && list[0] && typeof list[0] === "object") {
        quoteRaw = list[0] as Record<string, unknown>;
      } else if (rawObj[normalizedSymbol] && typeof rawObj[normalizedSymbol] === "object") {
        quoteRaw = rawObj[normalizedSymbol] as Record<string, unknown>;
      } else {
        quoteRaw = rawObj;
      }
    }

    return {
      symbol: String(quoteRaw.symbol ?? quoteRaw.ticker ?? normalizedSymbol),
      bidPrice: parseNumber(quoteRaw.bidPrice ?? quoteRaw.bid ?? quoteRaw.bp),
      bidSize: parseNumber(quoteRaw.bidSize ?? quoteRaw.bid_volume ?? quoteRaw.bs),
      askPrice: parseNumber(quoteRaw.askPrice ?? quoteRaw.ask ?? quoteRaw.ap),
      askSize: parseNumber(quoteRaw.askSize ?? quoteRaw.ask_volume ?? quoteRaw.as),
      timestamp: String(quoteRaw.timestamp ?? quoteRaw.time ?? quoteRaw.t ?? new Date().toISOString()),
    };
  }

  async getHistoricalBars(_params: BrokerHistoricalBarsParams): Promise<Candle[]> {
    throw new Error("Webull historical bars are not wired through Gordon yet.");
  }
}

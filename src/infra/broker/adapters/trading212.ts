import { Buffer } from "node:buffer";
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
  BrokerPosition,
  BrokerQuote,
} from "../types.ts";
import {
  asRecord,
  buildUsMarketClockFallback,
  findFirstArray,
  findFirstValue,
  isOpenOrderStatus,
  normalizeOrderStatus,
  normalizeOrderType,
  normalizeSide,
  normalizeTimeInForce,
  parseBoolean,
  parseNumber,
  unwrapPayload,
} from "./shared.ts";
import { isKillSwitchesEnabled, isExecutionAllowed } from "../../safety/killSwitches.ts";
import { redactString } from "../../platform/observability/valueRedaction.ts";

const DEFAULT_TRADING212_LIVE_BASE_URL = "https://live.trading212.com";
const DEFAULT_TRADING212_PAPER_BASE_URL = "https://demo.trading212.com";

const TRADING212_CAPABILITIES: BrokerCapabilities = {
  supportsMarketOrders: true,
  supportsLimitOrders: true,
  supportsExtendedHours: false,
  supportsFractionalShares: true,
  supportsShortSelling: false,
  supportsOptions: false,
  supportsStreaming: false,
  supportsPaperTrading: true,
  supportsHistoricalBars: false,
};

function mapTrading212TimeValidity(value: BrokerOrderRequest["timeInForce"]): string {
  switch (value) {
    case "gtc":
      return "GOOD_TILL_CANCEL";
    case "ioc":
      return "IMMEDIATE_OR_CANCEL";
    case "fok":
      return "FILL_OR_KILL";
    default:
      return "DAY";
  }
}

function mapTrading212OrderPath(type: BrokerOrderRequest["type"]): string {
  switch (type) {
    case "market":
      return "/api/v0/equity/orders/market";
    case "limit":
      return "/api/v0/equity/orders/limit";
    case "stop":
      return "/api/v0/equity/orders/stop";
    case "stop_limit":
      return "/api/v0/equity/orders/stop-limit";
    default:
      throw new Error("Trading 212 does not support trailing stop orders through Gordon yet.");
  }
}

export class Trading212Adapter implements BrokerAdapter {
  readonly brokerId: BrokerId = "trading212";
  readonly displayName = "Trading 212";
  readonly capabilities = TRADING212_CAPABILITIES;

  readonly isPaper: boolean;
  private readonly credentials: BrokerCredentials;
  private readonly baseUrl: string;
  private accountIdCache?: string;

  constructor(credentials: BrokerCredentials) {
    this.credentials = credentials;
    this.isPaper = credentials.paper ?? true;
    this.baseUrl = credentials.baseUrl
      || (this.isPaper ? DEFAULT_TRADING212_PAPER_BASE_URL : DEFAULT_TRADING212_LIVE_BASE_URL);
    this.accountIdCache = credentials.accountId;
  }

  private buildHeaders(initHeaders?: HeadersInit): Headers {
    const token = Buffer.from(`${this.credentials.apiKey}:${this.credentials.apiSecret}`).toString("base64");
    const headers = new Headers(initHeaders);
    headers.set("accept", "application/json");
    headers.set("authorization", `Basic ${token}`);
    return headers;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    const headers = this.buildHeaders(init?.headers);
    if (init?.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      const body = await response.text();
      const safeBody = redactString(body).slice(0, 500);
      const details = safeBody.trim() ? `: ${safeBody}` : "";
      throw new Error(`Trading 212 API ${response.status} ${response.statusText}${details}`);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private async resolveAccountId(): Promise<string> {
    if (this.accountIdCache) return this.accountIdCache;
    const payload = await this.request<unknown>("/api/v0/equity/account/info");
    const root = unwrapPayload(payload);
    const accountId = String(findFirstValue(root, ["id", "accountId", "account_id"]) ?? "").trim();
    if (!accountId) {
      throw new Error("Trading 212 account ID could not be resolved. Set TRADING212_ACCOUNT_ID if needed.");
    }
    this.accountIdCache = accountId;
    return accountId;
  }

  private toBrokerOrder(input: unknown): BrokerOrder {
    const raw = asRecord(unwrapPayload(input)) || {};
    return {
      id: String(raw.id ?? raw.orderId ?? raw.order_id ?? `order-${Date.now()}`),
      clientOrderId: String(raw.clientOrderId ?? raw.client_order_id ?? "").trim() || undefined,
      symbol: String(raw.ticker ?? raw.symbol ?? raw.instrument ?? ""),
      side: normalizeSide(raw.side ?? raw.action),
      type: normalizeOrderType(raw.type ?? raw.orderType ?? raw.order_type),
      timeInForce: normalizeTimeInForce(raw.timeValidity ?? raw.timeInForce ?? raw.tif),
      status: normalizeOrderStatus(raw.status ?? raw.orderStatus),
      qty: parseNumber(raw.quantity ?? raw.qty),
      filledQty: parseNumber(raw.filledQuantity ?? raw.filledQty ?? raw.executedQuantity),
      notional: raw.value !== undefined ? parseNumber(raw.value) : undefined,
      limitPrice: raw.limitPrice !== undefined ? parseNumber(raw.limitPrice) : undefined,
      stopPrice: raw.stopPrice !== undefined ? parseNumber(raw.stopPrice) : undefined,
      extendedHours: parseBoolean(raw.extendedHours),
      submittedAt: String(raw.createdAt ?? raw.submittedAt ?? "").trim() || undefined,
      filledAt: String(raw.filledAt ?? raw.executedAt ?? "").trim() || undefined,
      canceledAt: String(raw.canceledAt ?? "").trim() || undefined,
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
    return buildUsMarketClockFallback();
  }

  async getAccount(): Promise<BrokerAccount> {
    const [infoPayload, cashPayload] = await Promise.all([
      this.request<unknown>("/api/v0/equity/account/info"),
      this.request<unknown>("/api/v0/equity/account/cash"),
    ]);
    const info = asRecord(unwrapPayload(infoPayload)) || {};
    const cash = asRecord(unwrapPayload(cashPayload)) || {};
    const id = String(info.id ?? info.accountId ?? await this.resolveAccountId());

    return {
      id,
      status: String(info.status ?? info.state ?? "ACTIVE"),
      currency: String(info.currencyCode ?? info.currency ?? "USD"),
      cash: parseNumber(cash.free ?? cash.cash ?? cash.available),
      buyingPower: parseNumber(cash.availableToInvest ?? cash.buyingPower ?? cash.free ?? cash.available),
      portfolioValue: parseNumber(info.equity ?? cash.total ?? cash.totalValue ?? cash.netLiquidation),
      patternDayTrader: false,
      shortingEnabled: false,
      tradingBlocked: parseBoolean(info.tradingBlocked ?? info.isBlocked),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const payload = await this.request<unknown>("/api/v0/equity/positions");
    const rows = findFirstArray(unwrapPayload(payload)) ?? [];
    return rows.map((entry) => {
      const row = asRecord(entry) || {};
      const qtyRaw = parseNumber(row.quantity ?? row.qty);
      return {
        symbol: String(row.ticker ?? row.symbol ?? ""),
        qty: Math.abs(qtyRaw),
        side: qtyRaw < 0 ? "short" : "long",
        marketValue: parseNumber(row.currentValue ?? row.marketValue ?? row.value),
        avgEntryPrice: parseNumber(row.averagePrice ?? row.avgEntryPrice),
        unrealizedPl: parseNumber(row.result ?? row.unrealizedPl ?? row.pnl),
        unrealizedPlPercent: parseNumber(row.resultPct ?? row.unrealizedPlPercent ?? row.pnlPct),
      };
    });
  }

  async getOpenOrders(limit = 50): Promise<BrokerOrder[]> {
    const payload = await this.request<unknown>(`/api/v0/equity/orders?limit=${limit}`);
    const rows = findFirstArray(unwrapPayload(payload)) ?? [];
    return rows.map((row) => this.toBrokerOrder(row));
  }

  async listOrders(params?: BrokerOrderListParams): Promise<BrokerOrder[]> {
    const status = params?.status ?? "open";
    const limit = Math.max(1, params?.limit ?? 50);

    if (status === "open") {
      return this.getOpenOrders(limit);
    }

    const closedPayload = await this.request<unknown>(`/api/v0/equity/history/orders?limit=${limit}`);
    const closedRows = (findFirstArray(unwrapPayload(closedPayload)) ?? []).map((row) => this.toBrokerOrder(row));

    if (status === "closed") return closedRows;

    const openRows = await this.getOpenOrders(limit);
    const merged = [...openRows, ...closedRows];
    const seen = new Set<string>();
    return merged.filter((order) => {
      if (seen.has(order.id)) return false;
      seen.add(order.id);
      return true;
    }).slice(0, limit);
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    const paths = [
      `/api/v0/equity/orders/${encodeURIComponent(orderId)}`,
      `/api/v0/equity/history/orders/${encodeURIComponent(orderId)}`,
    ];

    let lastError: unknown;
    for (const path of paths) {
      try {
        const payload = await this.request<unknown>(path);
        return this.toBrokerOrder(payload);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Trading 212 order lookup failed");
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrder> {
    if (params.qty === undefined && params.notional === undefined) {
      throw new Error("Broker order requires either qty or notional");
    }
    if ((params.type === "limit" || params.type === "stop_limit") && params.limitPrice === undefined) {
      throw new Error("Trading 212 limit orders require limitPrice");
    }
    if ((params.type === "stop" || params.type === "stop_limit") && params.stopPrice === undefined) {
      throw new Error("Trading 212 stop orders require stopPrice");
    }

    // Kill-switch chokepoint — read-only, idempotent.
    if (isKillSwitchesEnabled()) {
      const decision = isExecutionAllowed({ venue: this.brokerId, instrument: params.symbol.toUpperCase() });
      if (!decision.allowed) {
        throw new Error(`${decision.reason}. Reset the relevant kill switch before placing this order.`);
      }
    }

    const payload: Record<string, unknown> = {
      ticker: params.symbol.toUpperCase(),
      side: params.side.toUpperCase(),
      timeValidity: mapTrading212TimeValidity(params.timeInForce),
    };

    if (params.qty !== undefined) payload.quantity = params.qty;
    if (params.notional !== undefined) payload.value = params.notional;
    if (params.limitPrice !== undefined) payload.limitPrice = params.limitPrice;
    if (params.stopPrice !== undefined) payload.stopPrice = params.stopPrice;

    const result = await this.request<unknown>(mapTrading212OrderPath(params.type), {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return this.toBrokerOrder(result);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request<void>(`/api/v0/equity/orders/${encodeURIComponent(orderId)}`, {
      method: "DELETE",
    });
  }

  async cancelAllOrders(): Promise<void> {
    const openOrders = await this.getOpenOrders(100);
    await Promise.all(openOrders.map((order) => this.cancelOrder(order.id)));
  }

  async getLatestQuote(symbol: string): Promise<BrokerQuote> {
    const upper = symbol.toUpperCase();

    let payload: unknown;
    try {
      payload = await this.request<unknown>(`/api/v0/equity/portfolio/${encodeURIComponent(upper)}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        throw error;
      }
      payload = await this.request<unknown>("/api/v0/equity/portfolio/ticker", {
        method: "POST",
        body: JSON.stringify({ tickers: [upper] }),
      });
    }

    const unwrapped = unwrapPayload(payload);
    const quoteRecord =
      asRecord(findFirstArray(unwrapped)?.[0])
      || asRecord(unwrapped)
      || {};

    const bid = parseNumber(quoteRecord.bid ?? quoteRecord.bidPrice ?? quoteRecord.lastPrice);
    const ask = parseNumber(quoteRecord.ask ?? quoteRecord.askPrice ?? quoteRecord.lastPrice);

    return {
      symbol: String(quoteRecord.ticker ?? quoteRecord.symbol ?? upper),
      bidPrice: bid,
      bidSize: parseNumber(quoteRecord.bidQuantity ?? quoteRecord.bidSize),
      askPrice: ask,
      askSize: parseNumber(quoteRecord.askQuantity ?? quoteRecord.askSize),
      timestamp: String(quoteRecord.updatedAt ?? quoteRecord.timestamp ?? new Date().toISOString()),
    };
  }

  async getHistoricalBars(_params: BrokerHistoricalBarsParams): Promise<Candle[]> {
    throw new Error("Trading 212 historical bars are not wired through Gordon yet.");
  }
}

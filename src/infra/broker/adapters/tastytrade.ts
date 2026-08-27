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

const DEFAULT_TASTYTRADE_LIVE_BASE_URL = "https://api.tastyworks.com";
const DEFAULT_TASTYTRADE_PAPER_BASE_URL = "https://api.cert.tastyworks.com";

const TASTYTRADE_CAPABILITIES: BrokerCapabilities = {
  supportsMarketOrders: true,
  supportsLimitOrders: true,
  supportsExtendedHours: false,
  supportsFractionalShares: false,
  supportsShortSelling: true,
  supportsOptions: true,
  supportsStreaming: true,
  supportsPaperTrading: true,
  supportsHistoricalBars: false,
};

function mapTastytradeOrderType(value: BrokerOrderRequest["type"]): string {
  switch (value) {
    case "limit":
      return "Limit";
    case "stop":
      return "Stop";
    case "stop_limit":
      return "Stop Limit";
    case "trailing_stop":
      throw new Error("tastytrade trailing stop orders are not wired through Gordon yet.");
    default:
      return "Market";
  }
}

function mapTastytradeTimeInForce(value: BrokerOrderRequest["timeInForce"]): string {
  switch (value) {
    case "gtc":
      return "GTC";
    case "ioc":
      return "IOC";
    case "fok":
      return "FOK";
    default:
      return "Day";
  }
}

function mapTastytradeAction(side: BrokerOrderRequest["side"]): string {
  return side === "sell" ? "Sell to Close" : "Buy to Open";
}

export class TastytradeAdapter implements BrokerAdapter {
  readonly brokerId: BrokerId = "tastytrade";
  readonly displayName = "tastytrade";
  readonly capabilities = TASTYTRADE_CAPABILITIES;

  readonly isPaper: boolean;
  private readonly credentials: BrokerCredentials;
  private readonly baseUrl: string;
  private accountIdCache?: string;
  private sessionToken?: string;

  constructor(credentials: BrokerCredentials) {
    this.credentials = credentials;
    this.isPaper = credentials.paper ?? true;
    this.baseUrl =
      credentials.baseUrl ||
      (this.isPaper ? DEFAULT_TASTYTRADE_PAPER_BASE_URL : DEFAULT_TASTYTRADE_LIVE_BASE_URL);
    this.accountIdCache = credentials.accountId;
  }

  private buildHeaders(initHeaders?: HeadersInit, includeAuth = true): Headers {
    const headers = new Headers(initHeaders);
    headers.set("accept", "application/json");
    if (includeAuth) {
      // OAuth mode: use Bearer token directly, no session needed.
      if (this.credentials.isOAuth && this.credentials.apiKey) {
        headers.set("authorization", `Bearer ${this.credentials.apiKey}`);
      } else if (this.sessionToken) {
        headers.set("session-token", this.sessionToken);
      }
    }
    return headers;
  }

  private async createSession(forceRefresh = false): Promise<string> {
    // OAuth mode skips the /sessions login — the bearer token is the auth.
    if (this.credentials.isOAuth) return this.credentials.apiKey;
    if (this.sessionToken && !forceRefresh) return this.sessionToken;

    const response = await fetch(new URL("/sessions", this.baseUrl).toString(), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        login: this.credentials.apiKey,
        password: this.credentials.apiSecret,
        "remember-me": true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const safeBody = redactString(body).slice(0, 500);
      const details = safeBody.trim() ? `: ${safeBody}` : "";
      throw new Error(
        `tastytrade session creation failed (${response.status} ${response.statusText})${details}`,
      );
    }

    const payload = (await response.json()) as unknown;
    const token = String(findFirstValue(payload, ["session-token", "sessionToken"]) ?? "").trim();
    if (!token) {
      throw new Error("tastytrade session token was missing from /sessions response");
    }

    this.sessionToken = token;
    return token;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    options: { auth?: boolean; retryOnAuth?: boolean } = {},
  ): Promise<T> {
    const auth = options.auth ?? true;
    const retryOnAuth = options.retryOnAuth ?? auth;

    if (auth) {
      await this.createSession();
    }

    const execute = async (allowRetry: boolean): Promise<T> => {
      const headers = this.buildHeaders(init?.headers, auth);
      if (init?.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }

      const response = await fetch(new URL(path, this.baseUrl).toString(), {
        ...init,
        headers,
      });

      if (
        response.status === 401 &&
        auth &&
        allowRetry &&
        retryOnAuth &&
        !this.credentials.isOAuth
      ) {
        this.sessionToken = undefined;
        await this.createSession(true);
        return execute(false);
      }

      if (!response.ok) {
        const body = await response.text();
        const safeBody = redactString(body).slice(0, 500);
        const details = safeBody.trim() ? `: ${safeBody}` : "";
        throw new Error(`tastytrade API ${response.status} ${response.statusText}${details}`);
      }

      if (response.status === 204) return undefined as T;
      const text = await response.text();
      if (!text) return undefined as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    };

    return execute(true);
  }

  private async requestCandidates<T>(
    paths: string[],
    init?: RequestInit,
    options?: { auth?: boolean; retryOnAuth?: boolean },
  ): Promise<T> {
    let lastError: unknown;
    for (const path of paths) {
      try {
        return await this.request<T>(path, init, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("tastytrade request failed");
  }

  private async resolveAccountId(): Promise<string> {
    if (this.accountIdCache) return this.accountIdCache;

    const payload = await this.request<unknown>("/customers/me/accounts");
    const root = unwrapPayload(payload);
    const rows = findFirstArray(root) ?? [];
    const first = rows.find(Boolean);
    const accountId = String(
      findFirstValue(first ?? root, [
        "account-number",
        "accountNumber",
        "account-number-short",
        "id",
      ]) ?? "",
    ).trim();

    if (!accountId) {
      throw new Error(
        "tastytrade account ID could not be resolved. Set TASTYTRADE_ACCOUNT_ID if needed.",
      );
    }

    this.accountIdCache = accountId;
    return accountId;
  }

  private toBrokerOrder(input: unknown): BrokerOrder {
    const raw = asRecord(unwrapPayload(input)) || {};
    const firstLeg = asRecord(findFirstArray(raw.legs)?.[0]) || {};
    return {
      id: String(raw.id ?? raw["order-id"] ?? raw.orderId ?? `order-${Date.now()}`),
      clientOrderId: String(raw["client-order-id"] ?? raw.clientOrderId ?? "").trim() || undefined,
      symbol: String(raw.symbol ?? raw["underlying-symbol"] ?? firstLeg.symbol ?? ""),
      side: normalizeSide(raw.side ?? raw.action ?? firstLeg.action),
      type: normalizeOrderType(raw["order-type"] ?? raw.orderType ?? raw.type),
      timeInForce: normalizeTimeInForce(raw["time-in-force"] ?? raw.timeInForce),
      status: normalizeOrderStatus(raw.status ?? raw.orderStatus),
      qty: parseNumber(raw.quantity ?? raw.qty ?? firstLeg.quantity),
      filledQty: parseNumber(raw["filled-quantity"] ?? raw.filledQty ?? raw.filledQuantity),
      notional: undefined,
      limitPrice: raw.price !== undefined ? parseNumber(raw.price) : undefined,
      stopPrice: raw["stop-trigger"] !== undefined ? parseNumber(raw["stop-trigger"]) : undefined,
      extendedHours: false,
      submittedAt:
        String(raw["received-at"] ?? raw.createdAt ?? raw.submittedAt ?? "").trim() || undefined,
      filledAt: String(raw["filled-at"] ?? raw.filledAt ?? "").trim() || undefined,
      canceledAt: String(raw["cancelled-at"] ?? raw.canceledAt ?? "").trim() || undefined,
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
      const payload = await this.request<unknown>("/market-sessions");
      const root = unwrapPayload(payload);
      const timestamp = String(
        findFirstValue(root, ["timestamp", "time", "dateTime"]) ?? new Date().toISOString(),
      );
      const isOpen = parseBoolean(
        findFirstValue(root, ["isOpen", "is-open", "open", "marketOpen"]),
      );
      const nextOpen = String(findFirstValue(root, ["nextOpen", "next-open"]) ?? timestamp);
      const nextClose = String(findFirstValue(root, ["nextClose", "next-close"]) ?? timestamp);
      return { timestamp, isOpen, nextOpen, nextClose };
    } catch {
      return buildUsMarketClockFallback();
    }
  }

  async getAccount(): Promise<BrokerAccount> {
    const accountId = await this.resolveAccountId();
    const payload = await this.request<unknown>(
      `/accounts/${encodeURIComponent(accountId)}/balances`,
    );
    const root = unwrapPayload(payload);

    return {
      id: String(findFirstValue(root, ["account-number", "accountNumber", "id"]) ?? accountId),
      status: String(
        findFirstValue(root, ["status", "account-status", "accountStatus"]) ?? "ACTIVE",
      ),
      currency: String(findFirstValue(root, ["currency", "base-currency"]) ?? "USD"),
      cash: parseNumber(findFirstValue(root, ["cash-balance", "cashBalance", "cash"])),
      buyingPower: parseNumber(
        findFirstValue(root, ["buying-power", "buyingPower", "availableFunds"]),
      ),
      portfolioValue: parseNumber(
        findFirstValue(root, ["net-liquidating-value", "netLiquidatingValue", "equity"]),
      ),
      patternDayTrader: parseBoolean(
        findFirstValue(root, ["is-pattern-day-trader", "patternDayTrader"]),
      ),
      shortingEnabled:
        parseBoolean(findFirstValue(root, ["shorting-enabled", "shortingEnabled", "canShort"])) ||
        true,
      tradingBlocked: parseBoolean(findFirstValue(root, ["is-closed", "tradingBlocked"])),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const accountId = await this.resolveAccountId();
    const payload = await this.request<unknown>(
      `/accounts/${encodeURIComponent(accountId)}/positions`,
    );
    const rows = findFirstArray(unwrapPayload(payload)) ?? [];

    return rows.map((entry) => {
      const row = asRecord(entry) || {};
      const qtyRaw = parseNumber(row.quantity ?? row.qty);
      return {
        symbol: String(row.symbol ?? row["underlying-symbol"] ?? row.ticker ?? ""),
        qty: Math.abs(qtyRaw),
        side: qtyRaw < 0 || parseBoolean(row.short) ? "short" : "long",
        marketValue: parseNumber(row["market-value"] ?? row.marketValue ?? row.value),
        avgEntryPrice: parseNumber(
          row["average-open-price"] ?? row.averagePrice ?? row.avgEntryPrice,
        ),
        unrealizedPl: parseNumber(row["unrealized-day-gain"] ?? row.unrealizedPl ?? row.pnl),
        unrealizedPlPercent: parseNumber(
          row["unrealized-day-gain-percent"] ?? row.unrealizedPlPercent ?? row.pnlPct,
        ),
      };
    });
  }

  async getOpenOrders(limit = 50): Promise<BrokerOrder[]> {
    const accountId = await this.resolveAccountId();
    const payload = await this.request<unknown>(
      `/accounts/${encodeURIComponent(accountId)}/orders/live?per-page=${limit}`,
    );
    const rows = findFirstArray(unwrapPayload(payload)) ?? [];
    return rows.map((row) => this.toBrokerOrder(row));
  }

  async listOrders(params?: BrokerOrderListParams): Promise<BrokerOrder[]> {
    const accountId = await this.resolveAccountId();
    const status = params?.status ?? "open";
    const limit = Math.max(1, params?.limit ?? 50);

    if (status === "open") {
      return this.getOpenOrders(limit);
    }

    const payload = await this.request<unknown>(
      `/accounts/${encodeURIComponent(accountId)}/orders?per-page=${limit}`,
    );
    const rows = (findFirstArray(unwrapPayload(payload)) ?? []).map((row) =>
      this.toBrokerOrder(row),
    );
    if (status === "all") return rows;
    return rows.filter((order) => !isOpenOrderStatus(order.status));
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    const accountId = await this.resolveAccountId();
    const payload = await this.request<unknown>(
      `/accounts/${encodeURIComponent(accountId)}/orders/${encodeURIComponent(orderId)}`,
    );
    return this.toBrokerOrder(payload);
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrder> {
    if (params.qty === undefined) {
      if (params.notional !== undefined) {
        throw new Error(
          "tastytrade orders require qty; notional-only equity orders are not supported.",
        );
      }
      throw new Error("Broker order requires either qty or notional");
    }
    if (
      (params.type === "limit" || params.type === "stop_limit") &&
      params.limitPrice === undefined
    ) {
      throw new Error("tastytrade limit orders require limitPrice");
    }
    if (
      (params.type === "stop" || params.type === "stop_limit") &&
      params.stopPrice === undefined
    ) {
      throw new Error("tastytrade stop orders require stopPrice");
    }

    // Kill-switch chokepoint — read-only, idempotent.
    if (isKillSwitchesEnabled()) {
      const decision = isExecutionAllowed({
        venue: this.brokerId,
        instrument: params.symbol.toUpperCase(),
      });
      if (!decision.allowed) {
        throw new Error(
          `${decision.reason}. Reset the relevant kill switch before placing this order.`,
        );
      }
    }

    const accountId = await this.resolveAccountId();
    const body: Record<string, unknown> = {
      "order-type": mapTastytradeOrderType(params.type),
      "time-in-force": mapTastytradeTimeInForce(params.timeInForce),
      legs: [
        {
          "instrument-type": "Equity",
          symbol: params.symbol.toUpperCase(),
          quantity: params.qty,
          action: mapTastytradeAction(params.side),
        },
      ],
    };

    if (params.type === "limit" || params.type === "stop_limit") {
      body.price = params.limitPrice;
      body["price-effect"] = params.side === "buy" ? "Debit" : "Credit";
    }
    if (params.type === "stop" || params.type === "stop_limit") {
      body["stop-trigger"] = params.stopPrice;
    }

    const payload = await this.request<unknown>(
      `/accounts/${encodeURIComponent(accountId)}/orders`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    return this.toBrokerOrder(payload);
  }

  async cancelOrder(orderId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.request<void>(
      `/accounts/${encodeURIComponent(accountId)}/orders/${encodeURIComponent(orderId)}`,
      {
        method: "DELETE",
      },
    );
  }

  async cancelAllOrders(): Promise<void> {
    const openOrders = await this.getOpenOrders(100);
    await Promise.all(openOrders.map((order) => this.cancelOrder(order.id)));
  }

  async getLatestQuote(symbol: string): Promise<BrokerQuote> {
    const upper = symbol.toUpperCase();
    const payload = await this.requestCandidates<unknown>([
      `/market-data/quotes/${encodeURIComponent(upper)}`,
      `/market-data/quotes?symbols=${encodeURIComponent(upper)}`,
    ]);
    const unwrapped = unwrapPayload(payload);
    const quoteRecord = asRecord(findFirstArray(unwrapped)?.[0]) || asRecord(unwrapped) || {};

    return {
      symbol: String(quoteRecord.symbol ?? quoteRecord.ticker ?? upper),
      bidPrice: parseNumber(quoteRecord["bid-price"] ?? quoteRecord.bidPrice ?? quoteRecord.bid),
      bidSize: parseNumber(quoteRecord["bid-size"] ?? quoteRecord.bidSize),
      askPrice: parseNumber(quoteRecord["ask-price"] ?? quoteRecord.askPrice ?? quoteRecord.ask),
      askSize: parseNumber(quoteRecord["ask-size"] ?? quoteRecord.askSize),
      timestamp: String(
        quoteRecord["quote-time"] ?? quoteRecord.timestamp ?? new Date().toISOString(),
      ),
    };
  }

  async getHistoricalBars(_params: BrokerHistoricalBarsParams): Promise<Candle[]> {
    throw new Error("tastytrade historical bars are not wired through Gordon yet.");
  }
}

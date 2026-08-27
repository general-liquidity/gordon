/**
 * Shared REST broker adapter base for B2C stock brokers.
 *
 * This provides a resilient "best effort" normalization layer over diverse
 * broker payloads and endpoint variants while keeping the Gordon broker
 * interface stable.
 */

import { Buffer } from "node:buffer";
import type { Candle } from "../../../types/index.ts";
import { TokenManager, type TokenConfig } from "../auth/tokenRefresh.ts";
import { isKillSwitchesEnabled, isExecutionAllowed } from "../../safety/killSwitches.ts";
import { redactString } from "../../platform/observability/valueRedaction.ts";
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

type AuthStyle = "bearer" | "basic" | "none";

export interface RestBrokerAdapterConfig {
  brokerId: BrokerId;
  displayName: string;
  capabilities: BrokerCapabilities;
  authStyle: AuthStyle;
  defaultLiveBaseUrl: string;
  defaultPaperBaseUrl?: string;
  defaultLiveDataBaseUrl?: string;
  defaultPaperDataBaseUrl?: string;
  accountDiscoveryPaths: string[];
  clockPaths: string[];
  accountPaths: string[];
  positionsPaths: string[];
  openOrdersPaths?: string[];
  listOrdersPaths: string[];
  getOrderPaths: string[];
  placeOrderPaths: string[];
  cancelOrderPaths: string[];
  cancelAllOrdersPaths?: string[];
  quotePaths: string[];
  staticHeaders?: Record<string, string>;
  mapStatusParam?: (status: "open" | "closed" | "all") => string;
  buildPlaceOrderBody?: (input: { params: BrokerOrderRequest; accountId: string }) => {
    body: BodyInit;
    contentType?: string;
  };
}

/** Thrown when a broker order payload is missing required fields or carries
 *  non-finite numeric fields — the caller must fail loud rather than act on a
 *  fabricated zero quantity / price. */
export class MalformedBrokerOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedBrokerOrderError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Coerce a present numeric broker field to a finite number or throw. */
function requireFiniteBrokerField(value: unknown, field: string, brokerLabel: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new MalformedBrokerOrderError(
      `${brokerLabel} order response has non-finite '${field}' (got ${String(value)})`,
    );
  }
  return n;
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

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function findFirstValue(input: unknown, candidateKeys: string[]): unknown {
  const wanted = new Set(candidateKeys.map(normalizeFieldName));
  const queue: unknown[] = [input];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const record = asRecord(current);
    if (!record) continue;

    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(normalizeFieldName(key))) {
        return value;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return undefined;
}

function findFirstArray(input: unknown): unknown[] | null {
  const queue: unknown[] = [input];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      return current;
    }

    const record = asRecord(current);
    if (!record) continue;
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

function unwrapPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return payload;

  const wrappers = ["data", "result", "response", "payload", "output"];
  for (const key of wrappers) {
    if (record[key] !== undefined) return record[key];
  }

  return payload;
}

function normalizeOrderType(value: unknown): BrokerOrderType {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
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

function normalizeTimeInForce(value: unknown): BrokerTimeInForce {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  switch (normalized) {
    case "day":
    case "gtc":
    case "opg":
    case "cls":
    case "ioc":
    case "fok":
      return normalized;
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
      return normalized === "cancelled" ? "canceled" : normalized;
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
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "sell" || normalized === "s") return "sell";
  return "buy";
}

function fallbackClock(): BrokerClock {
  const now = new Date();
  const open = new Date(now);
  const close = new Date(now);
  open.setUTCHours(14, 30, 0, 0);
  close.setUTCHours(21, 0, 0, 0);

  const isOpen = now >= open && now <= close;
  const nextOpen = new Date(open);
  const nextClose = new Date(close);

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

function buildDefaultOrderBody(
  params: BrokerOrderRequest,
  accountId: string,
): { body: BodyInit; contentType: string } {
  const payload: Record<string, unknown> = {
    accountId,
    account_id: accountId,
    symbol: params.symbol.toUpperCase(),
    side: params.side,
    type: params.type,
    orderType: params.type,
    timeInForce: params.timeInForce,
    time_in_force: params.timeInForce,
    duration: params.timeInForce,
    extendedHours: params.extendedHours ?? false,
    clientOrderId: params.clientOrderId,
    client_order_id: params.clientOrderId,
  };

  if (params.qty !== undefined) {
    payload.qty = params.qty;
    payload.quantity = params.qty;
  }
  if (params.notional !== undefined) payload.notional = params.notional;
  if (params.limitPrice !== undefined) {
    payload.limitPrice = params.limitPrice;
    payload.price = params.limitPrice;
  }
  if (params.stopPrice !== undefined) payload.stopPrice = params.stopPrice;
  if (params.trailPercent !== undefined) payload.trailPercent = params.trailPercent;
  if (params.trailPrice !== undefined) payload.trailPrice = params.trailPrice;

  return {
    body: JSON.stringify(payload),
    contentType: "application/json",
  };
}

export class RestBrokerAdapter implements BrokerAdapter {
  readonly brokerId: BrokerId;
  readonly displayName: string;
  readonly capabilities: BrokerCapabilities;
  readonly isPaper: boolean;

  protected readonly credentials: BrokerCredentials;
  private readonly config: RestBrokerAdapterConfig;
  private readonly baseUrl: string;
  private readonly dataBaseUrl: string;
  private accountIdCache?: string;

  /** Token manager for automatic OAuth2 token refresh (bearer auth only). */
  protected readonly tokenManager: TokenManager | null;

  constructor(credentials: BrokerCredentials, config: RestBrokerAdapterConfig) {
    this.credentials = credentials;
    this.config = config;
    this.brokerId = config.brokerId;
    this.displayName = config.displayName;
    this.capabilities = config.capabilities;

    const paper = credentials.paper ?? true;
    this.isPaper = paper;
    this.baseUrl =
      credentials.baseUrl ||
      (paper && config.defaultPaperBaseUrl
        ? config.defaultPaperBaseUrl
        : config.defaultLiveBaseUrl);
    this.dataBaseUrl =
      credentials.dataBaseUrl ||
      (paper && config.defaultPaperDataBaseUrl
        ? config.defaultPaperDataBaseUrl
        : config.defaultLiveDataBaseUrl || this.baseUrl);
    this.accountIdCache = credentials.accountId;

    // Initialize token manager for bearer auth when OAuth2 credentials are available.
    if (config.authStyle === "bearer") {
      const tokenConfig: TokenConfig = {
        accessToken: credentials.apiKey,
        refreshToken: credentials.refreshToken,
        tokenEndpoint: credentials.tokenEndpoint,
        clientId: credentials.oauthClientId ?? credentials.apiKey,
        clientSecret: credentials.oauthClientSecret ?? credentials.apiSecret,
      };

      if (credentials.tokenExpiresIn) {
        tokenConfig.expiresAt = Date.now() + credentials.tokenExpiresIn * 1000;
      }

      this.tokenManager = new TokenManager(tokenConfig);
    } else {
      this.tokenManager = null;
    }
  }

  protected renderPath(
    template: string,
    vars: Record<string, string | number | undefined>,
  ): string {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      const value = vars[key];
      if (value === undefined || value === null) return "";
      return encodeURIComponent(String(value));
    });
  }

  private buildHeaders(initHeaders?: HeadersInit, bearerToken?: string): Headers {
    const headers = new Headers(initHeaders);
    headers.set("accept", "application/json");

    if (this.config.authStyle === "bearer") {
      const token = bearerToken ?? this.credentials.apiKey;
      headers.set("authorization", `Bearer ${token}`);
    } else if (this.config.authStyle === "basic") {
      const token = Buffer.from(
        `${this.credentials.apiKey}:${this.credentials.apiSecret}`,
      ).toString("base64");
      headers.set("authorization", `Basic ${token}`);
    } else if (this.config.authStyle === "none" && this.credentials.apiKey) {
      headers.set("x-api-key", this.credentials.apiKey);
    }

    if (this.config.staticHeaders) {
      for (const [key, value] of Object.entries(this.config.staticHeaders)) {
        headers.set(key, value);
      }
    }

    return headers;
  }

  protected async request<T>(
    path: string,
    init?: RequestInit,
    options?: { dataApi?: boolean },
  ): Promise<T> {
    const base = options?.dataApi ? this.dataBaseUrl : this.baseUrl;
    const url = new URL(path, base).toString();

    // Ensure bearer token is fresh before sending the request.
    const bearerToken = this.tokenManager ? await this.tokenManager.ensureValidToken() : undefined;
    const headers = this.buildHeaders(init?.headers, bearerToken);

    if (init?.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      const body = await response.text();
      const safeBody = redactString(body).slice(0, 500);
      const details = safeBody.trim().length > 0 ? `: ${safeBody}` : "";
      throw new Error(
        `${this.displayName} API ${response.status} ${response.statusText}${details}`,
      );
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;

    try {
      const parsed = JSON.parse(text) as unknown;
      return unwrapPayload(parsed) as T;
    } catch {
      return text as T;
    }
  }

  protected async requestCandidates<T>(
    paths: string[],
    vars: Record<string, string | number | undefined>,
    init?: RequestInit,
    options?: { dataApi?: boolean },
  ): Promise<T> {
    let lastError: unknown;
    for (const template of paths) {
      try {
        const path = this.renderPath(template, vars);
        return await this.request<T>(path, init, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${this.displayName} request failed`);
  }

  protected async resolveAccountId(): Promise<string> {
    if (this.accountIdCache) return this.accountIdCache;

    const payload = await this.requestCandidates<unknown>(
      this.config.accountDiscoveryPaths,
      {},
      undefined,
      { dataApi: false },
    );

    const directId = findFirstValue(payload, [
      "accountId",
      "account_id",
      "accountNumber",
      "account_number",
      "accountIdKey",
      "acctId",
      "id",
      "hashValue",
      "securitiesAccountNumber",
      "account-number",
    ]);
    const accountId = String(directId ?? "").trim();

    if (!accountId) {
      throw new Error(
        `${this.displayName} account ID could not be resolved. Set accountId in broker config.`,
      );
    }

    this.accountIdCache = accountId;
    return accountId;
  }

  protected toBrokerOrder(input: unknown): BrokerOrder {
    const raw = asRecord(input) || {};

    const id = String(
      raw.id ??
        raw.orderId ??
        raw.order_id ??
        raw.orderid ??
        raw.order_id_key ??
        raw.referenceNumber ??
        "",
    ).trim();
    if (id.length === 0) {
      throw new MalformedBrokerOrderError(
        `${this.displayName} order response is missing an order id`,
      );
    }
    if (
      raw.status === undefined &&
      raw.orderStatus === undefined &&
      raw.order_status === undefined
    ) {
      throw new MalformedBrokerOrderError(
        `${this.displayName} order response is missing status (order ${id})`,
      );
    }

    const limitPriceRaw = raw.limitPrice !== undefined ? raw.limitPrice : raw.price;

    return {
      id,
      clientOrderId:
        String(raw.clientOrderId ?? raw.client_order_id ?? raw.clientOrderID ?? "").trim() ||
        undefined,
      symbol: String(raw.symbol ?? raw.ticker ?? raw.security ?? raw.instrument ?? ""),
      side: normalizeSide(raw.side ?? raw.orderAction ?? raw.action),
      type: normalizeOrderType(raw.type ?? raw.orderType ?? raw.order_type),
      timeInForce: normalizeTimeInForce(
        raw.timeInForce ?? raw.tif ?? raw.duration ?? raw.orderTerm,
      ),
      status: normalizeOrderStatus(raw.status ?? raw.orderStatus ?? raw.order_status),
      qty: requireFiniteBrokerField(
        raw.qty ?? raw.quantity ?? raw.orderQty ?? raw.totalQuantity ?? 0,
        "qty",
        this.displayName,
      ),
      filledQty: requireFiniteBrokerField(
        raw.filledQty ?? raw.filled_quantity ?? raw.executedQuantity ?? raw.filledQuantity ?? 0,
        "filledQty",
        this.displayName,
      ),
      notional: raw.notional !== undefined ? parseNumber(raw.notional) : undefined,
      limitPrice:
        limitPriceRaw !== undefined
          ? requireFiniteBrokerField(limitPriceRaw, "limitPrice", this.displayName)
          : undefined,
      stopPrice: raw.stopPrice !== undefined ? parseNumber(raw.stopPrice) : undefined,
      extendedHours: parseBoolean(raw.extendedHours ?? raw.outsideRth ?? raw.marketSession),
      submittedAt:
        String(raw.submittedAt ?? raw.createdAt ?? raw.orderDate ?? raw.enteredTime ?? "").trim() ||
        undefined,
      filledAt:
        String(raw.filledAt ?? raw.closeTime ?? raw.executionTime ?? "").trim() || undefined,
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
      const payload = await this.requestCandidates<unknown>(this.config.clockPaths, {});
      const timestamp = String(
        findFirstValue(payload, ["timestamp", "time", "dateTime", "serverTime"]) ||
          new Date().toISOString(),
      );
      const isOpen = parseBoolean(
        findFirstValue(payload, ["isOpen", "is_open", "open", "marketOpen"]),
      );
      const nextOpen = String(
        findFirstValue(payload, ["nextOpen", "next_open", "nextOpeningTime"]) || timestamp,
      );
      const nextClose = String(
        findFirstValue(payload, ["nextClose", "next_close", "nextClosingTime"]) || timestamp,
      );
      return { timestamp, isOpen, nextOpen, nextClose };
    } catch {
      return fallbackClock();
    }
  }

  async getAccount(): Promise<BrokerAccount> {
    const accountId = await this.resolveAccountId();
    const payload = await this.requestCandidates<unknown>(this.config.accountPaths, { accountId });

    const id = String(
      findFirstValue(payload, [
        "accountId",
        "account_id",
        "accountNumber",
        "account_number",
        "id",
      ]) || accountId,
    );
    const status = String(
      findFirstValue(payload, ["status", "accountStatus", "state"]) || "active",
    );
    const currency = String(findFirstValue(payload, ["currency", "baseCurrency"]) || "USD");
    const cash = parseNumber(
      findFirstValue(payload, ["cash", "cashBalance", "cashAvailableForTrading", "cashAvailable"]),
    );
    const buyingPower = parseNumber(
      findFirstValue(payload, [
        "buyingPower",
        "buying_power",
        "dayTradingBuyingPower",
        "availableFunds",
      ]),
    );
    const portfolioValue = parseNumber(
      findFirstValue(payload, ["portfolioValue", "netLiquidationValue", "totalValue", "equity"]),
    );
    const patternDayTrader = parseBoolean(
      findFirstValue(payload, ["patternDayTrader", "isDayTrader", "dayTrader"]),
    );
    const shortingEnabled = parseBoolean(
      findFirstValue(payload, ["shortingEnabled", "shortEnabled", "canShort"]),
    );
    const tradingBlocked = parseBoolean(
      findFirstValue(payload, ["tradingBlocked", "isBlocked", "tradeBlocked"]),
    );

    return {
      id,
      status,
      currency,
      cash,
      buyingPower,
      portfolioValue,
      patternDayTrader,
      shortingEnabled,
      tradingBlocked,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const accountId = await this.resolveAccountId();
    const payload = await this.requestCandidates<unknown>(this.config.positionsPaths, {
      accountId,
    });
    const positionsRaw =
      (findFirstValue(payload, ["positions", "position", "securitiesAccountPositions"]) as
        | unknown[]
        | undefined) ??
      findFirstArray(payload) ??
      [];

    return positionsRaw.map((entry) => {
      const row = asRecord(entry) || {};
      const qtyRaw = parseNumber(row.qty ?? row.quantity ?? row.longQuantity ?? row.position);
      const side: "long" | "short" = qtyRaw < 0 || parseBoolean(row.short) ? "short" : "long";
      return {
        symbol: String(row.symbol ?? row.ticker ?? row.instrument ?? row.security ?? ""),
        qty: Math.abs(qtyRaw),
        side,
        marketValue: parseNumber(row.marketValue ?? row.market_value ?? row.currentValue),
        avgEntryPrice: parseNumber(row.avgEntryPrice ?? row.averagePrice ?? row.costBasisPrice),
        unrealizedPl: parseNumber(
          row.unrealizedPl ?? row.unrealizedPnl ?? row.unrealizedProfitLoss,
        ),
        unrealizedPlPercent: parseNumber(
          row.unrealizedPlPercent ?? row.unrealizedPnlPercent ?? row.unrealizedProfitLossPercent,
        ),
      };
    });
  }

  async getOpenOrders(limit = 50): Promise<BrokerOrder[]> {
    const accountId = await this.resolveAccountId();
    if (this.config.openOrdersPaths && this.config.openOrdersPaths.length > 0) {
      const payload = await this.requestCandidates<unknown>(this.config.openOrdersPaths, {
        accountId,
        limit,
        status: "open",
      });
      const rows = (findFirstArray(payload) ?? []) as unknown[];
      return rows.map((row) => this.toBrokerOrder(row));
    }

    return this.listOrders({ status: "open", limit });
  }

  async listOrders(params?: BrokerOrderListParams): Promise<BrokerOrder[]> {
    const accountId = await this.resolveAccountId();
    const status = params?.status || "open";
    const mappedStatus = this.config.mapStatusParam ? this.config.mapStatusParam(status) : status;
    const limit = params?.limit || 50;
    const payload = await this.requestCandidates<unknown>(this.config.listOrdersPaths, {
      accountId,
      status: mappedStatus,
      limit,
    });

    const rows =
      (findFirstValue(payload, ["orders", "orderStrategies", "order"]) as unknown[] | undefined) ??
      findFirstArray(payload) ??
      [];
    return rows.map((row) => this.toBrokerOrder(row));
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    const accountId = await this.resolveAccountId();
    const payload = await this.requestCandidates<unknown>(this.config.getOrderPaths, {
      accountId,
      orderId,
    });

    const rows = findFirstArray(payload);
    if (rows && rows.length > 0) {
      const exact = rows.find(
        (row) => String(findFirstValue(row, ["id", "orderId", "order_id"])) === orderId,
      );
      return this.toBrokerOrder(exact ?? rows[0]);
    }

    return this.toBrokerOrder(payload);
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrder> {
    if (params.qty === undefined && params.notional === undefined) {
      throw new Error("Broker order requires either qty or notional");
    }

    // Kill-switch chokepoint — read-only, idempotent. Rejects orders that
    // reach the adapter while a venue/instrument/firm switch is tripped.
    if (isKillSwitchesEnabled()) {
      const decision = isExecutionAllowed({
        venue: this.config.brokerId,
        instrument: params.symbol.toUpperCase(),
      });
      if (!decision.allowed) {
        throw new Error(
          `${decision.reason}. Reset the relevant kill switch before placing this order.`,
        );
      }
    }

    const accountId = await this.resolveAccountId();
    const built = this.config.buildPlaceOrderBody
      ? this.config.buildPlaceOrderBody({ params, accountId })
      : buildDefaultOrderBody(params, accountId);

    const payload = await this.requestCandidates<unknown>(
      this.config.placeOrderPaths,
      { accountId },
      {
        method: "POST",
        headers: built.contentType ? { "content-type": built.contentType } : undefined,
        body: built.body,
      },
    );

    const rows = findFirstArray(payload);
    if (rows && rows.length > 0) return this.toBrokerOrder(rows[0]);
    return this.toBrokerOrder(payload);
  }

  async cancelOrder(orderId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.requestCandidates<void>(
      this.config.cancelOrderPaths,
      { accountId, orderId },
      { method: "DELETE" },
    );
  }

  async cancelAllOrders(): Promise<void> {
    const accountId = await this.resolveAccountId();
    if (this.config.cancelAllOrdersPaths && this.config.cancelAllOrdersPaths.length > 0) {
      await this.requestCandidates<void>(
        this.config.cancelAllOrdersPaths,
        { accountId },
        { method: "DELETE" },
      );
      return;
    }

    const openOrders = await this.getOpenOrders(100);
    await Promise.all(openOrders.map((order) => this.cancelOrder(order.id)));
  }

  async getLatestQuote(symbol: string): Promise<BrokerQuote> {
    const upper = symbol.toUpperCase();
    const payload = await this.requestCandidates<unknown>(
      this.config.quotePaths,
      { symbol: upper },
      undefined,
      { dataApi: true },
    );

    const quotesValue = findFirstValue(payload, ["quotes", "quote", "data"]);
    const quoteRecord =
      asRecord(quotesValue) ||
      asRecord(findFirstArray(quotesValue)?.[0]) ||
      asRecord(findFirstArray(payload)?.[0]) ||
      asRecord(payload) ||
      {};

    return {
      symbol: String(quoteRecord.symbol ?? quoteRecord.ticker ?? upper),
      bidPrice: parseNumber(quoteRecord.bidPrice ?? quoteRecord.bid ?? quoteRecord.bp),
      bidSize: parseNumber(quoteRecord.bidSize ?? quoteRecord.bid_size ?? quoteRecord.bs),
      askPrice: parseNumber(quoteRecord.askPrice ?? quoteRecord.ask ?? quoteRecord.ap),
      askSize: parseNumber(quoteRecord.askSize ?? quoteRecord.ask_size ?? quoteRecord.as),
      timestamp: String(
        quoteRecord.timestamp ??
          quoteRecord.time ??
          quoteRecord.quoteTime ??
          new Date().toISOString(),
      ),
    };
  }

  async getHistoricalBars(_params: BrokerHistoricalBarsParams): Promise<Candle[]> {
    throw new Error(
      `${this.displayName} does not expose normalized historical bars in Gordon yet.`,
    );
  }
}

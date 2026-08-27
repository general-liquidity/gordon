/**
 * Alpaca Broker Adapter
 * Implements the broker abstraction for Alpaca's Trading + Market Data APIs.
 */

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
import { isKillSwitchesEnabled, isExecutionAllowed } from "../../safety/killSwitches.ts";
import { redactString } from "../../platform/observability/valueRedaction.ts";

const DEFAULT_ALPACA_TRADING_BASE_URL = "https://api.alpaca.markets";
const DEFAULT_ALPACA_PAPER_TRADING_BASE_URL = "https://paper-api.alpaca.markets";
const DEFAULT_ALPACA_DATA_BASE_URL = "https://data.alpaca.markets";
const DEFAULT_ALPACA_PAPER_DATA_BASE_URL = "https://data.sandbox.alpaca.markets";

interface AlpacaClockResponse {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

interface AlpacaAccountResponse {
  id: string;
  status: string;
  currency: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  shorting_enabled: boolean;
  trading_blocked: boolean;
}

interface AlpacaPositionResponse {
  symbol: string;
  qty: string;
  side: "long" | "short";
  market_value: string;
  avg_entry_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
}

interface AlpacaOrderResponse {
  id: string;
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  time_in_force: string;
  status: string;
  qty?: string;
  filled_qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  extended_hours?: boolean;
  submitted_at?: string;
  filled_at?: string;
  canceled_at?: string;
}

interface AlpacaOrderRequestBody {
  symbol: string;
  side: "buy" | "sell";
  type: BrokerOrderType;
  time_in_force: BrokerTimeInForce;
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  trail_percent?: string;
  trail_price?: string;
  extended_hours?: boolean;
  client_order_id?: string;
}

interface AlpacaLatestQuoteResponse {
  quote: {
    ap: number;
    as: number;
    bp: number;
    bs: number;
    t: string;
  };
  symbol: string;
}

interface AlpacaBarsResponse {
  bars: Record<
    string,
    Array<{
      t: string;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
    }>
  >;
}

const ALPACA_TIMEFRAME_MAP: Record<string, string> = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "30m": "30Min",
  "1h": "1Hour",
  "1d": "1Day",
};

function parseNumber(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOrderType(value: string): BrokerOrderType {
  switch (value) {
    case "market":
    case "limit":
    case "stop":
    case "stop_limit":
    case "trailing_stop":
      return value;
    default:
      return "market";
  }
}

function normalizeTimeInForce(value: string): BrokerTimeInForce {
  switch (value) {
    case "day":
    case "gtc":
    case "opg":
    case "cls":
    case "ioc":
    case "fok":
      return value;
    default:
      return "day";
  }
}

function normalizeOrderStatus(value: string): BrokerOrderStatus {
  switch (value) {
    case "new":
    case "accepted":
    case "partially_filled":
    case "filled":
    case "done_for_day":
    case "canceled":
    case "expired":
    case "replaced":
    case "pending_cancel":
    case "pending_replace":
    case "pending_new":
    case "rejected":
    case "stopped":
    case "suspended":
    case "calculated":
      return value;
    default:
      return "unknown";
  }
}

/**
 * Alpaca adapter implementation.
 */
export class AlpacaAdapter implements BrokerAdapter {
  readonly brokerId: BrokerId = "alpaca";
  readonly displayName = "Alpaca";
  readonly capabilities: BrokerCapabilities = {
    supportsMarketOrders: true,
    supportsLimitOrders: true,
    supportsExtendedHours: true,
    supportsFractionalShares: true,
    supportsShortSelling: true,
    supportsOptions: true,
    supportsStreaming: true,
    supportsPaperTrading: true,
    supportsHistoricalBars: true,
  };

  readonly isPaper: boolean;
  private readonly credentials: BrokerCredentials;
  private readonly tradingBaseUrl: string;
  private readonly dataBaseUrl: string;

  constructor(credentials: BrokerCredentials) {
    this.credentials = credentials;

    const paper = credentials.paper ?? true;
    this.isPaper = paper;
    this.tradingBaseUrl =
      credentials.baseUrl ||
      (paper ? DEFAULT_ALPACA_PAPER_TRADING_BASE_URL : DEFAULT_ALPACA_TRADING_BASE_URL);
    this.dataBaseUrl =
      credentials.dataBaseUrl ||
      (paper ? DEFAULT_ALPACA_PAPER_DATA_BASE_URL : DEFAULT_ALPACA_DATA_BASE_URL);
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    options?: { dataApi?: boolean },
  ): Promise<T> {
    const baseUrl = options?.dataApi ? this.dataBaseUrl : this.tradingBaseUrl;
    const url = `${baseUrl}${path}`;

    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    headers.set("APCA-API-KEY-ID", this.credentials.apiKey);
    headers.set("APCA-API-SECRET-KEY", this.credentials.apiSecret);
    if (init?.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await response.text();
      const safeBody = redactString(body).slice(0, 500);
      const details = safeBody.trim().length > 0 ? `: ${safeBody}` : "";
      throw new Error(`Alpaca API ${response.status} ${response.statusText}${details}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
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
    const clock = await this.request<AlpacaClockResponse>("/v2/clock");
    return {
      timestamp: clock.timestamp,
      isOpen: clock.is_open,
      nextOpen: clock.next_open,
      nextClose: clock.next_close,
    };
  }

  async getAccount(): Promise<BrokerAccount> {
    const account = await this.request<AlpacaAccountResponse>("/v2/account");
    return {
      id: account.id,
      status: account.status,
      currency: account.currency,
      cash: parseNumber(account.cash),
      buyingPower: parseNumber(account.buying_power),
      portfolioValue: parseNumber(account.portfolio_value),
      patternDayTrader: account.pattern_day_trader,
      shortingEnabled: account.shorting_enabled,
      tradingBlocked: account.trading_blocked,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const positions = await this.request<AlpacaPositionResponse[]>("/v2/positions");
    return positions.map((position) => ({
      symbol: position.symbol,
      qty: parseNumber(position.qty),
      side: position.side,
      marketValue: parseNumber(position.market_value),
      avgEntryPrice: parseNumber(position.avg_entry_price),
      unrealizedPl: parseNumber(position.unrealized_pl),
      unrealizedPlPercent: parseNumber(position.unrealized_plpc),
    }));
  }

  async getOpenOrders(limit = 50): Promise<BrokerOrder[]> {
    return this.listOrders({ status: "open", limit });
  }

  async listOrders(params?: BrokerOrderListParams): Promise<BrokerOrder[]> {
    const query = new URLSearchParams();

    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.direction) query.set("direction", params.direction);
    if (params?.after) query.set("after", params.after);
    if (params?.until) query.set("until", params.until);
    if (params?.symbols && params.symbols.length > 0) {
      query.set("symbols", params.symbols.join(","));
    }

    const queryString = query.toString();
    const path = `/v2/orders${queryString ? `?${queryString}` : ""}`;
    const orders = await this.request<AlpacaOrderResponse[]>(path);
    return orders.map((order) => this.toBrokerOrder(order));
  }

  async getOrder(orderId: string): Promise<BrokerOrder> {
    const order = await this.request<AlpacaOrderResponse>(
      `/v2/orders/${encodeURIComponent(orderId)}`,
    );
    return this.toBrokerOrder(order);
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrder> {
    if (params.qty === undefined && params.notional === undefined) {
      throw new Error("Broker order requires either qty or notional");
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

    const body: AlpacaOrderRequestBody = {
      symbol: params.symbol.toUpperCase(),
      side: params.side,
      type: params.type,
      time_in_force: params.timeInForce,
      qty: params.qty !== undefined ? String(params.qty) : undefined,
      notional: params.notional !== undefined ? String(params.notional) : undefined,
      limit_price: params.limitPrice !== undefined ? String(params.limitPrice) : undefined,
      stop_price: params.stopPrice !== undefined ? String(params.stopPrice) : undefined,
      trail_percent: params.trailPercent !== undefined ? String(params.trailPercent) : undefined,
      trail_price: params.trailPrice !== undefined ? String(params.trailPrice) : undefined,
      extended_hours: params.extendedHours,
      client_order_id: params.clientOrderId,
    };

    const order = await this.request<AlpacaOrderResponse>("/v2/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return this.toBrokerOrder(order);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request<void>(`/v2/orders/${encodeURIComponent(orderId)}`, {
      method: "DELETE",
    });
  }

  async cancelAllOrders(): Promise<void> {
    await this.request<void>("/v2/orders", {
      method: "DELETE",
    });
  }

  async getLatestQuote(symbol: string): Promise<BrokerQuote> {
    const response = await this.request<AlpacaLatestQuoteResponse>(
      `/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/quotes/latest`,
      undefined,
      { dataApi: true },
    );

    return {
      symbol: response.symbol,
      bidPrice: response.quote.bp,
      bidSize: response.quote.bs,
      askPrice: response.quote.ap,
      askSize: response.quote.as,
      timestamp: response.quote.t,
    };
  }

  async getHistoricalBars(params: BrokerHistoricalBarsParams): Promise<Candle[]> {
    const timeframe = ALPACA_TIMEFRAME_MAP[params.timeframe];
    if (!timeframe) {
      throw new Error(`Alpaca historical bars do not support timeframe '${params.timeframe}'.`);
    }

    const url = new URL("/v2/stocks/bars", this.dataBaseUrl);
    url.searchParams.set("symbols", params.symbol.toUpperCase());
    url.searchParams.set("timeframe", timeframe);
    url.searchParams.set("start", new Date(params.startTime).toISOString());
    url.searchParams.set("end", new Date(params.endTime).toISOString());
    url.searchParams.set("adjustment", "raw");
    url.searchParams.set("limit", String(Math.min(params.limit ?? 10000, 10000)));

    const response = await this.request<AlpacaBarsResponse>(
      `${url.pathname}${url.search}`,
      undefined,
      { dataApi: true },
    );

    const bars = response.bars?.[params.symbol.toUpperCase()] ?? [];
    return bars.map((bar) => {
      const openTime = Date.parse(bar.t);
      return {
        openTime,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        closeTime: openTime,
      };
    });
  }

  private toBrokerOrder(order: AlpacaOrderResponse): BrokerOrder {
    return {
      id: order.id,
      clientOrderId: order.client_order_id || undefined,
      symbol: order.symbol,
      side: order.side,
      type: normalizeOrderType(order.type),
      timeInForce: normalizeTimeInForce(order.time_in_force),
      status: normalizeOrderStatus(order.status),
      qty: parseNumber(order.qty),
      filledQty: parseNumber(order.filled_qty),
      notional: order.notional !== undefined ? parseNumber(order.notional) : undefined,
      limitPrice: order.limit_price !== undefined ? parseNumber(order.limit_price) : undefined,
      stopPrice: order.stop_price !== undefined ? parseNumber(order.stop_price) : undefined,
      extendedHours: order.extended_hours ?? false,
      submittedAt: order.submitted_at,
      filledAt: order.filled_at,
      canceledAt: order.canceled_at,
    };
  }
}

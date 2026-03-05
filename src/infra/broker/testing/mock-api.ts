import type { BrokerId } from "../types.ts";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export type MockBrokerOperation =
  | "oauthToken"
  | "accountDiscovery"
  | "clock"
  | "account"
  | "positions"
  | "listOrders"
  | "getOrder"
  | "placeOrder"
  | "cancelOrder"
  | "cancelAll"
  | "quote"
  | "unknown";

interface BrokerPathRules {
  oauthToken?: RegExp[];
  accountDiscovery: RegExp[];
  clock: RegExp[];
  account: RegExp[];
  positions: RegExp[];
  listOrders: RegExp[];
  getOrder: RegExp[];
  placeOrder: RegExp[];
  cancelOrder: RegExp[];
  cancelAll: RegExp[];
  quote: RegExp[];
}

export interface MockBrokerApiOptions {
  latencyMs?: Partial<Record<Exclude<MockBrokerOperation, "unknown">, number>>;
  failFirstQuoteWith429?: boolean;
  failFirstAccountWith401?: boolean;
}

export interface MockBrokerApiHarness {
  restore(): void;
  getCallCount(operation: MockBrokerOperation): number;
  getTotalCalls(): number;
}

const DEFAULT_LATENCY_MS: Record<Exclude<MockBrokerOperation, "unknown">, number> = {
  oauthToken: 1,
  accountDiscovery: 1,
  clock: 1,
  account: 1,
  positions: 1,
  listOrders: 1,
  getOrder: 2,
  placeOrder: 3,
  cancelOrder: 1,
  cancelAll: 1,
  quote: 2,
};

const ISO_NOW = "2026-03-05T15:00:00.000Z";
const ISO_NEXT_OPEN = "2026-03-06T14:30:00.000Z";
const ISO_NEXT_CLOSE = "2026-03-05T21:00:00.000Z";

const BROKER_RULES: Record<BrokerId, BrokerPathRules> = {
  alpaca: {
    accountDiscovery: [],
    clock: [/^\/v2\/clock$/i],
    account: [/^\/v2\/account$/i],
    positions: [/^\/v2\/positions$/i],
    listOrders: [/^\/v2\/orders$/i],
    getOrder: [/^\/v2\/orders\/[^/]+$/i],
    placeOrder: [/^\/v2\/orders$/i],
    cancelOrder: [/^\/v2\/orders\/[^/]+$/i],
    cancelAll: [/^\/v2\/orders$/i],
    quote: [/^\/v2\/stocks\/[^/]+\/quotes\/latest$/i],
  },
  webull: {
    oauthToken: [/^\/oauth2\/token$/i],
    accountDiscovery: [/^\/openapi\/account\/list$/i, /^\/api\/account\/list$/i],
    clock: [/^\/openapi\/market-data\/trading\/clock$/i, /^\/openapi\/market\/clock$/i, /^\/api\/market\/clock$/i],
    account: [/^\/openapi\/account\/balance$/i, /^\/openapi\/account\/getsecaccountinfo$/i],
    positions: [/^\/openapi\/account\/positions$/i, /^\/openapi\/account\/getpositionlist$/i],
    listOrders: [
      /^\/openapi\/trade\/order\/list$/i,
      /^\/openapi\/order\/listopenorders$/i,
      /^\/openapi\/trade\/order\/history$/i,
      /^\/openapi\/order\/listhistoryorders$/i,
    ],
    getOrder: [/^\/openapi\/trade\/order\/detail$/i, /^\/openapi\/order\/getorderdetail$/i],
    placeOrder: [/^\/openapi\/trade\/order\/place$/i, /^\/openapi\/order\/placeorder$/i],
    cancelOrder: [/^\/openapi\/trade\/order\/cancel$/i, /^\/openapi\/order\/cancelorder$/i],
    cancelAll: [/^\/openapi\/trade\/order\/cancel-all$/i, /^\/openapi\/order\/cancelallorders$/i],
    quote: [/^\/openapi\/market-data\/stock\/quotes$/i, /^\/api\/market-data\/stock\/quotes$/i],
  },
  schwab: {
    accountDiscovery: [/^\/trader\/v1\/accounts\/accountnumbers$/i],
    clock: [/^\/marketdata\/v1\/markets$/i, /^\/marketdata\/v1\/hours$/i],
    account: [/^\/trader\/v1\/accounts\/[^/]+$/i],
    positions: [/^\/trader\/v1\/accounts\/[^/]+$/i],
    listOrders: [/^\/trader\/v1\/accounts\/[^/]+\/orders$/i],
    getOrder: [/^\/trader\/v1\/accounts\/[^/]+\/orders\/[^/]+$/i],
    placeOrder: [/^\/trader\/v1\/accounts\/[^/]+\/orders$/i],
    cancelOrder: [/^\/trader\/v1\/accounts\/[^/]+\/orders\/[^/]+$/i],
    cancelAll: [],
    quote: [/^\/marketdata\/v1\/quotes$/i],
  },
  tradier: {
    accountDiscovery: [/^\/v1\/user\/profile$/i],
    clock: [/^\/v1\/markets\/clock$/i],
    account: [/^\/v1\/accounts\/[^/]+\/balances$/i],
    positions: [/^\/v1\/accounts\/[^/]+\/positions$/i],
    listOrders: [/^\/v1\/accounts\/[^/]+\/orders$/i],
    getOrder: [/^\/v1\/accounts\/[^/]+\/orders\/[^/]+$/i],
    placeOrder: [/^\/v1\/accounts\/[^/]+\/orders$/i],
    cancelOrder: [/^\/v1\/accounts\/[^/]+\/orders\/[^/]+$/i],
    cancelAll: [],
    quote: [/^\/v1\/markets\/quotes$/i],
  },
  tradestation: {
    accountDiscovery: [/^\/v3\/brokerage\/accounts$/i, /^\/v2\/brokerage\/accounts$/i],
    clock: [/^\/v3\/marketdata\/marketclock$/i, /^\/v2\/marketdata\/marketclock$/i],
    account: [
      /^\/v3\/brokerage\/accounts\/[^/]+\/balances$/i,
      /^\/v2\/brokerage\/accounts\/[^/]+\/balances$/i,
    ],
    positions: [
      /^\/v3\/brokerage\/accounts\/[^/]+\/positions$/i,
      /^\/v2\/brokerage\/accounts\/[^/]+\/positions$/i,
    ],
    listOrders: [/^\/v3\/brokerage\/accounts\/[^/]+\/orders$/i, /^\/v2\/brokerage\/accounts\/[^/]+\/orders$/i],
    getOrder: [
      /^\/v3\/brokerage\/accounts\/[^/]+\/orders\/[^/]+$/i,
      /^\/v2\/brokerage\/accounts\/[^/]+\/orders\/[^/]+$/i,
    ],
    placeOrder: [/^\/v3\/orderexecution\/orders$/i, /^\/v2\/orderexecution\/orders$/i],
    cancelOrder: [/^\/v3\/orderexecution\/orders\/[^/]+$/i, /^\/v2\/orderexecution\/orders\/[^/]+$/i],
    cancelAll: [],
    quote: [/^\/v3\/marketdata\/quotes\/[^/]+$/i, /^\/v2\/data\/quote\/[^/]+$/i],
  },
  tastytrade: {
    accountDiscovery: [/^\/customers\/me\/accounts$/i, /^\/accounts$/i],
    clock: [/^\/market-sessions$/i],
    account: [/^\/accounts\/[^/]+\/balances$/i],
    positions: [/^\/accounts\/[^/]+\/positions$/i],
    listOrders: [/^\/accounts\/[^/]+\/orders\/live$/i, /^\/accounts\/[^/]+\/orders$/i],
    getOrder: [/^\/accounts\/[^/]+\/orders\/[^/]+$/i],
    placeOrder: [/^\/accounts\/[^/]+\/orders$/i],
    cancelOrder: [/^\/accounts\/[^/]+\/orders\/[^/]+$/i],
    cancelAll: [],
    quote: [/^\/market-data\/quotes\/[^/]+$/i, /^\/market-data\/quotes$/i],
  },
  etrade: {
    accountDiscovery: [/^\/v1\/accounts\/list$/i],
    clock: [/^\/v1\/market\/clock$/i],
    account: [/^\/v1\/accounts\/[^/]+\/balance$/i],
    positions: [/^\/v1\/accounts\/[^/]+\/portfolio$/i],
    listOrders: [/^\/v1\/accounts\/[^/]+\/orders$/i],
    getOrder: [/^\/v1\/accounts\/[^/]+\/orders\/[^/]+$/i],
    placeOrder: [/^\/v1\/accounts\/[^/]+\/orders\/place$/i, /^\/v1\/accounts\/[^/]+\/orders$/i],
    cancelOrder: [/^\/v1\/accounts\/[^/]+\/orders\/[^/]+$/i],
    cancelAll: [],
    quote: [/^\/v1\/market\/quote\/[^/]+$/i],
  },
  ibkr: {
    accountDiscovery: [/^\/v1\/api\/iserver\/accounts$/i],
    clock: [/^\/v1\/api\/iserver\/auth\/status$/i],
    account: [/^\/v1\/api\/portfolio\/[^/]+\/summary$/i],
    positions: [/^\/v1\/api\/portfolio\/[^/]+\/positions(?:\/0)?$/i],
    listOrders: [/^\/v1\/api\/iserver\/account\/orders$/i],
    getOrder: [/^\/v1\/api\/iserver\/account\/order\/status\/[^/]+$/i],
    placeOrder: [/^\/v1\/api\/iserver\/account\/[^/]+\/orders$/i],
    cancelOrder: [/^\/v1\/api\/iserver\/account\/[^/]+\/order\/[^/]+$/i],
    cancelAll: [],
    quote: [/^\/v1\/api\/iserver\/marketdata\/snapshot$/i],
  },
};

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function match(pathname: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(pathname));
}

function detectOperation(brokerId: BrokerId, method: string, pathname: string): MockBrokerOperation {
  const rules = BROKER_RULES[brokerId];

  if (method === "POST" && rules.oauthToken && match(pathname, rules.oauthToken)) return "oauthToken";

  if (method === "GET") {
    if (match(pathname, rules.accountDiscovery)) return "accountDiscovery";
    if (match(pathname, rules.clock)) return "clock";
    if (match(pathname, rules.account)) return "account";
    if (match(pathname, rules.positions)) return "positions";
    if (match(pathname, rules.getOrder)) return "getOrder";
    if (match(pathname, rules.listOrders)) return "listOrders";
    if (match(pathname, rules.quote)) return "quote";
  }

  if (method === "POST") {
    if (match(pathname, rules.placeOrder)) return "placeOrder";
    if (match(pathname, rules.cancelOrder)) return "cancelOrder";
    if (match(pathname, rules.cancelAll)) return "cancelAll";
  }

  if (method === "DELETE") {
    if (match(pathname, rules.cancelOrder)) return "cancelOrder";
    if (match(pathname, rules.cancelAll)) return "cancelAll";
  }

  return "unknown";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function defaultOrder(status: string): Record<string, unknown> {
  return {
    id: "order-1",
    orderId: "order-1",
    symbol: "AAPL",
    side: "buy",
    type: "market",
    timeInForce: "day",
    status,
    qty: "1",
    filledQty: status === "filled" ? "1" : "0",
  };
}

function buildRestPayload(operation: MockBrokerOperation): Response {
  switch (operation) {
    case "accountDiscovery":
      return json({ data: [{ accountId: "ACC-1" }] });
    case "clock":
      return json({
        data: {
          timestamp: ISO_NOW,
          isOpen: true,
          nextOpen: ISO_NEXT_OPEN,
          nextClose: ISO_NEXT_CLOSE,
        },
      });
    case "account":
      return json({
        data: {
          accountId: "ACC-1",
          status: "ACTIVE",
          currency: "USD",
          cash: "12000",
          buyingPower: "25000",
          portfolioValue: "30000",
          patternDayTrader: false,
          shortingEnabled: true,
          tradingBlocked: false,
          positions: [{
            symbol: "AAPL",
            qty: "2",
            marketValue: "410.20",
            avgEntryPrice: "200.00",
            unrealizedPl: "10.20",
            unrealizedPlPercent: "0.0255",
          }],
        },
      });
    case "positions":
      return json({
        data: [{
          symbol: "AAPL",
          qty: "2",
          marketValue: "410.20",
          avgEntryPrice: "200.00",
          unrealizedPl: "10.20",
          unrealizedPlPercent: "0.0255",
        }],
      });
    case "listOrders":
      return json({ data: [defaultOrder("accepted")] });
    case "getOrder":
      return json({ data: defaultOrder("filled") });
    case "placeOrder":
      return json({ data: defaultOrder("accepted") });
    case "cancelOrder":
    case "cancelAll":
      return new Response(null, { status: 204 });
    case "quote":
      return json({
        data: [{
          symbol: "AAPL",
          bidPrice: 205.10,
          bidSize: 10,
          askPrice: 205.20,
          askSize: 12,
          timestamp: ISO_NOW,
        }],
      });
    default:
      return new Response("Unhandled operation", { status: 500 });
  }
}

function buildAlpacaPayload(operation: MockBrokerOperation): Response {
  switch (operation) {
    case "clock":
      return json({
        timestamp: ISO_NOW,
        is_open: true,
        next_open: ISO_NEXT_OPEN,
        next_close: ISO_NEXT_CLOSE,
      });
    case "account":
      return json({
        id: "alpaca-acc-1",
        status: "ACTIVE",
        currency: "USD",
        cash: "12000",
        buying_power: "25000",
        portfolio_value: "30000",
        pattern_day_trader: false,
        shorting_enabled: true,
        trading_blocked: false,
      });
    case "positions":
      return json([{
        symbol: "AAPL",
        qty: "2",
        side: "long",
        market_value: "410.20",
        avg_entry_price: "200.00",
        unrealized_pl: "10.20",
        unrealized_plpc: "0.0255",
      }]);
    case "listOrders":
      return json([{
        id: "order-1",
        client_order_id: "client-1",
        symbol: "AAPL",
        side: "buy",
        type: "market",
        time_in_force: "day",
        status: "accepted",
        qty: "1",
        filled_qty: "0",
        extended_hours: false,
      }]);
    case "getOrder":
      return json({
        id: "order-1",
        client_order_id: "client-1",
        symbol: "AAPL",
        side: "buy",
        type: "market",
        time_in_force: "day",
        status: "filled",
        qty: "1",
        filled_qty: "1",
        extended_hours: false,
      });
    case "placeOrder":
      return json({
        id: "order-1",
        client_order_id: "client-1",
        symbol: "AAPL",
        side: "buy",
        type: "market",
        time_in_force: "day",
        status: "accepted",
        qty: "1",
        filled_qty: "0",
        extended_hours: false,
      });
    case "cancelOrder":
    case "cancelAll":
      return new Response(null, { status: 204 });
    case "quote":
      return json({
        symbol: "AAPL",
        quote: {
          ap: 205.20,
          as: 10,
          bp: 205.10,
          bs: 12,
          t: ISO_NOW,
        },
      });
    default:
      return new Response("Unhandled alpaca operation", { status: 500 });
  }
}

function buildWebullPayload(operation: MockBrokerOperation): Response {
  switch (operation) {
    case "oauthToken":
      return json({
        access_token: "webull-token",
        expires_in: 3600,
      });
    case "accountDiscovery":
      return json({
        code: 0,
        data: [{ accountId: "WB-ACC-1" }],
      });
    case "clock":
      return json({
        code: 0,
        data: {
          timestamp: ISO_NOW,
          isOpen: true,
          nextOpen: ISO_NEXT_OPEN,
          nextClose: ISO_NEXT_CLOSE,
        },
      });
    case "account":
      return json({
        code: 0,
        data: {
          accountId: "WB-ACC-1",
          status: "ACTIVE",
          currency: "USD",
          cash: "12000",
          buyingPower: "25000",
          portfolioValue: "30000",
          patternDayTrader: false,
          shortingEnabled: true,
          tradingBlocked: false,
        },
      });
    case "positions":
      return json({
        code: 0,
        data: [{
          symbol: "AAPL",
          qty: "2",
          marketValue: "410.20",
          avgEntryPrice: "200.00",
          unrealizedPl: "10.20",
          unrealizedPlPercent: "0.0255",
        }],
      });
    case "listOrders":
      return json({
        code: 0,
        data: [{
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          type: "MARKET",
          timeInForce: "DAY",
          status: "ACCEPTED",
          qty: "1",
          filledQty: "0",
        }],
      });
    case "getOrder":
      return json({
        code: 0,
        data: {
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          type: "MARKET",
          timeInForce: "DAY",
          status: "FILLED",
          qty: "1",
          filledQty: "1",
        },
      });
    case "placeOrder":
      return json({
        code: 0,
        data: {
          orderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          type: "MARKET",
          timeInForce: "DAY",
          status: "ACCEPTED",
          qty: "1",
          filledQty: "0",
        },
      });
    case "cancelOrder":
    case "cancelAll":
      return json({ code: 0, data: { success: true } });
    case "quote":
      return json({
        code: 0,
        data: [{
          symbol: "AAPL",
          bidPrice: 205.10,
          bidSize: 10,
          askPrice: 205.20,
          askSize: 12,
          timestamp: ISO_NOW,
        }],
      });
    default:
      return new Response("Unhandled webull operation", { status: 500 });
  }
}

function buildPayload(brokerId: BrokerId, operation: MockBrokerOperation): Response {
  if (brokerId === "alpaca") return buildAlpacaPayload(operation);
  if (brokerId === "webull") return buildWebullPayload(operation);
  return buildRestPayload(operation);
}

export function installMockBrokerApi(brokerId: BrokerId, options: MockBrokerApiOptions = {}): MockBrokerApiHarness {
  const realFetch = globalThis.fetch;
  const counts = new Map<MockBrokerOperation, number>();
  let totalCalls = 0;

  const latencyMs = {
    ...DEFAULT_LATENCY_MS,
    ...options.latencyMs,
  };

  const getCount = (operation: MockBrokerOperation): number => counts.get(operation) ?? 0;

  globalThis.fetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = typeof input === "string"
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);

    const method = (init?.method || (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    let operation = detectOperation(brokerId, method, url.pathname);
    if (
      operation === "listOrders"
      && method === "GET"
      && (url.searchParams.has("id") || url.searchParams.has("orderId"))
    ) {
      operation = "getOrder";
    }

    totalCalls += 1;
    counts.set(operation, getCount(operation) + 1);

    if (operation !== "unknown") {
      await delay(latencyMs[operation] ?? 0);
    }

    if (
      operation === "getOrder"
      && (
        url.pathname.toLowerCase().includes("missing-order")
        || url.search.toLowerCase().includes("missing-order")
      )
    ) {
      return new Response("not found", { status: 404 });
    }

    if (operation === "quote") {
      const querySymbol = (
        url.searchParams.get("symbol")
        || url.searchParams.get("symbols")
        || url.searchParams.get("conids")
        || ""
      ).toUpperCase();
      if (querySymbol.includes("UNKNOWN") || url.pathname.toUpperCase().includes("UNKNOWN")) {
        return new Response("quote not found", { status: 404 });
      }
    }

    if (options.failFirstQuoteWith429 && operation === "quote" && getCount("quote") === 1) {
      return new Response("rate limited", { status: 429 });
    }

    if (options.failFirstAccountWith401 && operation === "account" && getCount("account") === 1) {
      return new Response("unauthorized", { status: 401 });
    }

    if (operation === "unknown") {
      return new Response(
        `Unhandled mock route for ${brokerId}: ${method} ${url.pathname}${url.search}`,
        { status: 500 },
      );
    }

    return buildPayload(brokerId, operation);
  }) as unknown as typeof fetch;

  return {
    restore() {
      globalThis.fetch = realFetch;
    },
    getCallCount(operation: MockBrokerOperation) {
      return getCount(operation);
    },
    getTotalCalls() {
      return totalCalls;
    },
  };
}

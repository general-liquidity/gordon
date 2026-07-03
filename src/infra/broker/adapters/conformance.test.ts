import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AlpacaAdapter } from "./alpaca.ts";
import type { BrokerAdapter, BrokerCredentials, BrokerId } from "../types.ts";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
  bodyText: string;
}

interface BrokerScenario {
  name: string;
  expectedBrokerId: BrokerId;
  expectedDisplayName: string;
  credentials: BrokerCredentials;
  createAdapter: (credentials: BrokerCredentials) => BrokerAdapter;
  route: (request: CapturedRequest) => Response;
}

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function installMockFetch(requests: CapturedRequest[], route: (request: CapturedRequest) => Response): void {
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = typeof input === "string"
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);
    const method = (init?.method || (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers || (typeof input === "object" && "headers" in input ? input.headers : undefined));
    const bodyText = typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";

    const request: CapturedRequest = {
      url,
      method,
      headers,
      bodyText,
    };
    requests.push(request);

    return route(request);
  }) as unknown as typeof fetch;
}

function runBrokerConformanceSuite(scenario: BrokerScenario): void {
  describe(`${scenario.name} adapter conformance`, () => {
    let requests: CapturedRequest[] = [];
    let adapter: BrokerAdapter;

    beforeEach(() => {
      requests = [];
      installMockFetch(requests, scenario.route);
      adapter = scenario.createAdapter(scenario.credentials);
    });

    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    test("exposes broker metadata and capabilities", () => {
      expect(adapter.brokerId).toBe(scenario.expectedBrokerId);
      expect(adapter.displayName).toBe(scenario.expectedDisplayName);
      expect(adapter.capabilities.supportsMarketOrders).toBe(true);
      expect(adapter.capabilities.supportsLimitOrders).toBe(true);
      expect(adapter.capabilities.supportsPaperTrading).toBe(true);
    });

    test("implements the normalized broker contract", async () => {
      await expect(adapter.testConnection()).resolves.toBe(true);

      const account = await adapter.getAccount();
      expect(account.currency).toBe("USD");
      expect(account.cash).toBeGreaterThan(0);

      const clock = await adapter.getClock();
      expect(typeof clock.isOpen).toBe("boolean");
      expect(clock.timestamp.length).toBeGreaterThan(0);

      const positions = await adapter.getPositions();
      expect(Array.isArray(positions)).toBe(true);
      expect(positions.length).toBeGreaterThan(0);
      expect(positions[0]?.symbol).toBe("AAPL");

      const openOrders = await adapter.getOpenOrders(2);
      expect(openOrders.length).toBeGreaterThan(0);
      expect(openOrders[0]?.symbol).toBe("AAPL");

      const fetchedOrder = await adapter.getOrder("order-1");
      expect(fetchedOrder.id).toBe("order-1");
      expect(fetchedOrder.symbol).toBe("AAPL");

      const placedOrder = await adapter.placeOrder({
        symbol: "AAPL",
        side: "buy",
        type: "market",
        timeInForce: "day",
        qty: 1,
      });
      expect(placedOrder.symbol).toBe("AAPL");
      expect(placedOrder.side).toBe("buy");

      await expect(adapter.cancelOrder("order-1")).resolves.toBeUndefined();
      await expect(adapter.cancelAllOrders()).resolves.toBeUndefined();

      const quote = await adapter.getLatestQuote("AAPL");
      expect(quote.symbol).toBe("AAPL");
      expect(quote.askPrice).toBeGreaterThan(0);
      expect(quote.bidPrice).toBeGreaterThan(0);
    });

    test("rejects order placement without qty/notional", async () => {
      await expect(adapter.placeOrder({
        symbol: "AAPL",
        side: "buy",
        type: "market",
        timeInForce: "day",
      })).rejects.toThrow("qty or notional");
    });

    test("uses authenticated headers", async () => {
      await adapter.getAccount();
      const authRequest = requests.find((request) => request.url.pathname.includes("/account"));
      expect(authRequest).toBeDefined();
      expect((authRequest?.headers.get("accept") || "").toLowerCase()).toContain("application/json");
    });
  });
}

runBrokerConformanceSuite({
  name: "alpaca",
  expectedBrokerId: "alpaca",
  expectedDisplayName: "Alpaca",
  credentials: {
    apiKey: "alpaca-key",
    apiSecret: "alpaca-secret",
    paper: true,
    baseUrl: "https://alpaca.test",
    dataBaseUrl: "https://alpaca-data.test",
  },
  createAdapter: (credentials) => new AlpacaAdapter(credentials),
  route: (request) => {
    const { pathname, searchParams } = request.url;
    if (pathname === "/v2/account" && request.method === "GET") {
      return json({
        id: "acc-1",
        status: "ACTIVE",
        currency: "USD",
        cash: "12000",
        buying_power: "25000",
        portfolio_value: "30000",
        pattern_day_trader: false,
        shorting_enabled: true,
        trading_blocked: false,
      });
    }

    if (pathname === "/v2/clock" && request.method === "GET") {
      return json({
        timestamp: "2026-03-05T14:30:00Z",
        is_open: true,
        next_open: "2026-03-06T14:30:00Z",
        next_close: "2026-03-05T21:00:00Z",
      });
    }

    if (pathname === "/v2/positions" && request.method === "GET") {
      return json([{
        symbol: "AAPL",
        qty: "2",
        side: "long",
        market_value: "410.52",
        avg_entry_price: "200.00",
        unrealized_pl: "10.52",
        unrealized_plpc: "0.0263",
      }]);
    }

    if (pathname === "/v2/orders" && request.method === "GET") {
      expect(searchParams.get("status")).toBe("open");
      expect(searchParams.get("limit")).toBe("2");
      return json([{
        id: "order-1",
        client_order_id: "client-1",
        symbol: "AAPL",
        side: "buy",
        type: "market",
        time_in_force: "day",
        status: "new",
        qty: "2",
        filled_qty: "0",
        extended_hours: false,
      }]);
    }

    if (pathname === "/v2/orders/order-1" && request.method === "GET") {
      return json({
        id: "order-1",
        client_order_id: "client-1",
        symbol: "AAPL",
        side: "buy",
        type: "market",
        time_in_force: "day",
        status: "accepted",
        qty: "2",
        filled_qty: "1",
        extended_hours: false,
      });
    }

    if (pathname === "/v2/orders" && request.method === "POST") {
      const body = JSON.parse(request.bodyText || "{}");
      expect(body.symbol).toBe("AAPL");
      return json({
        id: "order-2",
        client_order_id: "client-2",
        symbol: "AAPL",
        side: "buy",
        type: "market",
        time_in_force: "day",
        status: "accepted",
        qty: "1",
        filled_qty: "0",
        extended_hours: false,
      });
    }

    if (pathname === "/v2/orders/order-1" && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    if (pathname === "/v2/orders" && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    if (pathname === "/v2/stocks/AAPL/quotes/latest" && request.method === "GET") {
      return json({
        symbol: "AAPL",
        quote: {
          ap: 205.2,
          as: 10,
          bp: 205.1,
          bs: 14,
          t: "2026-03-05T14:31:00Z",
        },
      });
    }

    return new Response(`Unhandled route: ${request.method} ${request.url.toString()}`, { status: 500 });
  },
});

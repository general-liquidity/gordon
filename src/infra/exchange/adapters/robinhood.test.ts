import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RobinhoodAdapter } from "./robinhood.ts";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
  bodyText: string;
}

const realFetch = globalThis.fetch;
const privateKeySeed = Buffer.alloc(32, 1).toString("base64");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installMockFetch(requests: CapturedRequest[]): void {
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = typeof input === "string"
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);
    const method = (init?.method || "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const bodyText = typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";

    requests.push({ url, method, headers, bodyText });

    if (url.pathname === "/api/v1/crypto/trading/accounts/" && method === "GET") {
      return json({
        results: [
          {
            id: "acct-1",
            status: "active",
            buying_power: "1500.00",
          },
        ],
      });
    }

    if (url.pathname === "/api/v1/crypto/trading/holdings/" && method === "GET") {
      return json({
        next: null,
        results: [
          {
            asset_code: "BTC",
            total_quantity: "0.1",
            quantity_available_for_trading: "0.08",
          },
        ],
      });
    }

    if (url.pathname === "/api/v1/crypto/trading/trading_pairs/" && method === "GET") {
      return json({
        next: null,
        results: [
          {
            symbol: "BTC-USD",
            asset_code: "BTC",
            quote_code: "USD",
            status: "active",
            min_order_size: "0.00001",
            increment: "0.00000001",
          },
        ],
      });
    }

    if (url.pathname === "/api/v1/crypto/marketdata/best_bid_ask/" && method === "GET") {
      return json({
        results: [
          {
            symbol: "BTC-USD",
            bid_price: "60000",
            ask_price: "60010",
            bid_size: "1.2",
            ask_size: "0.9",
            volume_24h: "2500",
          },
        ],
      });
    }

    if (url.pathname === "/api/v1/crypto/marketdata/orderbook/" && method === "GET") {
      return json({
        results: [
          {
            bids: [{ price: "60000", quantity: "1.0" }],
            asks: [{ price: "60010", quantity: "1.5" }],
          },
        ],
      });
    }

    if (url.pathname === "/api/v1/crypto/marketdata/historicals/BTC-USD/" && method === "GET") {
      return json({
        results: [
          {
            begins_at: "2026-03-05T00:00:00Z",
            open_price: "59000",
            high_price: "60500",
            low_price: "58900",
            close_price: "60000",
            volume: "120",
          },
        ],
      });
    }

    if (url.pathname === "/api/v1/crypto/trading/orders/" && method === "POST") {
      const body = JSON.parse(bodyText || "{}");
      expect(body.symbol).toBe("BTC-USD");
      return json({
        id: "order-1",
        client_order_id: body.client_order_id,
        symbol: "BTC-USD",
        side: body.side,
        type: body.type,
        state: "open",
        average_price: "60005",
        asset_quantity: "0.01",
        filled_asset_quantity: "0",
        created_at: "2026-03-05T12:00:00Z",
        updated_at: "2026-03-05T12:00:00Z",
      });
    }

    if (url.pathname === "/api/v1/crypto/trading/orders/" && method === "GET") {
      return json({
        next: null,
        results: [
          {
            id: "order-1",
            client_order_id: "cid-1",
            symbol: "BTC-USD",
            side: "buy",
            type: "market",
            state: "filled",
            average_price: "60005",
            asset_quantity: "0.01",
            filled_asset_quantity: "0.01",
            created_at: "2026-03-05T12:00:00Z",
            updated_at: "2026-03-05T12:01:00Z",
          },
        ],
      });
    }

    if (url.pathname === "/api/v1/crypto/trading/orders/order-1/" && method === "GET") {
      return json({
        id: "order-1",
        client_order_id: "cid-1",
        symbol: "BTC-USD",
        side: "buy",
        type: "market",
        state: "filled",
        average_price: "60005",
        asset_quantity: "0.01",
        filled_asset_quantity: "0.01",
        created_at: "2026-03-05T12:00:00Z",
        updated_at: "2026-03-05T12:01:00Z",
      });
    }

    if (url.pathname === "/api/v1/crypto/trading/orders/order-1/cancel/" && method === "POST") {
      return new Response(null, { status: 204 });
    }

    return new Response(`Unhandled: ${method} ${url.toString()}`, { status: 500 });
  }) as unknown as typeof fetch;
}

describe("RobinhoodAdapter", () => {
  let requests: CapturedRequest[] = [];

  beforeEach(() => {
    requests = [];
    installMockFetch(requests);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("implements market/account/trading core methods", async () => {
    const adapter = new RobinhoodAdapter("rh-key", privateKeySeed, "https://trading.robinhood.com");

    await expect(adapter.testConnection()).resolves.toBe(true);

    const info = await adapter.getExchangeInfo();
    expect(info.symbols[0]?.symbol).toBe("BTCUSD");

    const price = await adapter.getPrice("BTCUSD");
    expect(price).toBe(60005);

    const ticker = await adapter.getBookTicker("BTCUSD");
    expect(ticker.bidPrice).toBe(60000);
    expect(ticker.askPrice).toBe(60010);

    const orderBook = await adapter.getOrderBook("BTCUSD");
    expect(orderBook.bids.length).toBeGreaterThan(0);
    expect(orderBook.asks.length).toBeGreaterThan(0);

    const candles = await adapter.getCandles("BTCUSD", "1h", 10);
    expect(candles.length).toBeGreaterThan(0);

    const account = await adapter.getAccountInfo();
    expect(account.canTrade).toBe(true);
    expect(account.balances.some((b) => b.asset === "USD")).toBe(true);

    const balances = await adapter.getAllBalances();
    expect(balances.some((b) => b.asset === "BTC")).toBe(true);

    const placed = await adapter.placeOrder({
      symbol: "BTCUSD",
      side: "BUY",
      type: "MARKET",
      quantity: 0.01,
      timeInForce: "GTC",
    });
    expect(placed.orderId).toBe("order-1");
    expect(placed.symbol).toBe("BTCUSD");

    const order = await adapter.getOrderStatus("BTCUSD", "order-1");
    expect(order.status).toBe("FILLED");

    const history = await adapter.getOrderHistory("BTCUSD", 20);
    expect(history.length).toBeGreaterThan(0);

    await expect(adapter.cancelOrder("BTCUSD", "order-1")).resolves.toBeUndefined();
  });

  test("sends required Robinhood auth headers", async () => {
    const adapter = new RobinhoodAdapter("rh-key", privateKeySeed, "https://trading.robinhood.com");
    await adapter.getPrice("BTCUSD");

    const req = requests[0];
    expect(req).toBeDefined();
    expect(req?.headers.get("x-api-key")).toBe("rh-key");
    expect((req?.headers.get("x-signature") || "").length).toBeGreaterThan(0);
    expect((req?.headers.get("x-timestamp") || "").length).toBeGreaterThan(0);
  });
});


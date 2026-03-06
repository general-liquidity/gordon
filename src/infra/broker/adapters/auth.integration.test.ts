import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TastytradeAdapter } from "./tastytrade.ts";
import { Trading212Adapter } from "./trading212.ts";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("tastytrade adapter session auth", () => {
  const requests: Array<{ url: URL; method: string; headers: Headers; bodyText: string }> = [];
  let accountCalls = 0;

  beforeEach(() => {
    requests.length = 0;
    accountCalls = 0;
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
      const url = typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
      const method = (init?.method || "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const bodyText = typeof init?.body === "string" ? init.body : "";
      requests.push({ url, method, headers, bodyText });

      if (url.pathname === "/sessions" && method === "POST") {
        return json({
          data: {
            "session-token": `tt-session-${requests.length}`,
          },
        });
      }

      if (url.pathname === "/customers/me/accounts" && method === "GET") {
        return json({
          data: {
            items: [{ "account-number": "TT-ACC-1" }],
          },
        });
      }

      if (url.pathname === "/accounts/TT-ACC-1/balances" && method === "GET") {
        accountCalls += 1;
        if (accountCalls === 1) {
          return new Response("unauthorized", { status: 401 });
        }
        return json({
          data: {
            "account-number": "TT-ACC-1",
            currency: "USD",
            "cash-balance": "12000",
            "buying-power": "25000",
            "net-liquidating-value": "30000",
          },
        });
      }

      return new Response(`Unhandled route: ${method} ${url.pathname}`, { status: 500 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("creates a session and retries account requests after 401", async () => {
    const adapter = new TastytradeAdapter({
      apiKey: "user@example.com",
      apiSecret: "super-secret",
      paper: true,
      baseUrl: "https://tastytrade.test",
    });

    const account = await adapter.getAccount();
    expect(account.currency).toBe("USD");

    const sessionCalls = requests.filter((request) => request.url.pathname === "/sessions");
    expect(sessionCalls.length).toBe(2);
    expect(sessionCalls[0]?.bodyText).toContain("\"login\":\"user@example.com\"");

    const balanceCalls = requests.filter((request) => request.url.pathname === "/accounts/TT-ACC-1/balances");
    expect(balanceCalls.length).toBe(2);
    expect(balanceCalls[1]?.headers.get("session-token")).toContain("tt-session");
  });
});

describe("Trading 212 adapter auth + routing", () => {
  const requests: Array<{ url: URL; method: string; headers: Headers; bodyText: string }> = [];

  beforeEach(() => {
    requests.length = 0;
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
      const url = typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
      const method = (init?.method || "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const bodyText = typeof init?.body === "string" ? init.body : "";
      requests.push({ url, method, headers, bodyText });

      if (url.pathname === "/api/v0/equity/account/info" && method === "GET") {
        return json({
          id: "TR212-ACC-1",
          currencyCode: "USD",
          equity: "30000",
        });
      }

      if (url.pathname === "/api/v0/equity/account/cash" && method === "GET") {
        return json({
          free: "12000",
          availableToInvest: "25000",
        });
      }

      if (url.pathname === "/api/v0/equity/orders/market" && method === "POST") {
        return json({
          id: "order-1",
          ticker: "AAPL",
          side: "BUY",
          type: "MARKET",
          timeValidity: "DAY",
          status: "accepted",
          quantity: "1",
          filledQuantity: "0",
        });
      }

      return new Response(`Unhandled route: ${method} ${url.pathname}`, { status: 500 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("uses basic auth and the market-order endpoint", async () => {
    const adapter = new Trading212Adapter({
      apiKey: "trading212-key",
      apiSecret: "trading212-secret",
      paper: true,
      baseUrl: "https://demo.trading212.test",
    });

    await adapter.getAccount();
    await adapter.placeOrder({
      symbol: "AAPL",
      side: "buy",
      type: "market",
      timeInForce: "day",
      qty: 1,
    });

    const accountInfoRequest = requests.find((request) => request.url.pathname === "/api/v0/equity/account/info");
    expect(accountInfoRequest?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("trading212-key:trading212-secret").toString("base64")}`,
    );

    const orderRequest = requests.find((request) => request.url.pathname === "/api/v0/equity/orders/market");
    expect(orderRequest?.bodyText).toContain("\"ticker\":\"AAPL\"");
    expect(orderRequest?.bodyText).toContain("\"quantity\":1");
  });
});

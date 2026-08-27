import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TastytradeAdapter } from "./tastytrade.ts";

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
      const url =
        typeof input === "string"
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
    expect(sessionCalls[0]?.bodyText).toContain('"login":"user@example.com"');

    const balanceCalls = requests.filter(
      (request) => request.url.pathname === "/accounts/TT-ACC-1/balances",
    );
    expect(balanceCalls.length).toBe(2);
    expect(balanceCalls[1]?.headers.get("session-token")).toContain("tt-session");
  });
});

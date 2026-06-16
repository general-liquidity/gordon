import { afterEach, describe, expect, it } from "bun:test";
import { Mt5BridgeClient, Mt5BridgeError } from "./bridgeClient.ts";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  init: RequestInit;
}

/** Install a fetch stub that returns `responder(url, init)` and records calls. */
function stubFetch(responder: (url: string, init: RequestInit) => { status?: number; json: unknown }) {
  const calls: Recorded[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, json } = responder(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(json),
    } as Response;
  }) as typeof fetch;
  return calls;
}

const client = new Mt5BridgeClient({ baseUrl: "http://127.0.0.1:8788", token: "secret" });

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Mt5BridgeClient", () => {
  it("GET /account sends the auth token and parses the body", async () => {
    const calls = stubFetch(() => ({ json: { login: 123, currency: "USD", equity: 1_000_000 } }));
    const acct = await client.account();
    expect(acct.equity).toBe(1_000_000);
    expect(calls[0]!.url).toBe("http://127.0.0.1:8788/account");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Bridge-Token"]).toBe("secret");
  });

  it("positions() unwraps the { positions } envelope", async () => {
    stubFetch(() => ({ json: { positions: [{ ticket: 1, symbol: "XAUUSD", sideLabel: "long" }] } }));
    const positions = await client.positions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.symbol).toBe("XAUUSD");
  });

  it("builds query strings for quote/depth/bars and omits undefined params", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/quote")) return { json: { symbol: "XAUUSD", bid: 1, ask: 2, last: 1.5, time: 0 } };
      return { json: { bars: [] } };
    });
    await client.quote("XAUUSD");
    await client.bars({ symbol: "EURUSD", timeframe: "M15", count: 500 });
    expect(calls[0]!.url).toBe("http://127.0.0.1:8788/quote?symbol=XAUUSD");
    expect(calls[1]!.url).toBe("http://127.0.0.1:8788/bars?symbol=EURUSD&timeframe=M15&count=500");
  });

  it("placeOrder POSTs a JSON body", async () => {
    const calls = stubFetch(() => ({ json: { executed: true, retcode: 10009, order: 555 } }));
    const res = await client.placeOrder({ symbol: "XAUUSD", side: "buy", type: "market", volume: 0.1 });
    expect(res.executed).toBe(true);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ symbol: "XAUUSD", side: "buy", volume: 0.1 });
  });

  it("surfaces the trading guard without throwing", async () => {
    stubFetch(() => ({ json: { executed: false, guard: "trading-disabled", check: { retcode: 0 } } }));
    const res = await client.placeOrder({ symbol: "XAUUSD", side: "buy", type: "market", volume: 0.1 });
    expect(res.executed).toBe(false);
    expect(res.guard).toBe("trading-disabled");
  });

  it("throws Mt5BridgeError with the server message on a non-2xx response", async () => {
    stubFetch(() => ({ status: 404, json: { error: "unknown symbol 'NOPE'" } }));
    await expect(client.quote("NOPE")).rejects.toThrow("unknown symbol 'NOPE'");
  });

  it("throws a clear 'unreachable' error when the sidecar is down", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const err = (await client.account().catch((e) => e)) as Mt5BridgeError;
    expect(err).toBeInstanceOf(Mt5BridgeError);
    expect(err.status).toBe(0);
    expect(err.message).toContain("unreachable");
  });

  it("omits the token header when no token is configured", async () => {
    const noToken = new Mt5BridgeClient({ baseUrl: "http://127.0.0.1:8788", token: "" });
    const calls = stubFetch(() => ({ json: { ok: true, tradingEnabled: false } }));
    await noToken.health();
    expect((calls[0]!.init.headers as Record<string, string>)["X-Bridge-Token"]).toBeUndefined();
  });
});

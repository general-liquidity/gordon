import { afterEach, describe, expect, it } from "bun:test";
import { RestBrokerAdapter, MalformedBrokerOrderError } from "./rest-base.ts";
import { AlpacaAdapter } from "./alpaca.ts";
import { tripKillSwitch, resetAllKillSwitches } from "../../safety/killSwitches.ts";
import type { BrokerCapabilities, BrokerCredentials, BrokerOrder } from "../types.ts";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const realFetch = globalThis.fetch;

function installFetch(handler: (url: URL, init?: FetchInit) => Response): void {
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    return handler(url, init);
  }) as unknown as typeof fetch;
}

const CAPABILITIES: BrokerCapabilities = {
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

/** Concrete subclass exposing the protected helpers for direct unit testing. */
class TestRestBroker extends RestBrokerAdapter {
  constructor(credentials: BrokerCredentials) {
    super(credentials, {
      brokerId: "alpaca",
      displayName: "TestBroker",
      capabilities: CAPABILITIES,
      authStyle: "none",
      defaultLiveBaseUrl: "https://example.test",
      accountDiscoveryPaths: ["/accounts"],
      clockPaths: ["/clock"],
      accountPaths: ["/accounts/{accountId}"],
      positionsPaths: ["/positions"],
      listOrdersPaths: ["/orders"],
      getOrderPaths: ["/orders/{orderId}"],
      placeOrderPaths: ["/orders"],
      cancelOrderPaths: ["/orders/{orderId}"],
      quotePaths: ["/quotes/{symbol}"],
    });
  }

  publicToBrokerOrder(input: unknown): BrokerOrder {
    return this.toBrokerOrder(input);
  }

  publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, init);
  }
}

const CREDS: BrokerCredentials = {
  apiKey: "test-key",
  apiSecret: "test-secret",
  paper: true,
  accountId: "acct-1",
};

describe("RestBrokerAdapter — P1-6 error-body redaction", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("redacts a credential-shaped error body and truncates to 500 chars", async () => {
    const leakedToken = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const longTail = "x".repeat(2000);
    installFetch(
      () =>
        new Response(`unauthorized: ${leakedToken} ${longTail}`, {
          status: 401,
          statusText: "Unauthorized",
        }),
    );

    const broker = new TestRestBroker(CREDS);
    let caught: Error | undefined;
    try {
      await broker.publicRequest("/orders");
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeDefined();
    const message = caught!.message;
    expect(message).not.toContain(leakedToken);
    expect(message).toContain("[REDACTED]");
    expect(message).toContain("401");
    expect(message).toContain("Unauthorized");
    // status/statusText prefix + at most 500 chars of (redacted) body.
    const bodyPortion = message.split(": ").slice(1).join(": ");
    expect(bodyPortion.length).toBeLessThanOrEqual(500);
  });
});

describe("RestBrokerAdapter — P1-9 malformed order throws", () => {
  it("throws when the order id is missing", () => {
    const broker = new TestRestBroker(CREDS);
    expect(() => broker.publicToBrokerOrder({ status: "filled", qty: 1 })).toThrow(
      MalformedBrokerOrderError,
    );
  });

  it("throws when a numeric field is non-finite", () => {
    const broker = new TestRestBroker(CREDS);
    expect(() =>
      broker.publicToBrokerOrder({ id: "o-1", status: "filled", qty: "not-a-number" }),
    ).toThrow(/non-finite/i);
  });

  it("throws when limitPrice is present but non-finite", () => {
    const broker = new TestRestBroker(CREDS);
    expect(() =>
      broker.publicToBrokerOrder({ id: "o-1", status: "new", qty: 1, limitPrice: "oops" }),
    ).toThrow(/non-finite/i);
  });

  it("parses a well-formed order", () => {
    const broker = new TestRestBroker(CREDS);
    const order = broker.publicToBrokerOrder({
      id: "o-1",
      status: "filled",
      qty: 10,
      filledQty: 10,
      price: 123.45,
      symbol: "AAPL",
      side: "buy",
    });
    expect(order.id).toBe("o-1");
    expect(order.qty).toBe(10);
    expect(order.limitPrice).toBe(123.45);
  });
});

describe("Broker placeOrder — P1-5 kill-switch chokepoint", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetAllKillSwitches("test cleanup of kill switches");
  });

  it("rejects an Alpaca order when the venue switch is tripped", async () => {
    installFetch(() => new Response("{}", { status: 200 }));
    const alpaca = new AlpacaAdapter(CREDS);
    tripKillSwitch({ scope: "venue", id: "alpaca" }, "halt alpaca for test");
    await expect(
      alpaca.placeOrder({
        symbol: "aapl",
        side: "buy",
        type: "market",
        timeInForce: "day",
        qty: 1,
      }),
    ).rejects.toThrow(/kill switch/i);
  });

  it("rejects a rest-base order when the firm switch is tripped", async () => {
    installFetch(() => new Response("{}", { status: 200 }));
    const broker = new TestRestBroker(CREDS);
    tripKillSwitch({ scope: "firm" }, "firm-wide halt for test");
    await expect(
      broker.placeOrder({
        symbol: "aapl",
        side: "buy",
        type: "market",
        timeInForce: "day",
        qty: 1,
      }),
    ).rejects.toThrow();
  });
});

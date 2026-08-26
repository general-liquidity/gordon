import { beforeEach, describe, expect, test } from "bun:test";

import { ExchangeFactory } from "./factory.ts";

const CREDENTIALS = { apiKey: "abcdefgh1234", apiSecret: "secret" };

describe("ExchangeFactory instance cache", () => {
  beforeEach(() => {
    ExchangeFactory.clearCache();
  });

  test("sandbox and live adapters for the same venue and key are distinct instances", () => {
    const live = ExchangeFactory.create("binance", { ...CREDENTIALS, sandbox: false });
    const sandbox = ExchangeFactory.create("binance", { ...CREDENTIALS, sandbox: true });

    // The cache key used to omit the resolved mode, so the live adapter created
    // first was handed back to the caller that asked for sandbox.
    expect(sandbox).not.toBe(live);
    expect(ExchangeFactory.getCacheSize()).toBe(2);
  });

  test("repeat requests for the same venue, key and mode reuse one instance", () => {
    const first = ExchangeFactory.create("binance", { ...CREDENTIALS, sandbox: true });
    const second = ExchangeFactory.create("binance", { ...CREDENTIALS, sandbox: true });

    expect(second).toBe(first);
    expect(ExchangeFactory.getCacheSize()).toBe(1);
  });

  test("removeFromCache evicts both modes for the credentials", () => {
    ExchangeFactory.create("binance", { ...CREDENTIALS, sandbox: false });
    ExchangeFactory.create("binance", { ...CREDENTIALS, sandbox: true });
    expect(ExchangeFactory.getCacheSize()).toBe(2);

    ExchangeFactory.removeFromCache("binance", CREDENTIALS);
    expect(ExchangeFactory.getCacheSize()).toBe(0);
  });
});

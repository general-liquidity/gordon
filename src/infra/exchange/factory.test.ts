import { beforeEach, describe, expect, test } from "bun:test";

import { ExchangeFactory } from "./factory.ts";

// Obviously-fake markers: the secret scanner allowlists `dummy`/`placeholder`
// shaped fixtures, and a high-entropy random-looking literal here would trip the
// hard gate for no reason. The cache key only reads the first 8 characters.
const CREDENTIALS = { apiKey: "dummy-api-key-not-a-secret", apiSecret: "dummy-placeholder" };

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

  test("API-key rotation creates a fresh adapter without changing stable halt identity", () => {
    const first = ExchangeFactory.create("binance", {
      ...CREDENTIALS,
      accountIdentity: "operator-subaccount-7",
      sandbox: true,
    });
    const rotated = ExchangeFactory.create("binance", {
      ...CREDENTIALS,
      apiKey: "dummy-rotated-api-key",
      accountIdentity: "operator-subaccount-7",
      sandbox: true,
    });

    expect(rotated).not.toBe(first);
    expect(rotated.connectionIdentity).toBe(first.connectionIdentity);
    expect(ExchangeFactory.getCacheSize()).toBe(2);
  });

  test("removeFromCache evicts both modes for the credentials", () => {
    ExchangeFactory.create("binance", { ...CREDENTIALS, sandbox: false });
    ExchangeFactory.create("binance", { ...CREDENTIALS, sandbox: true });
    expect(ExchangeFactory.getCacheSize()).toBe(2);

    ExchangeFactory.removeFromCache("binance", CREDENTIALS);
    expect(ExchangeFactory.getCacheSize()).toBe(0);
  });
});

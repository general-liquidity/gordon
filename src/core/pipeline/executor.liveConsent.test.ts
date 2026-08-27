/**
 * Live-consent gate on the executor dispatch sites.
 *
 * `placeOrderIdempotent` and `placeOCOOrders` reach the venue directly; before
 * this gate they only checked the kill switch.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exchange } from "../../infra/exchange/index.ts";
import { setDatabasePathForTesting } from "../../infra/storage/database.ts";
import { CONSENT_PATH_ENV, recordLiveConsent } from "../../infra/safety/consent.ts";
import { placeOCOOrders, placeOrderIdempotent } from "./executor.ts";

const dbPath = join(tmpdir(), `gordon-consent-exec-${process.pid}-${Date.now()}.db`);
const consentPath = join(tmpdir(), `gordon-consent-exec-${process.pid}-${Date.now()}.json`);
let previousConsentPath: string | undefined;

beforeAll(() => {
  setDatabasePathForTesting(dbPath);
  previousConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
});

afterEach(() => {
  if (existsSync(consentPath)) rmSync(consentPath);
});

afterAll(() => {
  setDatabasePathForTesting(null);
  if (previousConsentPath === undefined) delete process.env[CONSENT_PATH_ENV];
  else process.env[CONSENT_PATH_ENV] = previousConsentPath;
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${suffix}`;
    try {
      if (existsSync(p)) rmSync(p);
    } catch {
      /* ignore */
    }
  }
});

function makeClient(isSandbox: boolean, placed: string[]): Exchange {
  return {
    exchangeId: "binance",
    isSandbox,
    getOrderHistory: async () => [],
    getOpenOrders: async () => [],
    placeOrder: async (params: { symbol: string }) => {
      placed.push(params.symbol);
      return {
        orderId: "order-1",
        symbol: params.symbol,
        side: "BUY",
        type: "MARKET",
        status: "FILLED",
        price: 100,
        quantity: 1,
        executedQty: 1,
        cummulativeQuoteQty: 100,
      };
    },
  } as unknown as Exchange;
}

describe("placeOrderIdempotent live-consent gate", () => {
  it("refuses to dispatch on a live venue without consent", async () => {
    const placed: string[] = [];
    const client = makeClient(false, placed);

    await expect(
      placeOrderIdempotent(client, { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 1 }),
    ).rejects.toThrow(/have not yet acknowledged live trading/);
    expect(placed).toEqual([]);
  });

  it("dispatches on a live venue once consent is recorded", async () => {
    recordLiveConsent();
    const placed: string[] = [];
    const client = makeClient(false, placed);

    await placeOrderIdempotent(client, {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 1,
    });
    expect(placed).toEqual(["BTCUSDT"]);
  });

  it("dispatches on a sandbox venue without consent", async () => {
    const placed: string[] = [];
    const client = makeClient(true, placed);

    await placeOrderIdempotent(client, {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 1,
    });
    expect(placed).toEqual(["BTCUSDT"]);
  });
});

describe("placeOCOOrders live-consent gate", () => {
  it("refuses both the native and fallback legs on a live venue without consent", async () => {
    const placed: string[] = [];
    const client = makeClient(false, placed);

    const result = await placeOCOOrders(client, "BTCUSDT", "SELL", 1, 49_000, 48_755, 52_000);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/have not yet acknowledged live trading/);
    expect(placed).toEqual([]);
  });

  it("refuses to imitate OCO with two independent sandbox orders", async () => {
    const placed: string[] = [];
    const client = makeClient(true, placed);

    const result = await placeOCOOrders(client, "BTCUSDT", "SELL", 1, 49_000, 48_755, 52_000);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Native OCO is not supported/);
    expect(placed).toEqual([]);
  });
});

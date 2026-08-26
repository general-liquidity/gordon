/**
 * Live-consent gate on place_limit_order, which reached the venue with only a
 * kill-switch + permission-mode + risk-gate check before this gate.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONSENT_PATH_ENV } from "../../../safety/consent.ts";
import { cancelAllOrdersTool, cancelOrderTool, placeLimitOrderTool } from "./orderbook.ts";

const consentPath = join(tmpdir(), `gordon-consent-orderbook-${process.pid}-${Date.now()}.json`);
let previousConsentPath: string | undefined;

beforeAll(() => {
  previousConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
  if (existsSync(consentPath)) rmSync(consentPath);
});

afterAll(() => {
  if (previousConsentPath === undefined) delete process.env[CONSENT_PATH_ENV];
  else process.env[CONSENT_PATH_ENV] = previousConsentPath;
});

function makeExecContext(placed: string[], isSandbox: boolean, cancelled: string[] = []) {
  const exchange = {
    exchangeId: "binance",
    isSandbox,
    getPrice: async () => 100,
    placeOrder: async (params: { symbol: string }) => {
      placed.push(params.symbol);
      return {
        orderId: "order-1",
        symbol: params.symbol,
        side: "BUY",
        type: "LIMIT",
        status: "NEW",
        price: 100,
        quantity: 1,
        executedQty: 0,
        cummulativeQuoteQty: 0,
      };
    },
    cancelAllOrders: async (symbol: string) => {
      cancelled.push(symbol);
      return [];
    },
    cancelOrder: async (symbol: string, orderId: string) => {
      cancelled.push(`${symbol}:${orderId}`);
    },
  };
  const values: Record<string, unknown> = { exchange, config: { permissionMode: "auto" } };
  return { requestContext: { get: (key: string) => values[key] } } as never;
}

describe("place_limit_order live-consent gate", () => {
  it("refuses on a live venue without consent", async () => {
    const placed: string[] = [];
    const res = (await placeLimitOrderTool.execute!(
      { symbol: "BTCUSDT", side: "BUY", quantity: 0.01, price: 100, timeInForce: "GTC" } as never,
      makeExecContext(placed, false),
    )) as { error?: string };

    expect(res.error).toMatch(/have not yet acknowledged live trading/);
    expect(placed).toEqual([]);
  });
});

describe("cancel_all_orders live-consent gate", () => {
  it("refuses a blanket live cancellation that could remove protective stops", async () => {
    const placed: string[] = [];
    const cancelled: string[] = [];
    const res = (await cancelAllOrdersTool.execute!(
      {
        symbol: "BTCUSDT",
        rationale: "Operator requested a full cancellation after a regime change",
      } as never,
      makeExecContext(placed, false, cancelled),
    )) as { error?: string };

    expect(res.error).toMatch(/have not yet acknowledged live trading/);
    expect(cancelled).toEqual([]);
  });

  it("keeps blanket cancellation available on a sandbox venue", async () => {
    const placed: string[] = [];
    const cancelled: string[] = [];
    const res = (await cancelAllOrdersTool.execute!(
      {
        symbol: "BTCUSDT",
        rationale: "Operator requested a full sandbox-order cancellation",
      } as never,
      makeExecContext(placed, true, cancelled),
    )) as { success?: boolean; error?: string };

    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    expect(cancelled).toEqual(["BTCUSDT"]);
  });
});

describe("cancel_order live-consent gate", () => {
  it("refuses a live cancellation whose protective status cannot be proven", async () => {
    const placed: string[] = [];
    const cancelled: string[] = [];
    const res = (await cancelOrderTool.execute!(
      {
        symbol: "BTCUSDT",
        orderId: 42,
        rationale: "Operator invalidated this resting order after review",
      } as never,
      makeExecContext(placed, false, cancelled),
    )) as { error?: string };

    expect(res.error).toMatch(/have not yet acknowledged live trading/);
    expect(cancelled).toEqual([]);
  });
});

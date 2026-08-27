/**
 * Live-consent gate on place_limit_order, which reached the venue with only a
 * kill-switch + permission-mode + risk-gate check before this gate.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONSENT_PATH_ENV } from "../../../safety/consent.ts";
import {
  cancelAllOrdersTool,
  cancelOrderListTool,
  cancelOrderTool,
  getRecentTradesTool,
  placeLimitOrderTool,
} from "./orderbook.ts";

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
    displayName: "Binance",
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

describe("cancel_order_list adapter path", () => {
  it("refuses a live list cancellation without explicit live consent", async () => {
    const cancelled: string[] = [];
    const context = makeExecContext([], false);
    const exchange = (context as any).requestContext.get("exchange");
    exchange.cancelOrderList = async (symbol: string, orderListId: number) => {
      cancelled.push(`${symbol}:${orderListId}`);
    };

    const result = (await cancelOrderListTool.execute!(
      {
        symbol: "BTCUSDT",
        orderListId: 42,
        rationale: "Both protective legs are invalid after the position was closed",
      },
      context,
    )) as { error?: string };

    expect(result.error).toMatch(/have not yet acknowledged live trading/);
    expect(cancelled).toEqual([]);
  });

  it("calls a supported sandbox adapter and reports the cancelled list", async () => {
    const cancelled: string[] = [];
    const context = makeExecContext([], true);
    const exchange = (context as any).requestContext.get("exchange");
    exchange.cancelOrderList = async (symbol: string, orderListId: number) => {
      cancelled.push(`${symbol}:${orderListId}`);
    };

    const result = (await cancelOrderListTool.execute!(
      {
        symbol: "btc/usdt",
        orderListId: 99,
        rationale: "Both sandbox order-list legs were invalidated by the strategy reset",
      },
      context,
    )) as { success?: boolean; orderListId?: number; status?: string; error?: string };

    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ success: true, orderListId: 99, status: "CANCELLED" });
    expect(cancelled).toEqual(["BTCUSDT:99"]);
  });
});

describe("get_market_trades", () => {
  it("uses public venue trades and computes side-volume dominance", async () => {
    const calls: Array<[string, number]> = [];
    const exchange = {
      getRecentTrades: async (symbol: string, limit: number) => {
        calls.push([symbol, limit]);
        return [
          { price: 100, quantity: 2, side: "BUY", time: Date.parse("2026-08-26T12:00:00Z") },
          { price: 101, quantity: 0.5, side: "SELL", time: Date.parse("2026-08-26T12:00:01Z") },
          {
            price: 99,
            quantity: 0.25,
            side: "UNKNOWN",
            time: Date.parse("2026-08-26T12:00:02Z"),
          },
        ];
      },
    };
    const values: Record<string, unknown> = { exchange };
    const context = { requestContext: { get: (key: string) => values[key] } } as never;

    const result = (await getRecentTradesTool.execute!(
      { symbol: "btc/usdt", limit: 2 },
      context,
    )) as any;

    expect(calls).toEqual([["BTCUSDT", 2]]);
    expect(result.error).toBeUndefined();
    expect(result.analysis).toEqual({
      buyVolume: "2.00000000",
      sellVolume: "0.50000000",
      unknownVolume: "0.25000000",
      ratio: "4.00",
      dominance: "BUY",
    });
    expect(result.trades).toEqual([
      {
        price: "100.00000000",
        quantity: "2.00000000",
        value: "200.00000000",
        side: "BUY",
        time: "2026-08-26T12:00:00.000Z",
      },
      {
        price: "101.00000000",
        quantity: "0.50000000",
        value: "50.50000000",
        side: "SELL",
        time: "2026-08-26T12:00:01.000Z",
      },
      {
        price: "99.00000000",
        quantity: "0.25000000",
        value: "24.75000000",
        side: "UNKNOWN",
        time: "2026-08-26T12:00:02.000Z",
      },
    ]);
  });
});

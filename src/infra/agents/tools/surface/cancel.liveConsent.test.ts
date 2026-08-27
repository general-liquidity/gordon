import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestContext } from "@mastra/core/request-context";

import { CONSENT_PATH_ENV, recordLiveConsent } from "../../../safety/consent.ts";
import { cancelTool } from "./plan.ts";

const consentPath = join(tmpdir(), `gordon-cancel-consent-${process.pid}-${Date.now()}.json`);
let priorConsentPath: string | undefined;

beforeAll(() => {
  priorConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
  if (existsSync(consentPath)) rmSync(consentPath);
});

afterAll(() => {
  if (existsSync(consentPath)) rmSync(consentPath);
  if (priorConsentPath === undefined) delete process.env[CONSENT_PATH_ENV];
  else process.env[CONSENT_PATH_ENV] = priorConsentPath;
});

function executionContext(isSandbox: boolean) {
  const calls: string[] = [];
  const requestContext = new RequestContext();
  const exchange: any = {
    exchangeId: "binance",
    isSandbox,
    getOpenOrders: async () => [
      {
        orderId: "order-1",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        executedQty: 0,
      },
    ],
    getFullAccountDetails: async () => ({
      accountInfo: { accountType: "SPOT" },
      nonZeroBalances: [],
    }),
    cancelOrder: async () => {
      calls.push("one");
    },
    cancelAllOrders: async () => {
      calls.push("all");
      return [];
    },
  };
  requestContext.set("exchange", exchange);
  return { calls, exchange, context: { requestContext } as never };
}

describe("cancel tool live-consent policy", () => {
  it("allows a live entry-order cancellation without consent", async () => {
    const { calls, context } = executionContext(false);
    const result = await cancelTool.execute!(
      {
        target: "order",
        id: "order-1",
        symbol: "BTCUSDT",
        reason: "operator requested cancellation",
      },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(true);
    expect(calls).toEqual(["one"]);
  });

  it("refuses cancelling a protective exit on a live venue without consent", async () => {
    const { calls, context, exchange } = executionContext(false);
    exchange.getOpenOrders = async () => [
      {
        orderId: "order-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "STOP_LOSS",
        quantity: 1,
        executedQty: 0,
      },
    ];
    exchange.getFullAccountDetails = async () => ({
      accountInfo: { accountType: "SPOT" },
      nonZeroBalances: [{ asset: "BTC", total: 1 }],
    });
    const result = await cancelTool.execute!(
      {
        target: "order",
        id: "order-1",
        symbol: "BTCUSDT",
        reason: "operator requested cancellation",
      },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(false);
    expect(calls).toEqual([]);
  });

  it("refuses cancelling a BUY that protects a live short derivative position", async () => {
    const { calls, context, exchange } = executionContext(false);
    exchange.getFullAccountDetails = async () => ({
      accountInfo: { accountType: "FUTURES" },
      nonZeroBalances: [],
    });
    exchange.getMarketType = async () => "derivative";
    exchange.supports = (method: string) => method === "fetchPositions";
    exchange.fetchPositions = async () => [
      {
        symbol: "BTCUSDT",
        side: "short",
        contracts: 1,
        contractSize: 1,
      },
    ];

    const result = await cancelTool.execute!(
      {
        target: "order",
        id: "order-1",
        symbol: "BTCUSDT",
        reason: "operator requested cancellation",
      },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(false);
    expect(result.error).toContain("removes_protection");
    expect(calls).toEqual([]);
  });

  it("cancel-all removes live entry risk but retains protective exits without consent", async () => {
    const { calls, context, exchange } = executionContext(false);
    exchange.getOpenOrders = async () => [
      {
        orderId: "entry-1",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        executedQty: 0,
      },
      {
        orderId: "stop-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "STOP_LOSS",
        quantity: 1,
        executedQty: 0,
      },
    ];
    exchange.getFullAccountDetails = async () => ({
      accountInfo: { accountType: "SPOT" },
      nonZeroBalances: [{ asset: "BTC", total: 1 }],
    });

    const result = await cancelTool.execute!(
      { target: "all_orders", symbol: "BTCUSDT", reason: "operator requested cancellation" },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(false);
    expect(result.cancelled).toHaveLength(1);
    expect(result.error).toContain("stop-1");
    expect(calls).toEqual(["one"]);
  });

  it("keeps an earlier all-orders cancellation when a later dispatch fails", async () => {
    const { calls, context, exchange } = executionContext(false);
    exchange.getOpenOrders = async () => [
      {
        orderId: "entry-1",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        executedQty: 0,
      },
      {
        orderId: "entry-2",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        executedQty: 0,
      },
    ];
    exchange.cancelOrder = async (_symbol: string, orderId: string) => {
      if (orderId === "entry-2") throw new Error("venue rejected second cancel");
      calls.push(orderId);
    };

    const result = await cancelTool.execute!(
      {
        target: "all_orders",
        symbol: "BTCUSDT",
        reason: "Operator is removing both pending entries after thesis invalidation",
      },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(false);
    expect(result.cancelled).toHaveLength(1);
    expect(result.error).toContain("entry-2 (cancel failed: venue rejected second cancel)");
    expect(calls).toEqual(["entry-1"]);
  });

  it("uses bulk cancel-all in a sandbox without inspecting account metadata", async () => {
    const { calls, context, exchange } = executionContext(true);
    exchange.getFullAccountDetails = async () => {
      throw new Error("inspection must not run");
    };
    const result = await cancelTool.execute!(
      {
        target: "all_orders",
        symbol: "BTCUSDT",
        reason: "operator requested cancellation",
      },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(true);
    expect(calls).toEqual(["all"]);
  });

  it("uses bulk cancellation with valid live consent without inspecting account metadata", async () => {
    recordLiveConsent();
    const { calls, context, exchange } = executionContext(false);
    exchange.getFullAccountDetails = async () => {
      throw new Error("inspection must not run");
    };
    const result = await cancelTool.execute!(
      { target: "all_orders", symbol: "BTCUSDT", reason: "operator requested cancellation" },
      context,
    );
    if (!result || !("success" in result)) throw new Error("cancel tool returned no result");
    expect(result.success).toBe(true);
    expect(calls).toEqual(["all"]);
  });
});

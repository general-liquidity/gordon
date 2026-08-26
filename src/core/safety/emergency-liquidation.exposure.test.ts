/**
 * Emergency liquidation is EXPOSURE-REDUCING, so it is not gated on live
 * consent.
 *
 * Consent gates taking on risk with real capital. Emergency liquidation is the
 * remedy for capital already at risk, and gating it behind the same
 * acknowledgement creates the trap where consent is granted, positions are
 * opened, consent expires, and the operator can no longer exit.
 *
 * The exemption is earned rather than asserted: the close order is verified
 * against the position (exit direction only, never more than what is still
 * open) before it dispatches.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exchange } from "../../infra/exchange/types.ts";
import type { Plan } from "../../types/index.ts";
import { setDatabasePathForTesting } from "../../infra/storage/database.ts";
import { createPlan } from "../../infra/storage/entities/plans.ts";
import { createTrade, listTrades, updateTrade } from "../../infra/storage/entities/trades.ts";
import { CONSENT_PATH_ENV } from "../../infra/safety/consent.ts";
import { assertConsentForExposure } from "../../infra/trading/execution/preflight.ts";
import { StrategyRuntime } from "../runtime/engine.ts";
import { resetRuntimeStore } from "../runtime/store.ts";
import { executeEmergencyLiquidation } from "./emergency-liquidation.ts";

const dbPath = join(tmpdir(), `gordon-exposure-emerg-${process.pid}-${Date.now()}.db`);
const consentPath = join(tmpdir(), `gordon-exposure-emerg-${process.pid}-${Date.now()}.json`);
let previousConsentPath: string | undefined;

beforeAll(() => {
  setDatabasePathForTesting(dbPath);
  previousConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
});

afterEach(() => {
  // Consent is never recorded in this file: every assertion below must hold
  // with the operator un-consented.
  if (existsSync(consentPath)) rmSync(consentPath);
  for (const trade of [...listTrades({ status: "OPEN" }), ...listTrades({ status: "PARTIAL" })]) {
    updateTrade(trade.id, { ...trade, status: "CLOSED", closedAt: new Date().toISOString() });
  }
});

afterAll(() => {
  setDatabasePathForTesting(null);
  // pauseAllSlots caches a Database handle inside the runtime singleton; leaving
  // it bound to this file's now-closed test DB breaks every later test file.
  StrategyRuntime.resetInstance();
  resetRuntimeStore();
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

function makeOpenTrade(opts: {
  direction: "long" | "short";
  entryQty: number;
  exitQty?: number;
}): void {
  const plan = createPlan({
    symbol: "BTCUSDT",
    direction: opts.direction,
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.01 },
    entry: { type: "limit", price: 50_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 49_000 },
    takeProfit: [{ price: 52_000, percentToSell: 1 }],
    reasoning: "emergency liquidation exposure test",
    status: "EXECUTING",
  } as unknown as Omit<Plan, "id" | "createdAt">);

  createTrade({
    planId: plan.id,
    openedAt: new Date().toISOString(),
    closedAt: null,
    symbol: "BTCUSDT",
    entries: [
      {
        orderId: "entry-1",
        price: 50_000,
        quantity: opts.entryQty,
        filledAt: new Date().toISOString(),
      },
    ],
    exits: opts.exitQty
      ? [
          {
            orderId: "exit-1",
            price: 50_500,
            quantity: opts.exitQty,
            filledAt: new Date().toISOString(),
            reason: "TP1" as const,
          },
        ]
      : [],
    averageEntry: 50_000,
    realizedPnl: 0,
    realizedPnlPercent: 0,
    status: opts.exitQty ? "PARTIAL" : "OPEN",
  });
}

interface PlacedOrder {
  symbol: string;
  side: string;
  quantity: number;
}

function makeExchange(isSandbox: boolean, placed: PlacedOrder[]): Exchange {
  return {
    exchangeId: "binance",
    isSandbox,
    getOpenOrders: async () => [],
    cancelOrder: async () => undefined,
    placeOrder: async (params: { symbol: string; side: string; quantity: number }) => {
      placed.push({ symbol: params.symbol, side: params.side, quantity: params.quantity });
      return {
        orderId: "emerg-1",
        symbol: params.symbol,
        side: params.side,
        type: "MARKET",
        status: "FILLED",
        price: 49_500,
        quantity: params.quantity,
        executedQty: params.quantity,
        cummulativeQuoteQty: 49_500 * params.quantity,
      };
    },
  } as unknown as Exchange;
}

describe("emergency liquidation is exposure-reducing, not consent-gated", () => {
  it("closes a live position without recorded consent", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02 });
    const placed: PlacedOrder[] = [];
    const result = await executeEmergencyLiquidation(makeExchange(false, placed), []);

    expect(result.errors).toEqual([]);
    expect(result.positionsClosed).toBe(1);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.symbol).toBe("BTCUSDT");
  });

  it("still refuses an exposure-increasing order on the same un-consented live venue", () => {
    expect(() =>
      assertConsentForExposure({ isSandbox: false }, "test.open_position", {
        direction: "INCREASES_EXPOSURE",
      }),
    ).toThrow(/have not yet acknowledged live trading/);
  });

  it("never closes more than the quantity still open", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02, exitQty: 0.005 });
    const placed: PlacedOrder[] = [];
    await executeEmergencyLiquidation(makeExchange(false, placed), []);

    expect(placed).toHaveLength(1);
    expect(placed[0]?.quantity).toBeCloseTo(0.015, 10);
  });

  it("trades the exit side only — SELL to close a long", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02 });
    const placed: PlacedOrder[] = [];
    await executeEmergencyLiquidation(makeExchange(false, placed), []);

    expect(placed[0]?.side).toBe("SELL");
  });

  it("trades the exit side only — BUY to close a short", async () => {
    makeOpenTrade({ direction: "short", entryQty: 0.02 });
    const placed: PlacedOrder[] = [];
    await executeEmergencyLiquidation(makeExchange(false, placed), []);

    expect(placed[0]?.side).toBe("BUY");
  });

  it("dispatches nothing when the position is already fully exited", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02, exitQty: 0.02 });
    const placed: PlacedOrder[] = [];
    const result = await executeEmergencyLiquidation(makeExchange(false, placed), []);

    expect(placed).toEqual([]);
    expect(result.positionsClosed).toBe(0);
  });

  it("cancels resting orders without consent", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02 });
    const cancelled: string[] = [];
    let orderOpen = true;
    const exchange = {
      exchangeId: "binance",
      isSandbox: false,
      getOpenOrders: async () =>
        orderOpen ? [{ orderId: 991, clientOrderId: "gordon_x", symbol: "BTCUSDT" }] : [],
      cancelOrder: async (_symbol: string, orderId: string) => {
        cancelled.push(orderId);
        orderOpen = false;
      },
      placeOrder: async (params: { symbol: string; side: string; quantity: number }) => ({
        orderId: "emerg-1",
        symbol: params.symbol,
        side: params.side,
        type: "MARKET",
        status: "FILLED",
        price: 49_500,
        quantity: params.quantity,
        executedQty: params.quantity,
        cummulativeQuoteQty: 49_500 * params.quantity,
      }),
    } as unknown as Exchange;

    const result = await executeEmergencyLiquidation(exchange, []);

    expect(cancelled).toEqual(["991"]);
    expect(result.ordersCancelled).toBe(1);
  });

  it("recognizes adapter-generated gordon-hyphen order ids during cleanup", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02 });
    const cancelled: string[] = [];
    let orderOpen = true;
    const exchange = {
      exchangeId: "binance",
      isSandbox: false,
      getOpenOrders: async () =>
        orderOpen
          ? [
              {
                orderId: 994,
                clientOrderId: "gordon-0123456789abcdef",
                symbol: "BTCUSDT",
                side: "BUY",
                type: "LIMIT",
                quantity: 0.01,
              },
            ]
          : [],
      cancelOrder: async (_symbol: string, orderId: string) => {
        cancelled.push(orderId);
        orderOpen = false;
      },
      placeOrder: async (params: { symbol: string; side: string; quantity: number }) => ({
        orderId: "emerg-hyphen",
        symbol: params.symbol,
        side: params.side,
        type: "MARKET",
        status: "FILLED",
        price: 49_500,
        quantity: params.quantity,
        executedQty: params.quantity,
        cummulativeQuoteQty: 49_500 * params.quantity,
      }),
    } as unknown as Exchange;

    const result = await executeEmergencyLiquidation(exchange, []);

    expect(cancelled).toEqual(["994"]);
    expect(result.ordersCancelled).toBe(1);
  });

  it("preserves a stop before a same-side profit order when only one exit fits", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02 });
    const events: string[] = [];
    let openOrders = [
      {
        orderId: 995,
        clientOrderId: "gordon_tp",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "TAKE_PROFIT_LIMIT",
        quantity: 0.02,
      },
      {
        orderId: 996,
        clientOrderId: "gordon_stop",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "STOP_LOSS_LIMIT",
        quantity: 0.02,
      },
    ];
    const exchange = {
      exchangeId: "binance",
      isSandbox: false,
      getOpenOrders: async () => openOrders,
      cancelOrder: async (_symbol: string, orderId: string) => {
        events.push(`cancel:${orderId}`);
        openOrders = openOrders.filter((order) => String(order.orderId) !== orderId);
      },
      placeOrder: async (params: { symbol: string; side: string; quantity: number }) => {
        events.push("close");
        return {
          orderId: "emerg-priority",
          symbol: params.symbol,
          side: params.side,
          type: "MARKET",
          status: "FILLED",
          price: 49_500,
          quantity: params.quantity,
          executedQty: params.quantity,
          cummulativeQuoteQty: 49_500 * params.quantity,
        };
      },
    } as unknown as Exchange;

    await executeEmergencyLiquidation(exchange, []);

    expect(events).toEqual(["cancel:995", "close", "cancel:996"]);
  });

  it("keeps a protective exit live when the emergency market close fails", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02 });
    const cancelled: string[] = [];
    const exchange = {
      exchangeId: "binance",
      isSandbox: false,
      getOpenOrders: async () => [
        {
          orderId: 992,
          clientOrderId: "gordon_stop",
          symbol: "BTCUSDT",
          side: "SELL",
          quantity: 0.02,
        },
      ],
      cancelOrder: async (_symbol: string, orderId: string) => {
        cancelled.push(orderId);
      },
      placeOrder: async () => {
        throw new Error("venue unavailable");
      },
    } as unknown as Exchange;

    const result = await executeEmergencyLiquidation(exchange, []);

    expect(cancelled).toEqual([]);
    expect(result.positionsClosed).toBe(0);
    expect(result.errors.some((error) => error.includes("venue unavailable"))).toBe(true);
  });

  it("cancels a protective exit only after its replacement close succeeds", async () => {
    makeOpenTrade({ direction: "long", entryQty: 0.02 });
    const events: string[] = [];
    let orderOpen = true;
    const exchange = {
      exchangeId: "binance",
      isSandbox: false,
      getOpenOrders: async () =>
        orderOpen
          ? [
              {
                orderId: 993,
                clientOrderId: "gordon_stop",
                symbol: "BTCUSDT",
                side: "SELL",
                quantity: 0.02,
              },
            ]
          : [],
      cancelOrder: async () => {
        events.push("cancel");
        orderOpen = false;
      },
      placeOrder: async (params: { symbol: string; side: string; quantity: number }) => {
        events.push("close");
        return {
          orderId: "emerg-2",
          symbol: params.symbol,
          side: params.side,
          type: "MARKET",
          status: "FILLED",
          price: 49_500,
          quantity: params.quantity,
          executedQty: params.quantity,
          cummulativeQuoteQty: 49_500 * params.quantity,
        };
      },
    } as unknown as Exchange;

    const result = await executeEmergencyLiquidation(exchange, []);

    expect(events).toEqual(["close", "cancel"]);
    expect(result.positionsClosed).toBe(1);
    expect(result.ordersCancelled).toBe(1);
  });
});

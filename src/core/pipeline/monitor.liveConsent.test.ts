/**
 * Live-consent gate on the monitor's grid take-profit dispatch site.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exchange } from "../../infra/exchange/index.ts";
import type { Plan, Trade } from "../../types/index.ts";
import { setDatabasePathForTesting } from "../../infra/storage/database.ts";
import { createPlan } from "../../infra/storage/entities/plans.ts";
import { createTrade, updateTrade } from "../../infra/storage/entities/trades.ts";
import { CONSENT_PATH_ENV } from "../../infra/safety/consent.ts";
import {
  calculateRealizedPnl,
  calculateUnrealizedPnl,
  placeGridTakeProfits,
  remainingTradeQuantity,
} from "./monitor.ts";
import type { OrderParams } from "../../infra/exchange/index.ts";
import { generateDeterministicClientOrderId } from "./executor.ts";

const dbPath = join(tmpdir(), `gordon-consent-monitor-${process.pid}-${Date.now()}.db`);
const consentPath = join(tmpdir(), `gordon-consent-monitor-${process.pid}-${Date.now()}.json`);
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

const GRID_PRICES = [49_000, 48_000, 47_000];

function makeGridTrade(): Trade {
  const plan = createPlan({
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "grid_entry",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.01 },
    entry: { type: "limit", price: 49_000 },
    dca: null,
    grid: {
      levels: GRID_PRICES.map((price) => ({ price, percentOfAllocation: 1 / 3 })),
      distribution: "equal",
      priceRange: { high: 49_000, low: 47_000 },
    },
    stopLoss: { price: 46_000 },
    takeProfit: [{ price: 52_000, percentToSell: 1 }],
    reasoning: "grid consent test",
    status: "EXECUTING",
  } as unknown as Omit<Plan, "id" | "createdAt">);

  return createTrade({
    planId: plan.id,
    openedAt: new Date().toISOString(),
    closedAt: null,
    symbol: "BTCUSDT",
    entries: GRID_PRICES.map((price, i) => ({
      orderId: `entry-${i}`,
      price,
      quantity: 0.01,
      filledAt: new Date().toISOString(),
    })),
    exits: [],
    averageEntry: 48_000,
    realizedPnl: 0,
    realizedPnlPercent: 0,
    status: "OPEN",
  });
}

function makeExchange(isSandbox: boolean, placed: OrderParams[], trade: Trade): Exchange {
  return {
    exchangeId: "binance",
    isSandbox,
    getPrice: async () => 53_000,
    getOrderHistory: async () =>
      GRID_PRICES.map((price, index) => ({
        orderId: `entry-${index}`,
        clientOrderId: generateDeterministicClientOrderId(trade.planId, `grid${index + 1}`),
        symbol: trade.symbol,
        side: "BUY" as const,
        type: "LIMIT" as const,
        status: "FILLED" as const,
        price,
        quantity: 0.01,
        executedQty: 0.01,
        cummulativeQuoteQty: price * 0.01,
      })),
    getOpenOrders: async () => [],
    cancelOrder: async () => undefined,
    placeOrder: async (params: OrderParams) => {
      placed.push(params);
      return {
        orderId: `tp-${placed.length}`,
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        status: "FILLED",
        price: 53_000,
        quantity: params.quantity ?? 0,
        executedQty: params.quantity ?? 0,
        cummulativeQuoteQty: 53_000 * (params.quantity ?? 0),
      };
    },
  } as unknown as Exchange;
}

describe("placeGridTakeProfits live-consent gate", () => {
  it("allows a verified exposure reduction on a live venue without fresh consent", async () => {
    const placed: OrderParams[] = [];
    const trade = makeGridTrade();
    const result = await placeGridTakeProfits(trade, makeExchange(false, placed, trade));

    expect(result.success).toBe(true);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.side).toBe("SELL");
    expect(placed[0]!.quantity).toBeCloseTo(0.03, 8);
  });

  it("never replaces quantity that a manual exit already closed", async () => {
    const trade = makeGridTrade();
    trade.exits.push({
      orderId: "manual-partial",
      price: 50_000,
      quantity: 0.01,
      filledAt: new Date().toISOString(),
      reason: "MANUAL",
    });
    updateTrade(trade.id, { exits: trade.exits, status: "PARTIAL" });
    const placed: OrderParams[] = [];
    const result = await placeGridTakeProfits(trade, makeExchange(false, placed, trade));

    expect(result.success).toBe(true);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.quantity).toBeCloseTo(0.02, 6);
  });
});

describe("remainingTradeQuantity", () => {
  it("subtracts every filled exit and never crosses below zero", () => {
    expect(
      remainingTradeQuantity({
        entries: [
          { orderId: "e1", price: 100, quantity: 2, filledAt: "now" },
          { orderId: "e2", price: 90, quantity: 1, filledAt: "now" },
        ],
        exits: [
          { orderId: "x1", price: 110, quantity: 1, filledAt: "now", reason: "MANUAL" },
          { orderId: "x2", price: 115, quantity: 0.5, filledAt: "now", reason: "TP1" },
        ],
      }),
    ).toBeCloseTo(1.5, 6);

    expect(
      remainingTradeQuantity({
        entries: [{ orderId: "e", price: 100, quantity: 1, filledAt: "now" }],
        exits: [{ orderId: "x", price: 90, quantity: 2, filledAt: "now", reason: "STOP" }],
      }),
    ).toBe(0);
  });
});

describe("short-position PnL", () => {
  const trade = {
    entries: [{ orderId: "e", price: 100, quantity: 2, filledAt: "now" }],
    exits: [{ orderId: "x", price: 90, quantity: 0.5, filledAt: "now", reason: "TP1" }],
    averageEntry: 100,
  } as Trade;

  it("reports a falling price as positive unrealized PnL for a short", () => {
    expect(calculateUnrealizedPnl(trade, 80, { direction: "short" })).toEqual({
      unrealizedPnl: 30,
      unrealizedPnlPercent: 20,
    });
  });

  it("reports a lower confirmed exit as positive realized PnL for a short", () => {
    expect(calculateRealizedPnl(trade, { direction: "short" })).toEqual({
      realizedPnl: 5,
      realizedPnlPercent: 10,
    });
  });
});

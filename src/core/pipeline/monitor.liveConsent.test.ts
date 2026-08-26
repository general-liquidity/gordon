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
import { createTrade } from "../../infra/storage/entities/trades.ts";
import { CONSENT_PATH_ENV, recordLiveConsent } from "../../infra/safety/consent.ts";
import { placeGridTakeProfits, remainingTradeQuantity } from "./monitor.ts";
import type { OrderParams } from "../../infra/exchange/index.ts";

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

function makeExchange(isSandbox: boolean, placed: OrderParams[]): Exchange {
  return {
    exchangeId: "binance",
    isSandbox,
    getPrice: async () => 48_500,
    getOpenOrders: async () => [],
    placeOrder: async (params: OrderParams) => {
      placed.push(params);
      return {
        orderId: `tp-${placed.length}`,
        symbol: params.symbol,
        side: "SELL",
        type: "LIMIT",
        status: "NEW",
        price: 52_000,
        quantity: 0.03,
        executedQty: 0,
        cummulativeQuoteQty: 0,
      };
    },
  } as unknown as Exchange;
}

describe("placeGridTakeProfits live-consent gate", () => {
  it("allows a verified exposure reduction on a live venue without fresh consent", async () => {
    const placed: OrderParams[] = [];
    const result = await placeGridTakeProfits(makeGridTrade(), makeExchange(false, placed));

    expect(result.success).toBe(true);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.side).toBe("SELL");
    expect(placed[0]!.quantity).toBeCloseTo(0.03, 8);
  });

  it("never replaces quantity that a manual exit already closed", async () => {
    recordLiveConsent();
    const trade = makeGridTrade();
    trade.exits.push({
      orderId: "manual-partial",
      price: 50_000,
      quantity: 0.01,
      filledAt: new Date().toISOString(),
      reason: "MANUAL",
    });
    const placed: OrderParams[] = [];
    const result = await placeGridTakeProfits(trade, makeExchange(false, placed));

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

/**
 * `executeTrailingStop` market-closes the remainder of a position, so it is
 * EXPOSURE-REDUCING and is not gated on live consent. (Placing a resting stop
 * order is a different act and is not what this site does.)
 *
 * Direction is part of the protective contract: longs exit with SELL, shorts
 * with BUY, and PnL changes sign with the position direction.
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
import { CONSENT_PATH_ENV } from "../../infra/safety/consent.ts";
import { assertConsentForExposure } from "../../infra/trading/execution/preflight.ts";
import { TrailingStopTracker } from "./trailing-stop.ts";

const dbPath = join(tmpdir(), `gordon-exposure-tsl-${process.pid}-${Date.now()}.db`);
const consentPath = join(tmpdir(), `gordon-exposure-tsl-${process.pid}-${Date.now()}.json`);
let previousConsentPath: string | undefined;

beforeAll(() => {
  setDatabasePathForTesting(dbPath);
  previousConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
});

afterEach(() => {
  // Consent is never recorded in this file.
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

function makeOpenTrade(direction: "long" | "short" = "long", exitQty = 0): Trade {
  const plan = createPlan({
    symbol: "BTCUSDT",
    direction,
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.01 },
    entry: { type: "limit", price: 50_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 49_000 },
    takeProfit: [{ price: 52_000, percentToSell: 1 }],
    reasoning: "trailing stop exposure test",
    status: "EXECUTING",
  } as unknown as Omit<Plan, "id" | "createdAt">);

  return createTrade({
    planId: plan.id,
    openedAt: new Date().toISOString(),
    closedAt: null,
    symbol: "BTCUSDT",
    entries: [
      { orderId: "entry-1", price: 50_000, quantity: 0.02, filledAt: new Date().toISOString() },
    ],
    exits: exitQty
      ? [
          {
            orderId: "exit-1",
            price: 51_000,
            quantity: exitQty,
            filledAt: new Date().toISOString(),
            reason: "TP1" as const,
          },
        ]
      : [],
    averageEntry: 50_000,
    realizedPnl: 0,
    realizedPnlPercent: 0,
    status: exitQty ? "PARTIAL" : "OPEN",
  });
}

interface PlacedOrder {
  symbol: string;
  side: string;
  quantity: number;
}

function makeClient(isSandbox: boolean, placed: PlacedOrder[]): Exchange {
  return {
    exchangeId: "binance",
    isSandbox,
    getOrderHistory: async () => [],
    getOpenOrders: async () => [],
    placeOrder: async (params: { symbol: string; side: string; quantity: number }) => {
      placed.push({ symbol: params.symbol, side: params.side, quantity: params.quantity });
      return {
        orderId: "tsl-exit-1",
        symbol: params.symbol,
        side: params.side,
        type: "MARKET",
        status: "FILLED",
        price: 51_000,
        quantity: params.quantity,
        executedQty: params.quantity,
        cummulativeQuoteQty: 51_000 * params.quantity,
      };
    },
  } as unknown as Exchange;
}

function trackerFor(trade: Trade): TrailingStopTracker {
  const tracker = new TrailingStopTracker();
  tracker.addTrailingStop({
    tradeId: trade.id,
    symbol: trade.symbol,
    type: "percentage",
    trailDistance: 0.03,
    initialHighPrice: 52_000,
  });
  return tracker;
}

describe("executeTrailingStop is exposure-reducing, not consent-gated", () => {
  it("closes a live long position without recorded consent", async () => {
    const trade = makeOpenTrade();
    const placed: PlacedOrder[] = [];
    const result = await trackerFor(trade).executeTrailingStop(makeClient(false, placed), trade.id);

    expect(result.success).toBe(true);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.side).toBe("SELL");
  });

  it("still refuses an exposure-increasing order on the same un-consented live venue", () => {
    expect(() =>
      assertConsentForExposure({ isSandbox: false }, "test.open_position", {
        direction: "INCREASES_EXPOSURE",
      }),
    ).toThrow(/have not yet acknowledged live trading/);
  });

  it("never closes more than the quantity still open", async () => {
    const trade = makeOpenTrade("long", 0.005);
    const placed: PlacedOrder[] = [];
    await trackerFor(trade).executeTrailingStop(makeClient(false, placed), trade.id);

    expect(placed).toHaveLength(1);
    expect(placed[0]?.quantity).toBeLessThanOrEqual(0.015);
    expect(placed[0]?.quantity).toBeCloseTo(0.015, 8);
  });

  it("closes a short with BUY and applies short-direction PnL", async () => {
    const trade = makeOpenTrade("short");
    const placed: PlacedOrder[] = [];
    const result = await trackerFor(trade).executeTrailingStop(makeClient(false, placed), trade.id);

    expect(result.success).toBe(true);
    expect(result.pnl).toBeCloseTo(-20, 8);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.side).toBe("BUY");
  });
});

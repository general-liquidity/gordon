/**
 * Live-consent gate on the trailing-stop exit dispatch site.
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
import { TrailingStopTracker } from "./trailing-stop.ts";

const dbPath = join(tmpdir(), `gordon-consent-tsl-${process.pid}-${Date.now()}.db`);
const consentPath = join(tmpdir(), `gordon-consent-tsl-${process.pid}-${Date.now()}.json`);
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

function makeOpenTrade(): Trade {
  const plan = createPlan({
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.01 },
    entry: { type: "limit", price: 50_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 49_000 },
    takeProfit: [{ price: 52_000, percentToSell: 1 }],
    reasoning: "trailing stop consent test",
    status: "EXECUTING",
  } as unknown as Omit<Plan, "id" | "createdAt">);

  return createTrade({
    planId: plan.id,
    openedAt: new Date().toISOString(),
    closedAt: null,
    symbol: "BTCUSDT",
    entries: [{ orderId: "entry-1", price: 50_000, quantity: 0.02, filledAt: new Date().toISOString() }],
    exits: [],
    averageEntry: 50_000,
    realizedPnl: 0,
    realizedPnlPercent: 0,
    status: "OPEN",
  });
}

function makeClient(isSandbox: boolean, placed: string[]): Exchange {
  return {
    exchangeId: "binance",
    isSandbox,
    placeOrder: async (params: { symbol: string }) => {
      placed.push(params.symbol);
      return {
        orderId: "tsl-exit-1",
        symbol: params.symbol,
        side: "SELL",
        type: "MARKET",
        status: "FILLED",
        price: 51_000,
        quantity: 0.02,
        executedQty: 0.02,
        cummulativeQuoteQty: 1020,
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

describe("executeTrailingStop live-consent gate", () => {
  it("refuses to dispatch on a live venue without consent", async () => {
    const trade = makeOpenTrade();
    const placed: string[] = [];
    const result = await trackerFor(trade).executeTrailingStop(makeClient(false, placed), trade.id);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/have not yet acknowledged live trading/);
    expect(placed).toEqual([]);
  });

  it("dispatches on a live venue once consent is recorded", async () => {
    recordLiveConsent();
    const trade = makeOpenTrade();
    const placed: string[] = [];
    const result = await trackerFor(trade).executeTrailingStop(makeClient(false, placed), trade.id);

    expect(result.success).toBe(true);
    expect(placed).toEqual(["BTCUSDT"]);
  });
});

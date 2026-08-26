/**
 * Live-consent gate on the emergency-liquidation dispatch site.
 *
 * Emergency liquidation closes positions with market orders, so it reaches the
 * venue like any other execution path and is gated the same way. Without
 * consent the refusal is reported in `errors` rather than silently dispatching.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exchange } from "../../infra/exchange/types.ts";
import type { Plan } from "../../types/index.ts";
import { setDatabasePathForTesting } from "../../infra/storage/database.ts";
import { createPlan } from "../../infra/storage/entities/plans.ts";
import { createTrade } from "../../infra/storage/entities/trades.ts";
import { CONSENT_PATH_ENV, recordLiveConsent } from "../../infra/safety/consent.ts";
import { StrategyRuntime } from "../runtime/engine.ts";
import { resetRuntimeStore } from "../runtime/store.ts";
import { executeEmergencyLiquidation } from "./emergency-liquidation.ts";

const dbPath = join(tmpdir(), `gordon-consent-emerg-${process.pid}-${Date.now()}.db`);
const consentPath = join(tmpdir(), `gordon-consent-emerg-${process.pid}-${Date.now()}.json`);
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

function makeOpenTrade(): void {
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
    reasoning: "emergency liquidation consent test",
    status: "EXECUTING",
  } as unknown as Omit<Plan, "id" | "createdAt">);

  createTrade({
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

function makeExchange(isSandbox: boolean, placed: string[]): Exchange {
  return {
    exchangeId: "binance",
    isSandbox,
    getOpenOrders: async () => [],
    cancelOrder: async () => undefined,
    placeOrder: async (params: { symbol: string }) => {
      placed.push(params.symbol);
      return {
        orderId: "emerg-1",
        symbol: params.symbol,
        side: "SELL",
        type: "MARKET",
        status: "FILLED",
        price: 49_500,
        quantity: 0.02,
        executedQty: 0.02,
        cummulativeQuoteQty: 990,
      };
    },
  } as unknown as Exchange;
}

describe("executeEmergencyLiquidation live-consent gate", () => {
  it("refuses to dispatch on a live venue without consent", async () => {
    makeOpenTrade();
    const placed: string[] = [];
    const result = await executeEmergencyLiquidation(makeExchange(false, placed), []);

    expect(result.positionsClosed).toBe(0);
    expect(placed).toEqual([]);
    expect(result.errors.join(" ")).toMatch(/have not yet acknowledged live trading/);
  });

  it("dispatches on a live venue once consent is recorded", async () => {
    recordLiveConsent();
    const placed: string[] = [];
    const result = await executeEmergencyLiquidation(makeExchange(false, placed), []);

    expect(result.positionsClosed).toBeGreaterThan(0);
    expect(placed).toContain("BTCUSDT");
  });
});

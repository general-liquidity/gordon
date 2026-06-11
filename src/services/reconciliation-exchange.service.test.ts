import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getDatabase, setDatabasePathForTesting } from "../infra/storage/database.ts";
import { createPlan, getPlan } from "../infra/storage/entities/plans.ts";
import type { Exchange } from "../infra/exchange/types.ts";
import type { Plan, PlanStatus } from "../types/index.ts";
import { reconcileWithExchange } from "./reconciliation-exchange.service.ts";

const fakeExchange = {
  exchangeId: "test-exchange",
  getOrderHistory: async () => [],
  getOpenOrders: async () => [],
  cancelOrder: async () => ({}),
} as unknown as Exchange;

function makePlan(status: PlanStatus, expiresAt: string): Plan {
  return createPlan({
    expiresAt,
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 100, percentOfPortfolio: 1 },
    entry: { type: "limit", price: 50_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 45_000 },
    takeProfit: [{ price: 60_000, percentToSell: 1 }],
    reasoning: "test plan",
    status,
  });
}

describe("reconcileWithExchange expired-plan prune", () => {
  let dir: string;
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-reconcile-svc-"));
    setDatabasePathForTesting(join(dir, "gordon.db"));
  });

  afterAll(() => {
    setDatabasePathForTesting(null);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can keep SQLite WAL handles open briefly after close;
      // leftover temp dirs are harmless.
    }
  });

  it("cancels expired DRAFT/APPROVED plans, preserves EXECUTING and unexpired plans", async () => {
    const expiredDraft = makePlan("DRAFT", past);
    const expiredApproved = makePlan("APPROVED", past);
    const expiredExecuting = makePlan("EXECUTING", past);
    const freshDraft = makePlan("DRAFT", future);

    const result = await reconcileWithExchange(fakeExchange);

    expect(result.success).toBe(true);
    expect(result.plansExpired).toBe(2);

    expect(getPlan(expiredDraft.id)?.status).toBe("CANCELLED");
    expect(getPlan(expiredApproved.id)?.status).toBe("CANCELLED");
    // An expired EXECUTING plan may have live exchange orders/positions —
    // expiry must never auto-cancel it.
    expect(getPlan(expiredExecuting.id)?.status).toBe("EXECUTING");
    expect(getPlan(freshDraft.id)?.status).toBe("DRAFT");

    // Audit trail: prune is a status transition with a PLAN_EXPIRED event,
    // never a hard delete.
    const events = getDatabase()
      .query("SELECT data FROM events")
      .all() as Array<{ data: string }>;
    const expiredEvents = events.filter((e) => e.data.includes("PLAN_EXPIRED"));
    expect(expiredEvents.length).toBe(2);
  });

  it("prunes again on subsequent cycles without double-counting", async () => {
    const result = await reconcileWithExchange(fakeExchange);
    expect(result.plansExpired).toBe(0);
  });
});

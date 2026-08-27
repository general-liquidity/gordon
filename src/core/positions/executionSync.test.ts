import { describe, it, expect } from "bun:test";
import type { Plan } from "../../types/plan.ts";
import type { Trade } from "../../types/trade.ts";
import { installTempGordonHome } from "../../test-utils/tempGordonHome.ts";
import { recordExecutedPlanPosition } from "./executionSync.ts";
import { getPositionStore } from "./store.ts";

installTempGordonHome("gordon-execsync-test-");

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "p1",
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    status: "EXECUTING",
    allocation: { currency: "USDT", amount: 100, percentOfPortfolio: 0.001 },
    entry: { type: "market", price: 50_000 },
    stopLoss: { price: 49_000 },
    takeProfit: [],
    reasoning: "sync test",
    dca: null,
    grid: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    symbol: "BTCUSDT",
    status: "OPEN",
    planId: "p1",
    averageEntry: 50_000,
    entries: [
      {
        orderId: "o1",
        quantity: 0.002,
        price: 50_000,
        filledAt: new Date().toISOString(),
      },
    ],
    exits: [],
    realizedPnl: 0,
    realizedPnlPercent: 0,
    openedAt: new Date().toISOString(),
    closedAt: null,
    ...overrides,
  };
}

describe("executionSync", () => {
  it("records a filled position with positive entry data in the isolated store", async () => {
    const positionId = await recordExecutedPlanPosition(makePlan(), makeTrade(), "binance");
    expect(positionId).not.toBeNull();

    const store = await getPositionStore();
    const position = await store.get(positionId!);
    expect(position?.state).toBe("filled");
    expect(position?.entryPrice).toBe(50_000);
    expect(position?.quantity).toBe(0.002);
    expect(position?.stopLoss).toBe(49_000);
  });

  it("falls back to the plan price for an unfilled limit entry (averageEntry 0)", async () => {
    const plan = makePlan({ entry: { type: "limit", price: 40_000 } });
    const trade = makeTrade({ averageEntry: 0, entries: [] });

    const positionId = await recordExecutedPlanPosition(plan, trade, "binance");
    expect(positionId).not.toBeNull();

    const store = await getPositionStore();
    const position = await store.get(positionId!);
    expect(position?.state).toBe("filled");
    expect(position?.entryPrice).toBe(40_000);
    expect(position?.quantity).toBeCloseTo(100 / 40_000);
  });

  it("phantom guard: no usable fill data cancels instead of persisting a zero-qty position", async () => {
    const plan = makePlan({ entry: { type: "market", price: null } });
    const trade = makeTrade({ averageEntry: 0, entries: [] });

    const positionId = await recordExecutedPlanPosition(plan, trade, "binance");
    expect(positionId).toBeNull();

    // No active debris: anything created on the way must be terminal.
    const store = await getPositionStore();
    const active = await store.getActive();
    expect(active.length).toBe(0);
    const cancelled = await store.getByState("cancelled");
    expect(cancelled.length).toBe(1);
    expect(cancelled[0]?.cancelReason).toContain("phantom guard");
  });
});

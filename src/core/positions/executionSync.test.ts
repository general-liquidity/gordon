import { describe, it, expect } from "bun:test";
import type { Plan } from "../../types/plan.ts";
import type { Trade } from "../../types/trade.ts";

describe("executionSync", () => {
  it("recordExecutedPlanPosition is importable and non-throwing on missing bus", async () => {
    const { recordExecutedPlanPosition } = await import("./executionSync.ts");
    const plan: Plan = {
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
    };
    const trade: Trade = {
      id: "t1",
      symbol: "BTCUSDT",
      status: "OPEN",
      planId: "p1",
      averageEntry: 50_000,
      entries: [{
        orderId: "o1",
        quantity: 0.002,
        price: 50_000,
        filledAt: new Date().toISOString(),
      }],
      exits: [],
      realizedPnl: 0,
      realizedPnlPercent: 0,
      openedAt: new Date().toISOString(),
      closedAt: null,
    };
    const positionId = await recordExecutedPlanPosition(plan, trade, "binance");
    expect(positionId === null || typeof positionId === "string").toBe(true);
  });
});
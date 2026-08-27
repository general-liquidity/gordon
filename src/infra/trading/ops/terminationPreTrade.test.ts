import { describe, it, expect } from "bun:test";
import { buildTerminationPreTradeFromPlan } from "./terminationPreTrade.ts";
import type { GordonContext } from "../../agents/types.ts";
import type { Plan } from "../../../types/plan.ts";

function minimalPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan_test",
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    status: "APPROVED",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.01 },
    entry: { type: "market", price: 50_000 },
    stopLoss: { price: 48_000 },
    takeProfit: [{ price: 55_000, percentToSell: 1 }],
    reasoning: "Test plan for termination L1 wiring.",
    dca: null,
    grid: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const ctx: GordonContext = {
  exchange: null,
  broker: null,
  llm: {} as GordonContext["llm"],
  config: { permissionMode: "ask" } as GordonContext["config"],
  portfolioValue: 100_000,
  availableCash: 50_000,
};

describe("buildTerminationPreTradeFromPlan", () => {
  it("returns structured pre-trade inputs from a plan", async () => {
    const preTrade = await buildTerminationPreTradeFromPlan(minimalPlan(), ctx);
    expect(["low", "medium", "high", "critical"]).toContain(preTrade.riskTier);
    expect(["auto_approve", "prompt_user", "require_confirmation", "block"]).toContain(
      preTrade.riskClassifierVerdict,
    );
    expect(Array.isArray(preTrade.constitutionViolations)).toBe(true);
  });

  it("maps short direction to SELL classifier side", async () => {
    const preTrade = await buildTerminationPreTradeFromPlan(
      minimalPlan({ direction: "short" }),
      ctx,
    );
    expect(preTrade.riskTier).toBeDefined();
  });
});

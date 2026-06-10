import { describe, it, expect } from "bun:test";
import {
  checkPreTrade,
  isTerminationLayersEnforceEnabled,
} from "../../../trading/ops/terminationLayers.ts";
import { buildTerminationPreTradeFromPlan } from "../../../trading/ops/terminationPreTrade.ts";
import type { GordonContext } from "../../../agents/types.ts";
import type { Plan } from "../../../../types/plan.ts";

const ctx: GordonContext = {  exchange: null,
  broker: null,
  llm: {} as GordonContext["llm"],
  config: { permissionMode: "ask" } as GordonContext["config"],
  portfolioValue: 100_000,
  availableCash: 50_000,
};

const plan: Plan = {
  id: "plan_enforce",
  symbol: "BTCUSDT",
  direction: "long",
  strategy: "support_bounce",
  status: "APPROVED",
  allocation: { currency: "USDT", amount: 500, percentOfPortfolio: 0.005 },
  entry: { type: "market", price: 50_000 },
  stopLoss: { price: 49_000 },
  takeProfit: [{ price: 52_000, percentToSell: 1 }],
  reasoning: "Enforce-mode termination L1 regression plan.",
  dca: null,
  grid: null,
  createdAt: new Date().toISOString(),
};

describe("termination L1 enforce wiring", () => {
  it("buildTerminationPreTradeFromPlan feeds checkPreTrade", async () => {
    const preTrade = await buildTerminationPreTradeFromPlan(plan, ctx);
    const verdict = checkPreTrade(preTrade);
    expect(["pass", "warn", "fail"]).toContain(verdict.status);
  });

  it("enforce flag is opt-in via env", () => {
    const prev = process.env.GORDON_TERMINATION_LAYERS_ENFORCE;
    delete process.env.GORDON_TERMINATION_LAYERS_ENFORCE;
    expect(isTerminationLayersEnforceEnabled()).toBe(false);
    if (prev !== undefined) process.env.GORDON_TERMINATION_LAYERS_ENFORCE = prev;
  });
});
import { describe, it, expect } from "bun:test";
import {
  checkPreTrade,
  isTerminationLayersEnforceEnabled,
  type PreTradeInput,
} from "../../../trading/ops/terminationLayers.ts";
import { buildTerminationPreTradeFromPlan } from "../../../trading/ops/terminationPreTrade.ts";
import type { GordonContext } from "../../../agents/types.ts";
import type { Plan } from "../../../../types/plan.ts";

const ctx: GordonContext = {
  exchange: null,
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

const CLEAR: PreTradeInput = {
  riskTier: "low",
  riskClassifierVerdict: "auto_approve",
  constitutionViolations: [],
  mandateScopeOk: true,
  thesisCoherenceOk: true,
};

describe("termination L1 gate", () => {
  it("passes when nothing blocks, and emits no fix instruction", () => {
    const verdict = checkPreTrade(CLEAR);
    expect(verdict.status).toBe("pass");
    expect(verdict.fixInstruction).toBeUndefined();
    expect(verdict.message).toContain("tier=low");
    expect(verdict.message).toContain("classifier=auto_approve");
  });

  it("passes when the mandate and coherence gates were not evaluated", () => {
    const verdict = checkPreTrade({ ...CLEAR, mandateScopeOk: null, thesisCoherenceOk: null });
    expect(verdict.status).toBe("pass");
  });

  it("fails on a risk-classifier block", () => {
    const verdict = checkPreTrade({
      ...CLEAR,
      riskTier: "critical",
      riskClassifierVerdict: "block",
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toContain("risk classifier returned block");
    expect(verdict.fixInstruction).toContain("riskClassifier dimensions");
  });

  it("does not fail on a classifier verdict that only asks for confirmation", () => {
    expect(checkPreTrade({ ...CLEAR, riskClassifierVerdict: "require_confirmation" }).status).toBe(
      "pass",
    );
  });

  it("fails on constitution violations and names them in the fix instruction", () => {
    const verdict = checkPreTrade({
      ...CLEAR,
      constitutionViolations: [
        "Every position MUST have a stop-loss. No exceptions.",
        "Position size 90.0% exceeds absolute maximum 10%",
      ],
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toContain("2 constitution violation(s)");
    expect(verdict.fixInstruction).toContain("Every position MUST have a stop-loss");
    expect(verdict.fixInstruction).toContain("Position size 90.0% exceeds absolute maximum 10%");
  });

  it("fails on a mandate-scope breach", () => {
    const verdict = checkPreTrade({ ...CLEAR, mandateScopeOk: false });
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toContain("mandate scope violation");
    expect(verdict.fixInstruction).toContain("active strategy mandate");
  });

  it("fails on thesis incoherence", () => {
    const verdict = checkPreTrade({ ...CLEAR, thesisCoherenceOk: false });
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toContain("thesis coherence below threshold");
  });

  it("aggregates every failing reason into one verdict", () => {
    const verdict = checkPreTrade({
      riskTier: "critical",
      riskClassifierVerdict: "block",
      constitutionViolations: ["Daily loss limit breached"],
      mandateScopeOk: false,
      thesisCoherenceOk: false,
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toContain("risk classifier returned block");
    expect(verdict.message).toContain("1 constitution violation(s)");
    expect(verdict.message).toContain("mandate scope violation");
    expect(verdict.message).toContain("thesis coherence below threshold");
    expect(verdict.fixInstruction).toContain("Daily loss limit breached");
  });

  it("buildTerminationPreTradeFromPlan feeds checkPreTrade a real verdict", async () => {
    const preTrade = await buildTerminationPreTradeFromPlan(plan, ctx);
    expect(preTrade.riskClassifierVerdict).toBe("auto_approve");
    expect(preTrade.constitutionViolations).toEqual([]);
    expect(checkPreTrade(preTrade).status).toBe("pass");

    const unstopped = await buildTerminationPreTradeFromPlan(
      { ...plan, stopLoss: { price: 0 } },
      ctx,
    );
    const blocked = checkPreTrade(unstopped);
    expect(blocked.status).toBe("fail");
    expect(blocked.fixInstruction).toContain("stop-loss");
  });

  it("enforce flag is opt-in via env", () => {
    const prev = process.env.GORDON_TERMINATION_LAYERS_ENFORCE;
    delete process.env.GORDON_TERMINATION_LAYERS_ENFORCE;
    expect(isTerminationLayersEnforceEnabled()).toBe(false);
    process.env.GORDON_TERMINATION_LAYERS_ENFORCE = "1";
    expect(isTerminationLayersEnforceEnabled()).toBe(true);
    if (prev === undefined) delete process.env.GORDON_TERMINATION_LAYERS_ENFORCE;
    else process.env.GORDON_TERMINATION_LAYERS_ENFORCE = prev;
  });
});

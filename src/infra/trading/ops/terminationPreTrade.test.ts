import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTerminationPreTradeFromPlan } from "./terminationPreTrade.ts";
import { checkPreTrade } from "./terminationLayers.ts";
import { _resetThesisCacheForTest } from "../../safety/anti-rot/thesisCoherence.ts";
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
  it("derives a clean Layer-1 pass from a small, stopped plan", async () => {
    const preTrade = await buildTerminationPreTradeFromPlan(minimalPlan(), ctx);
    expect(preTrade.riskTier).toBe("low");
    expect(preTrade.riskClassifierVerdict).toBe("auto_approve");
    expect(preTrade.constitutionViolations).toEqual([]);
    expect(checkPreTrade(preTrade).status).toBe("pass");
  });

  it("reports the mandatory-stop-loss violation for a plan with no stop", async () => {
    const preTrade = await buildTerminationPreTradeFromPlan(
      minimalPlan({ stopLoss: { price: 0 } }),
      ctx,
    );
    expect(preTrade.constitutionViolations).toEqual([
      "Every position MUST have a stop-loss. No exceptions.",
    ]);
    const verdict = checkPreTrade(preTrade);
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toContain("1 constitution violation(s)");
  });

  it("escalates the risk tier and reports the size breach for a 90%-of-portfolio plan", async () => {
    const preTrade = await buildTerminationPreTradeFromPlan(
      minimalPlan({
        allocation: { currency: "USDT", amount: 90_000, percentOfPortfolio: 0.9 },
      }),
      ctx,
    );
    expect(preTrade.riskTier).toBe("medium");
    expect(preTrade.riskClassifierVerdict).toBe("prompt_user");
    expect(preTrade.constitutionViolations).toEqual([
      "Position size 90.0% exceeds absolute maximum 10%",
    ]);
    expect(checkPreTrade(preTrade).status).toBe("fail");
  });

  it("passes caller-supplied constitution violations through instead of recomputing", async () => {
    const preTrade = await buildTerminationPreTradeFromPlan(minimalPlan(), ctx, {
      constitutionViolations: ["Daily loss limit already breached"],
    });
    expect(preTrade.constitutionViolations).toEqual(["Daily loss limit already breached"]);
    expect(checkPreTrade(preTrade).status).toBe("fail");
  });

  describe("plan direction reaches the coherence gate", () => {
    // The classifier `side` this builder derives from `direction` is not
    // observable in the returned PreTradeInput; the coherence verdict is, and
    // it is scored against the same `direction`.
    const prevCoherence = process.env.GORDON_THESIS_COHERENCE;
    const prevThesisPath = process.env.GORDON_RUNNING_THESIS_PATH;

    function declareLongThesis(): void {
      const path = join(mkdtempSync(join(tmpdir(), "gordon-thesis-")), "running-thesis.json");
      writeFileSync(
        path,
        JSON.stringify({
          bias: "long",
          marketFocus: [],
          timeHorizon: "swing",
          convictionMin: 1,
          note: "termination L1 direction test",
          declaredAt: new Date().toISOString(),
        }),
        "utf8",
      );
      process.env.GORDON_RUNNING_THESIS_PATH = path;
      process.env.GORDON_THESIS_COHERENCE = "1";
      _resetThesisCacheForTest();
    }

    afterEach(() => {
      if (prevCoherence === undefined) delete process.env.GORDON_THESIS_COHERENCE;
      else process.env.GORDON_THESIS_COHERENCE = prevCoherence;
      if (prevThesisPath === undefined) delete process.env.GORDON_RUNNING_THESIS_PATH;
      else process.env.GORDON_RUNNING_THESIS_PATH = prevThesisPath;
      _resetThesisCacheForTest();
    });

    it("keeps a long plan coherent with a long thesis", async () => {
      declareLongThesis();
      const preTrade = await buildTerminationPreTradeFromPlan(minimalPlan(), ctx);
      expect(preTrade.thesisCoherenceOk).toBe(true);
      expect(checkPreTrade(preTrade).status).toBe("pass");
    });

    it("fails Layer 1 for a short plan under a long thesis", async () => {
      declareLongThesis();
      const preTrade = await buildTerminationPreTradeFromPlan(
        minimalPlan({ direction: "short" }),
        ctx,
      );
      expect(preTrade.thesisCoherenceOk).toBe(false);
      const verdict = checkPreTrade(preTrade);
      expect(verdict.status).toBe("fail");
      expect(verdict.message).toContain("thesis coherence below threshold");
    });
  });
});

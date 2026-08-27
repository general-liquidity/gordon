import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import type { Plan, PlanStatus } from "../../../../types/plan.ts";
import { resetAllKillSwitches } from "../../../safety/killSwitches.ts";
import { WIP_FLAG_ENV } from "../../../safety/wipLimit.ts";
import { deactivateSessionPlan, sessionWipSnapshot } from "../../../safety/wipSessionRegistry.ts";
import { installTempGordonHome } from "../../../../test-utils/tempGordonHome.ts";

installTempGordonHome("gordon-wiprace-test-");

const SYMBOL = "BTCUSDT";
const PLAN_A = "pln_race_a";
const PLAN_B = "pln_race_b";
const RATIONALE = "Concurrent execution race regression test rationale";

function makePlan(id: string, status: PlanStatus = "APPROVED"): Plan {
  return {
    id,
    createdAt: new Date().toISOString(),
    symbol: SYMBOL,
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.1 },
    entry: { type: "market", price: null },
    dca: null,
    grid: null,
    stopLoss: { price: 60000 },
    takeProfit: [{ price: 70000, percentToSell: 1 }],
    reasoning: "wip race regression",
    status,
  };
}

const mockGetPlan = mock((id: string): Plan | null =>
  id === PLAN_A || id === PLAN_B ? makePlan(id) : null,
);

mock.module("../../../storage/entities/plans.ts", () => ({
  getPlan: mockGetPlan,
  listPlans: () => [],
  updatePlan: () => {},
  createPlan: () => ({}),
  computePlanContentHash: () => "test-content-hash",
  getApprovedContentHash: () => "test-content-hash",
  setApprovedContentHash: () => {},
}));

const { executePlanTool } = await import("./trading.ts");

function makeExecContext(): { requestContext: RequestContext } {
  const requestContext = new RequestContext();
  requestContext.set("exchange", { exchangeId: "binance", isSandbox: true });
  requestContext.set("config", { permissionMode: "ask" });
  return { requestContext };
}

type ExecResult = { success: boolean; error?: string };

function execPlan(planId: string): Promise<ExecResult> {
  return (
    executePlanTool as unknown as {
      execute: (
        input: { planId: string; rationale: string },
        ctx: { requestContext: RequestContext },
      ) => Promise<ExecResult>;
    }
  ).execute({ planId, rationale: RATIONALE }, makeExecContext());
}

describe("execute_plan — WIP slot race", () => {
  const prev = process.env[WIP_FLAG_ENV];

  beforeEach(() => {
    process.env[WIP_FLAG_ENV] = "1";
    deactivateSessionPlan(PLAN_A);
    deactivateSessionPlan(PLAN_B);
    resetAllKillSwitches();
  });

  afterEach(() => {
    deactivateSessionPlan(PLAN_A);
    deactivateSessionPlan(PLAN_B);
    if (prev === undefined) delete process.env[WIP_FLAG_ENV];
    else process.env[WIP_FLAG_ENV] = prev;
  });

  test("two concurrent calls on one symbol: exactly one gets past the WIP gate", async () => {
    // Both promises are started before either resolves — the second call
    // reaches the WIP gate while the first is still in flight.
    const [a, b] = await Promise.all([execPlan(PLAN_A), execPlan(PLAN_B)]);

    const results = [a, b];
    const wipBlocked = results.filter(
      (r) => !r.success && /WIP limit reached/i.test(r.error ?? ""),
    );
    expect(wipBlocked).toHaveLength(1);
  });

  test("a WIP-blocked call does not leak the loser's slot", async () => {
    await Promise.all([execPlan(PLAN_A), execPlan(PLAN_B)]);
    const activeIds = sessionWipSnapshot().active.map((p) => p.planId);
    expect(activeIds).not.toContain(PLAN_B);
  });
});

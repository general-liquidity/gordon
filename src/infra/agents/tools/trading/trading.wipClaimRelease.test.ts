import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import type { Plan } from "../../../../types/plan.ts";
import { resetAllKillSwitches } from "../../../safety/killSwitches.ts";
import { WIP_FLAG_ENV } from "../../../safety/wipLimit.ts";
import { deactivateSessionPlan, sessionWipSnapshot } from "../../../safety/wipSessionRegistry.ts";
import { installTempGordonHome } from "../../../../test-utils/tempGordonHome.ts";

installTempGordonHome("gordon-wipclaim-test-");

const SYMBOL = "ETHUSDT";
const PLAN_ID = "pln_claim_release";
const RATIONALE = "Exception safety regression test rationale for claim";

function makePlan(): Plan {
  return {
    id: PLAN_ID,
    createdAt: new Date().toISOString(),
    symbol: SYMBOL,
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.1 },
    entry: { type: "market", price: null },
    dca: null,
    grid: null,
    stopLoss: { price: 2000 },
    takeProfit: [{ price: 3000, percentToSell: 1 }],
    reasoning: "wip claim release regression",
    status: "APPROVED",
  };
}

mock.module("../../../storage/entities/plans.ts", () => ({
  getPlan: (id: string) => (id === PLAN_ID ? makePlan() : null),
  listPlans: () => [],
  updatePlan: () => {},
  createPlan: () => ({}),
  computePlanContentHash: () => "test-content-hash",
  getApprovedContentHash: () => "test-content-hash",
  setApprovedContentHash: () => {},
}));

let throwOnListTrades = false;
const listTradesThrowing = mock(() => {
  if (throwOnListTrades) throw new Error("simulated store blow-up");
  return [];
});

mock.module("../../../storage/entities/trades.ts", () => ({
  listTrades: listTradesThrowing,
  getTrade: () => null,
}));

const { executePlanTool } = await import("./trading.ts");

function makeExecContext(): { requestContext: RequestContext } {
  const requestContext = new RequestContext();
  requestContext.set("exchange", { exchangeId: "binance", isSandbox: true });
  requestContext.set("config", { permissionMode: "ask" });
  return { requestContext };
}

describe("execute_plan — WIP claim is exception-safe", () => {
  const prev = process.env[WIP_FLAG_ENV];

  beforeEach(() => {
    process.env[WIP_FLAG_ENV] = "1";
    throwOnListTrades = true;
    listTradesThrowing.mockClear();
    deactivateSessionPlan(PLAN_ID);
    resetAllKillSwitches();
  });

  afterEach(() => {
    throwOnListTrades = false;
    deactivateSessionPlan(PLAN_ID);
    if (prev === undefined) delete process.env[WIP_FLAG_ENV];
    else process.env[WIP_FLAG_ENV] = prev;
  });

  test("a throw between claim and submit does not leak the slot", async () => {
    const run = (
      executePlanTool as unknown as {
        execute: (
          input: { planId: string; rationale: string },
          ctx: { requestContext: RequestContext },
        ) => Promise<{ success: boolean; error?: string }>;
      }
    ).execute({ planId: PLAN_ID, rationale: RATIONALE }, makeExecContext());

    await run.then(
      () => undefined,
      () => undefined,
    );

    expect(listTradesThrowing).toHaveBeenCalled();
    const activeIds = sessionWipSnapshot().active.map((p) => p.planId);
    expect(activeIds).not.toContain(PLAN_ID);
  });
});

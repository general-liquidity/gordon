import { describe, expect, test, mock, beforeEach } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import type { Plan, PlanStatus } from "../../../../types/plan.ts";
import { resetAllKillSwitches, tripKillSwitch } from "../../../safety/killSwitches.ts";
import { installTempGordonHome } from "../../../../test-utils/tempGordonHome.ts";

// execute_plan reaches the real executor / risk gate / event log on the
// APPROVED path — keep every store write inside a temp GORDON_HOME.
installTempGordonHome("gordon-execplan-test-");

const mockGetPlan = mock((_id: string) => null as Plan | null);

mock.module("../../../storage/entities/plans.ts", () => ({
  getPlan: mockGetPlan,
  listPlans: () => [],
  updatePlan: () => {},
  createPlan: () => ({}),
  // Consistent hash pair so the approval content-binding gate passes and
  // these tests keep exercising the gates they target (status, kill switch).
  computePlanContentHash: () => "test-content-hash",
  getApprovedContentHash: () => "test-content-hash",
  setApprovedContentHash: () => {},
}));

import { executePlanTool } from "./trading.ts";

const PLAN_ID = "pln_gate_test";
const RATIONALE = "User confirmed plan, valid test rationale for gate";

function makePlan(status: PlanStatus): Plan {
  return {
    id: PLAN_ID,
    createdAt: new Date().toISOString(),
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.1 },
    entry: { type: "market", price: null },
    dca: null,
    grid: null,
    stopLoss: { price: 60000 },
    takeProfit: [{ price: 70000, percentToSell: 1 }],
    reasoning: "test plan for gate",
    status,
  };
}

function makeExecContext(): { requestContext: RequestContext } {
  const requestContext = new RequestContext();
  requestContext.set("exchange", { exchangeId: "binance", isSandbox: true });
  requestContext.set("config", { permissionMode: "ask" });
  return { requestContext };
}

async function execPlan(status: PlanStatus) {
  mockGetPlan.mockImplementation(() => makePlan(status));
  return (await (executePlanTool as unknown as {
    execute: (
      input: { planId: string; rationale: string },
      ctx: { requestContext: RequestContext },
    ) => Promise<{ success: boolean; error?: string }>;
  }).execute({ planId: PLAN_ID, rationale: RATIONALE }, makeExecContext()));
}

describe("execute_plan — APPROVED gate", () => {
  beforeEach(() => {
    mockGetPlan.mockReset();
    resetAllKillSwitches();
  });

  test("APPROVED passes plan-state gate", async () => {
    const result = await execPlan("APPROVED");
    expect(result.error ?? "").not.toMatch(/not APPROVED/i);
  });

  test("DRAFT is rejected with approve_plan hint", async () => {
    const result = await execPlan("DRAFT");
    expect(result.success).toBe(false);
    expect(result.error).toContain("DRAFT");
    expect(result.error).toContain("not APPROVED");
    expect(result.error).toContain("approve_plan first");
  });

  test("EXECUTING is rejected with re-execution hint", async () => {
    const result = await execPlan("EXECUTING");
    expect(result.success).toBe(false);
    expect(result.error).toContain("EXECUTING");
    expect(result.error).toContain("not APPROVED");
    expect(result.error).toContain("cannot be re-executed");
  });

  test("CLOSED is rejected with re-execution hint", async () => {
    const result = await execPlan("CLOSED");
    expect(result.success).toBe(false);
    expect(result.error).toContain("CLOSED");
    expect(result.error).toContain("not APPROVED");
    expect(result.error).toContain("cannot be re-executed");
  });

  test("CANCELLED is rejected with re-execution hint", async () => {
    const result = await execPlan("CANCELLED");
    expect(result.success).toBe(false);
    expect(result.error).toContain("CANCELLED");
    expect(result.error).toContain("not APPROVED");
    expect(result.error).toContain("cannot be re-executed");
  });

  test("firm kill switch blocks APPROVED execution", async () => {
    tripKillSwitch({ scope: "firm" }, "test halt");
    const result = await execPlan("APPROVED");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/kill switch|tripped/i);
  });
});
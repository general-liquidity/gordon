import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import type { Plan, PlanStatus } from "../../../../types/plan.ts";
import { resetAllKillSwitches } from "../../../safety/killSwitches.ts";
import { resetRateEvents } from "../../../safety/preTradeRateControls.ts";
import { installTempGordonHome } from "../../../../test-utils/tempGordonHome.ts";

installTempGordonHome("gordon-riskack-test-");

const mockGetPlan = mock((_id: string) => null as Plan | null);
const mockExecutePlan = mock(async () => ({
  success: true,
  trade: {
    id: "trd_ack",
    planId: "pln_ack",
    openedAt: new Date().toISOString(),
    closedAt: null,
    symbol: "GORDONACKUSDT",
    entries: [
      { orderId: "ord_1", price: 100_000, quantity: 0.1, filledAt: new Date().toISOString() },
    ],
    exits: [],
    averageEntry: 100_000,
    realizedPnl: 0,
    realizedPnlPercent: 0,
    status: "OPEN" as const,
  },
  orders: [{ type: "entry", orderId: "ord_1", price: 100_000, quantity: 0.1 }],
}));

mock.module("../../../storage/entities/plans.ts", () => ({
  getPlan: mockGetPlan,
  listPlans: () => [],
  updatePlan: () => {},
  createPlan: () => ({}),
  computePlanContentHash: () => "approved-hash",
  getApprovedContentHash: () => "approved-hash",
  setApprovedContentHash: () => {},
}));

mock.module("../../../storage/entities/trades.ts", () => ({
  getTrade: () => null,
  listTrades: () => [],
}));

mock.module("../../../../core/pipeline/executor.ts", () => ({
  executePlan: mockExecutePlan,
  closeTrade: async () => ({ success: true }),
  closePartialPosition: async () => ({ success: true }),
}));

mock.module("./risk-gate.ts", () => ({
  evaluateOrderRisk: async (order: { quantity: number }) => ({
    approved: true,
    quantity: order.quantity,
    reason: "",
    warnings: [],
  }),
}));

import { executePlanTool } from "./trading.ts";

const PLAN_ID = "pln_ack";
const RATIONALE = "User confirmed plan, risk-acknowledgement gate regression rationale";

// 10% of a 100k portfolio classifies medium tier and is exactly at the
// allocation cap, so the plan reaches the acknowledgement gate.
function makePlan(status: PlanStatus = "APPROVED"): Plan {
  return {
    id: PLAN_ID,
    createdAt: new Date().toISOString(),
    symbol: "GORDONACKUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 10_000, percentOfPortfolio: 0.1 },
    entry: { type: "limit", price: 100_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 95_000 },
    takeProfit: [{ price: 110_000, percentToSell: 1 }],
    reasoning: "risk acknowledgement wiring test",
    status,
  };
}

function makeExecContext(): { requestContext: RequestContext } {
  const requestContext = new RequestContext();
  requestContext.set("exchange", {
    exchangeId: "binance",
    isSandbox: true,
    getPrice: async () => 100_000,
    getBalance: async (asset: string) => (asset === "USDT" ? 100_000 : 0),
    getFullAccountDetails: async () => ({
      accountInfo: {
        canTrade: true,
        canWithdraw: false,
        canDeposit: true,
        accountType: "SPOT",
        balances: [],
        updateTime: Date.now(),
      },
      totalUsdtValue: 100_000,
      nonZeroBalances: [],
    }),
    get24hrTickers: async () => [],
    getSpread: async () => ({
      spread: 1,
      spreadPercent: 0.001,
      bidPrice: 99_999,
      askPrice: 100_000,
    }),
  });
  requestContext.set("config", {
    permissionMode: "auto",
    preferences: { maxAllocationPerTrade: 0.1, cashReservePercent: 0.1 },
  });
  requestContext.set("portfolioValue", 100_000);
  requestContext.set("availableCash", 100_000);
  return { requestContext };
}

function run(acknowledgedRisks?: string[]) {
  return (
    executePlanTool as unknown as {
      execute: (
        input: { planId: string; rationale: string; acknowledgedRisks?: string[] },
        ctx: { requestContext: RequestContext },
      ) => Promise<{ success: boolean; error?: string }>;
    }
  ).execute({ planId: PLAN_ID, rationale: RATIONALE, acknowledgedRisks }, makeExecContext());
}

describe("execute_plan — GORDON_RISK_ACK tier gate", () => {
  const prevFlag = process.env.GORDON_RISK_ACK;

  beforeEach(() => {
    mockGetPlan.mockImplementation(() => makePlan());
    mockExecutePlan.mockClear();
    resetAllKillSwitches();
    resetRateEvents();
    process.env.GORDON_RISK_ACK = "1";
  });

  afterEach(() => {
    // This file submits real orders through the tool; the rate-control window
    // is process-global, so leave it as clean as it was found.
    resetRateEvents();
    if (prevFlag === undefined) delete process.env.GORDON_RISK_ACK;
    else process.env.GORDON_RISK_ACK = prevFlag;
  });

  test("a medium-tier plan with no acknowledgement is refused even with zero warnings", async () => {
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.error).toContain("risk tier is 'medium'");
    expect(result.error).toContain("Missing acknowledgement for:");
    expect(mockExecutePlan).toHaveBeenCalledTimes(0);
  });

  test("naming the top weighted dimensions clears the gate", async () => {
    const result = await run([
      "Position Size is 10% of equity, at the mandate cap and sized to the 5k stop distance.",
      "Concentration stays inside the single-asset limit with no other crypto exposure open.",
      "Drawdown Proximity, Daily Loss Budget, Volatility, Market Hours and Asset Familiarity are all within their configured limits for this setup.",
    ]);
    expect(result.success).toBe(true);
    expect(mockExecutePlan).toHaveBeenCalledTimes(1);
  });

  test("the gate is inert while the flag is off", async () => {
    delete process.env.GORDON_RISK_ACK;
    const result = await run();
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(mockExecutePlan).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import type { Plan, PlanStatus } from "../../../../types/plan.ts";
import { resetAllKillSwitches } from "../../../safety/killSwitches.ts";
import { installTempGordonHome } from "../../../../test-utils/tempGordonHome.ts";
import { getPositionStore } from "../../../../core/positions/store.ts";
import type { PositionRecord } from "../../../../core/positions/types.ts";

// execute_plan's position-FSM sync (recordExecutedPlanPosition) is real and
// fire-and-forget — without isolation this file wrote GORDONTESTUSDT phantom
// rows into the operator's ~/.gordon/gordon.db.
installTempGordonHome("gordon-termlayers-test-");

const observations: Array<{ eventType?: string; details?: Record<string, unknown> }> = [];

mock.module("../../../platform/observability/index.ts", () => ({
  recordStructuredObservation: (obs: { eventType?: string; details?: Record<string, unknown> }) => {
    observations.push(obs);
  },
}));

const mockGetPlan = mock((_id: string) => null as Plan | null);
const mockExecutePlan = mock(async () => ({
  success: true,
  trade: {
    id: "trd_1",
    planId: "pln_term",
    openedAt: new Date().toISOString(),
    closedAt: null,
    symbol: "BTCUSDT",
    entries: [{ orderId: "ord_1", price: 100_000, quantity: 0.01, filledAt: new Date().toISOString() }],
    exits: [],
    averageEntry: 100_000,
    realizedPnl: 0,
    realizedPnlPercent: 0,
    status: "OPEN" as const,
  },
  orders: [{ type: "entry", orderId: "ord_1", price: 100_000, quantity: 0.01 }],
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
  evaluateOrderRisk: async () => ({ approved: true, warnings: [] }),
}));

import { executePlanTool } from "./trading.ts";

const PLAN_ID = "pln_term";
const PLAN_SYMBOL = "GORDONTESTUSDT";
const RATIONALE = "User confirmed plan, valid termination layers test rationale";

function makePlan(status: PlanStatus): Plan {
  return {
    id: PLAN_ID,
    createdAt: new Date().toISOString(),
    symbol: PLAN_SYMBOL,
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.1 },
    entry: { type: "limit", price: 100_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 95_000 },
    takeProfit: [{ price: 110_000, percentToSell: 1 }],
    reasoning: "termination layers wiring test",
    status,
  };
}

function makeExecContext(): { requestContext: RequestContext } {
  const requestContext = new RequestContext();
  requestContext.set("exchange", {
    exchangeId: "binance",
    isSandbox: true,
    getPrice: async () => 100_000,
    getBalance: async (asset: string) => asset === "USDT" ? 100_000 : 0,
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
  requestContext.set("config", { permissionMode: "auto", preferences: { maxAllocationPerTrade: 0.1, cashReservePercent: 0.1 } });
  requestContext.set("portfolioValue", 100_000);
  requestContext.set("availableCash", 100_000);
  return { requestContext };
}

async function waitForSyncedPosition(symbol: string): Promise<PositionRecord | null> {
  const store = await getPositionStore();
  for (let i = 0; i < 100; i++) {
    const positions = await store.getBySymbol(symbol);
    const filled = positions.find((p) => p.state === "filled");
    if (filled) return filled;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

describe("execute_plan — termination layers shadow", () => {
  const prevFlag = process.env.GORDON_TERMINATION_LAYERS;

  beforeEach(() => {
    observations.length = 0;
    mockGetPlan.mockImplementation(() => makePlan("APPROVED"));
    mockExecutePlan.mockClear();
    resetAllKillSwitches();
    process.env.GORDON_TERMINATION_LAYERS = "1";
  });

  test("records termination layer payloads without blocking execution", async () => {
    const result = await (executePlanTool as unknown as {
      execute: (
        input: { planId: string; rationale: string },
        ctx: { requestContext: RequestContext },
      ) => Promise<{ success: boolean }>;
    }).execute({ planId: PLAN_ID, rationale: RATIONALE }, makeExecContext());

    expect(result.success).toBe(true);
    const terminationObs = observations.filter(
      (o) => o.eventType === "execution.termination_layers_shadow",
    );
    expect(terminationObs.length).toBeGreaterThanOrEqual(2);
    const payload = terminationObs[terminationObs.length - 1]?.details;
    expect(payload?.kind).toBe("termination.layers_recorded");
    expect(payload?.verdict).toBeDefined();

    // The fire-and-forget position sync must land in the ISOLATED store —
    // wait for it so it cannot trail past this file's teardown, and verify
    // it records real fill data (not a phantom row).
    const synced = await waitForSyncedPosition(PLAN_SYMBOL);
    expect(synced).not.toBeNull();
    expect(synced?.state).toBe("filled");
    expect(synced?.entryPrice).toBe(100_000);
    expect(synced?.quantity).toBe(0.01);
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.GORDON_TERMINATION_LAYERS;
    else process.env.GORDON_TERMINATION_LAYERS = prevFlag;
  });
});

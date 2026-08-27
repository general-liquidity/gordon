import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import type { Plan, PlanStatus } from "../../../../types/plan.ts";
import { resetAllKillSwitches } from "../../../safety/killSwitches.ts";
import { installTempGordonHome } from "../../../../test-utils/tempGordonHome.ts";
import { getPositionStore } from "../../../../core/positions/store.ts";
import type { PositionRecord } from "../../../../core/positions/types.ts";
import { buildTerminationPreTradeFromPlan } from "../../../trading/ops/terminationPreTrade.ts";

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
    entries: [
      { orderId: "ord_1", price: 100_000, quantity: 0.01, filledAt: new Date().toISOString() },
    ],
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

// Every Layer-1 input this builder derives (allocation size, stop-loss,
// coherence, mandate scope) is also gated earlier in execute_plan, so a
// failing Layer 1 cannot be reached through plan data alone. Seam the builder
// instead: the gate under test is the enforce branch, not the builder. Off by
// default and delegating to the real implementation, so the module mock stays
// inert for any other file in the run.
let forceLayer1Block = false;
// Copied before mock.module so the delegate holds the original function object
// rather than the (live, rebound) import binding.
const realPreTradeBuilder = buildTerminationPreTradeFromPlan;

mock.module("../../../trading/ops/terminationPreTrade.ts", () => ({
  buildTerminationPreTradeFromPlan: async (
    ...args: Parameters<typeof buildTerminationPreTradeFromPlan>
  ) => {
    if (!forceLayer1Block) return realPreTradeBuilder(...args);
    return {
      riskTier: "critical" as const,
      riskClassifierVerdict: "block" as const,
      constitutionViolations: [],
      mandateScopeOk: null,
      thesisCoherenceOk: null,
    };
  },
}));

import { executePlanTool } from "./trading.ts";

const PLAN_ID = "pln_term";
const PLAN_SYMBOL = "GORDONTESTUSDT";
const RATIONALE = "User confirmed plan, valid termination layers test rationale";

function makePlan(status: PlanStatus, overrides: Partial<Plan> = {}): Plan {
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
    ...overrides,
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
  const prevEnforceFlag = process.env.GORDON_TERMINATION_LAYERS_ENFORCE;

  beforeEach(() => {
    observations.length = 0;
    mockGetPlan.mockImplementation(() => makePlan("APPROVED"));
    mockExecutePlan.mockClear();
    resetAllKillSwitches();
    forceLayer1Block = false;
    process.env.GORDON_TERMINATION_LAYERS = "1";
  });

  test("records termination layer payloads without blocking execution", async () => {
    const result = await (
      executePlanTool as unknown as {
        execute: (
          input: { planId: string; rationale: string },
          ctx: { requestContext: RequestContext },
        ) => Promise<{ success: boolean }>;
      }
    ).execute({ planId: PLAN_ID, rationale: RATIONALE }, makeExecContext());

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

  test("enforce mode blocks execution when layer 1 fails", async () => {
    process.env.GORDON_TERMINATION_LAYERS_ENFORCE = "1";
    forceLayer1Block = true;

    const result = await (
      executePlanTool as unknown as {
        execute: (
          input: { planId: string; rationale: string },
          ctx: { requestContext: RequestContext },
        ) => Promise<{ success: boolean; error?: string }>;
      }
    ).execute({ planId: PLAN_ID, rationale: RATIONALE }, makeExecContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("[L1]");
    expect(result.error).toContain("riskClassifier dimensions");
    expect(mockExecutePlan).toHaveBeenCalledTimes(0);

    const terminationObs = observations.filter(
      (o) => o.eventType === "execution.termination_layers",
    );
    expect(terminationObs.length).toBeGreaterThanOrEqual(1);
    expect(terminationObs[terminationObs.length - 1]?.details?.verdict).toBe("fail");
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.GORDON_TERMINATION_LAYERS;
    else process.env.GORDON_TERMINATION_LAYERS = prevFlag;
    if (prevEnforceFlag === undefined) delete process.env.GORDON_TERMINATION_LAYERS_ENFORCE;
    else process.env.GORDON_TERMINATION_LAYERS_ENFORCE = prevEnforceFlag;
  });
});

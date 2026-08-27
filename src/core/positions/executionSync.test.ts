import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import type { Plan } from "../../types/plan.ts";
import type { Trade } from "../../types/trade.ts";
import { installTempGordonHome } from "../../test-utils/tempGordonHome.ts";
import { recordExecutedPlanPosition } from "./executionSync.ts";
import { getPositionStore } from "./store.ts";
import { getPositionManager } from "./manager.ts";
import { EventBus, getEventBus, setEventBus } from "../../events/bus.ts";
import {
  AgentSubscriptionRegistry,
  createDefaultSubscriptions,
} from "../../events/agent-subscriptions.ts";
import {
  DEBRIEF_MATRIX_PATH_ENV,
  readDebriefLog,
  recordDebrief,
} from "../../infra/trading/ops/debriefMatrix.ts";
import { evaluatePreTradeHaltGates } from "../../infra/safety/preTradeHaltGates.ts";
import { resetStreakCircuitForTesting } from "../../infra/trading/ops/streakCircuitState.ts";
import { readPortfolioHaltState } from "../../infra/safety/durableHaltState.ts";

const tempHome = installTempGordonHome("gordon-execsync-test-");

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "p1",
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    status: "EXECUTING",
    allocation: { currency: "USDT", amount: 100, percentOfPortfolio: 0.001 },
    entry: { type: "market", price: 50_000 },
    stopLoss: { price: 49_000 },
    takeProfit: [],
    reasoning: "sync test",
    dca: null,
    grid: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    symbol: "BTCUSDT",
    status: "OPEN",
    planId: "p1",
    averageEntry: 50_000,
    entries: [
      {
        orderId: "o1",
        quantity: 0.002,
        price: 50_000,
        filledAt: new Date().toISOString(),
      },
    ],
    exits: [],
    realizedPnl: 0,
    realizedPnlPercent: 0,
    openedAt: new Date().toISOString(),
    closedAt: null,
    ...overrides,
  };
}

describe("executionSync", () => {
  it("records a filled position with positive entry data in the isolated store", async () => {
    const positionId = await recordExecutedPlanPosition(makePlan(), makeTrade(), "binance");
    expect(positionId).not.toBeNull();

    const store = await getPositionStore();
    const position = await store.get(positionId!);
    expect(position?.state).toBe("filled");
    expect(position?.entryPrice).toBe(50_000);
    expect(position?.quantity).toBe(0.002);
    expect(position?.stopLoss).toBe(49_000);
  });

  it("falls back to the plan price for an unfilled limit entry (averageEntry 0)", async () => {
    const plan = makePlan({ entry: { type: "limit", price: 40_000 } });
    const trade = makeTrade({ averageEntry: 0, entries: [] });

    const positionId = await recordExecutedPlanPosition(plan, trade, "binance");
    expect(positionId).not.toBeNull();

    const store = await getPositionStore();
    const position = await store.get(positionId!);
    expect(position?.state).toBe("filled");
    expect(position?.entryPrice).toBe(40_000);
    expect(position?.quantity).toBeCloseTo(100 / 40_000);
  });

  it("phantom guard: no usable fill data cancels instead of persisting a zero-qty position", async () => {
    const plan = makePlan({ entry: { type: "market", price: null } });
    const trade = makeTrade({ averageEntry: 0, entries: [] });

    const positionId = await recordExecutedPlanPosition(plan, trade, "binance");
    expect(positionId).toBeNull();

    // No active debris: anything created on the way must be terminal.
    const store = await getPositionStore();
    const active = await store.getActive();
    expect(active.length).toBe(0);
    const cancelled = await store.getByState("cancelled");
    expect(cancelled.length).toBe(1);
    expect(cancelled[0]?.cancelReason).toContain("phantom guard");
  });

  it("carries short/account identity through the production FSM close event without cross-account streaks", async () => {
    const previousBus = getEventBus();
    const bus = new EventBus();
    setEventBus(bus);
    const registry = new AgentSubscriptionRegistry(bus);
    registry.setInvoker(async () => undefined);
    const teacherClose = createDefaultSubscriptions(registry).find(
      (subscription) =>
        subscription.eventType === "position:closed" && subscription.agentId === "teacher",
    );
    expect(teacherClose).toBeDefined();
    const unsubscribe = registry.register(teacherClose!);
    registry.enable();
    const debriefPath = join(tempHome.current(), "fsm-debriefs.jsonl");
    process.env[DEBRIEF_MATRIX_PATH_ENV] = debriefPath;
    resetStreakCircuitForTesting();

    const closeLoss = async (account: "a" | "b", ordinal: number): Promise<void> => {
      const identity = `binance:account:account-${account}:paper`;
      const plan = makePlan({
        id: `plan-${account}-${ordinal}`,
        symbol: `SHORT${ordinal}USDT`,
        direction: "short",
      });
      const trade = makeTrade({
        id: `trade-${account}-${ordinal}`,
        planId: plan.id,
        symbol: plan.symbol,
      });
      const positionId = await recordExecutedPlanPosition(plan, trade, "binance", identity);
      expect(positionId).not.toBeNull();
      const manager = await getPositionManager(bus);
      await manager.startMonitoring(positionId!);
      await manager.reportClosed(positionId!, {
        exitPrice: 55_000,
        realizedPnL: -10,
        realizedPnLPercent: -10,
        reason: "stop_loss",
      });
    };

    try {
      await closeLoss("a", 1);
      await closeLoss("a", 2);
      await closeLoss("a", 3);
      await closeLoss("b", 4);
      expect(bus.getHistory("position:closed")).toHaveLength(4);
      expect(bus.getHistory("position:closed")[0]).toMatchObject({
        side: "short",
        portfolioIdentity: "binance:account:account-a:paper",
        realizedPnl: -10,
        reason: "stop_loss",
      });
      for (let ordinal = 0; ordinal < 3; ordinal += 1) {
        recordDebrief(
          {
            tradeId: `legacy-${ordinal}`,
            symbol: "LEGACY",
            pnlUsd: -1,
            processScore: 4,
            outcomeScore: 2,
          },
          process.env,
          debriefPath,
        );
      }

      const entries = readDebriefLog(debriefPath);
      expect(
        entries.filter((entry) => entry.portfolioIdentity?.includes("account-a")),
      ).toHaveLength(3);
      expect(
        entries.filter((entry) => entry.portfolioIdentity?.includes("account-b")),
      ).toHaveLength(1);
      const stored = await (await getPositionStore()).getByState("closed");
      expect(stored.every((position) => position.side === "short")).toBe(true);
      expect(stored.map((position) => position.exchangeId)).toEqual([
        "binance",
        "binance",
        "binance",
        "binance",
      ]);

      const env = {
        GORDON_STREAK_CIRCUIT_BREAKER: "1",
        GORDON_GIVE_BACK_STOP: "0",
        GORDON_ABSORBING_BARRIER: "0",
      } as NodeJS.ProcessEnv;
      const verdictA = evaluatePreTradeHaltGates({
        currentEquityUsd: 10_000,
        exposureReducing: false,
        portfolioIdentity: "binance:account:account-a:paper",
        debriefPath,
        env,
      });
      const verdictB = evaluatePreTradeHaltGates({
        currentEquityUsd: 10_000,
        exposureReducing: false,
        portfolioIdentity: "binance:account:account-b:paper",
        debriefPath,
        env,
      });
      expect(verdictA.blocks.some((block) => block.gate === "GORDON_STREAK_CIRCUIT_BREAKER")).toBe(
        true,
      );
      expect(verdictB.blocks).toEqual([]);
    } finally {
      unsubscribe();
      registry.disable();
      setEventBus(previousBus);
      delete process.env[DEBRIEF_MATRIX_PATH_ENV];
    }
  });

  it("uses one resolved close ID for a scoped legacy position without a trade ID", async () => {
    const previousBus = getEventBus();
    const bus = new EventBus();
    setEventBus(bus);
    const registry = new AgentSubscriptionRegistry(bus);
    registry.setInvoker(async () => undefined);
    const teacherClose = createDefaultSubscriptions(registry).find(
      (subscription) =>
        subscription.eventType === "position:closed" && subscription.agentId === "teacher",
    );
    expect(teacherClose).toBeDefined();
    const unsubscribe = registry.register(teacherClose!);
    registry.enable();
    const debriefPath = join(tempHome.current(), "fsm-no-trade-id-debriefs.jsonl");
    process.env[DEBRIEF_MATRIX_PATH_ENV] = debriefPath;
    resetStreakCircuitForTesting();
    const identity = "binance:account:no-trade-id:paper";

    try {
      const positionId = await recordExecutedPlanPosition(
        makePlan({ id: "no-trade-id-plan", direction: "short" }),
        makeTrade({ id: "temporary-trade-id", planId: "no-trade-id-plan" }),
        "binance",
        identity,
      );
      expect(positionId).not.toBeNull();
      const store = await getPositionStore();
      const position = await store.get(positionId!);
      expect(position).toBeDefined();
      await store.save({ ...position!, tradeId: undefined });

      const manager = await getPositionManager(bus);
      await manager.startMonitoring(positionId!);
      await manager.reportClosed(positionId!, {
        exitPrice: 55_000,
        realizedPnL: -25,
        realizedPnLPercent: -5,
        reason: "stop_loss",
      });

      expect(readPortfolioHaltState(identity).recentTradeOutcomes).toEqual([
        expect.objectContaining({ tradeId: positionId, outcome: "loss" }),
      ]);
      expect(readDebriefLog(debriefPath)).toEqual([
        expect.objectContaining({ tradeId: positionId, portfolioIdentity: identity }),
      ]);
      expect(bus.getHistory("position:closed")[0]).toMatchObject({ tradeId: positionId });
    } finally {
      unsubscribe();
      registry.disable();
      setEventBus(previousBus);
      delete process.env[DEBRIEF_MATRIX_PATH_ENV];
    }
  });

  it("records authenticated streak evidence before a fallible close subscriber runs", async () => {
    const previousBus = getEventBus();
    const bus = new EventBus();
    setEventBus(bus);
    bus.on("position:closed", () => {
      throw new Error("teacher unavailable");
    });
    resetStreakCircuitForTesting();
    const identity = "binance:account:durable-close:paper";

    try {
      const positionId = await recordExecutedPlanPosition(
        makePlan({ id: "durable-close-plan", direction: "short" }),
        makeTrade({ id: "durable-close-trade", planId: "durable-close-plan" }),
        "binance",
        identity,
      );
      const manager = await getPositionManager(bus);
      await manager.startMonitoring(positionId!);
      await manager.reportClosed(positionId!, {
        exitPrice: 55_000,
        realizedPnL: -25,
        realizedPnLPercent: -5,
        reason: "stop_loss",
      });

      expect(readPortfolioHaltState(identity).recentTradeOutcomes).toEqual([
        expect.objectContaining({ tradeId: "durable-close-trade", outcome: "loss" }),
      ]);
    } finally {
      setEventBus(previousBus);
    }
  });
});

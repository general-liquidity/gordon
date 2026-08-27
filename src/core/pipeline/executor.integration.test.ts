import { beforeEach, describe, expect, it } from "bun:test";
import { closeTrade, executePlan } from "./executor.ts";
import type { Exchange, Order, OrderParams } from "../../infra/exchange/index.ts";
import type { GordonConfig, Plan } from "../../types/index.ts";
import type { PortfolioState } from "./validator.ts";
import { resetAllKillSwitches, tripKillSwitch } from "../../infra/safety/killSwitches.ts";
import { installTempGordonHome } from "../../test-utils/tempGordonHome.ts";
import { createPlan } from "../../infra/storage/entities/plans.ts";
import { createTrade } from "../../infra/storage/entities/trades.ts";
import { DEBRIEF_MATRIX_PATH_ENV, readDebriefLog } from "../../infra/trading/ops/debriefMatrix.ts";
import { evaluatePreTradeHaltGates } from "../../infra/safety/preTradeHaltGates.ts";
import { resetStreakCircuitForTesting } from "../../infra/trading/ops/streakCircuitState.ts";
import { join } from "node:path";

// executePlan logs gate-block events to the SQLite event store even on
// rejected paths — keep them out of the operator's real ~/.gordon DB.
const tempHome = installTempGordonHome("gordon-executor-int-test-");

function makePlan(): Plan {
  return {
    id: "plan-exec-001",
    createdAt: new Date().toISOString(),
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 500, percentOfPortfolio: 0.05 },
    entry: { type: "limit", price: 50_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 48_000 },
    takeProfit: [{ price: 55_000, percentToSell: 1 }],
    reasoning: "integration test plan",
    status: "APPROVED",
  };
}

function makeConfig(permissionMode: GordonConfig["permissionMode"]): GordonConfig {
  return {
    version: "1.0.0",
    exchanges: [],
    brokers: [],
    useKeyring: false,
    preferences: {
      cashReservePercent: 0.2,
      maxAllocationPerTrade: 0.1,
      defaultTimeframes: ["1h"],
      topNCoins: 50,
      maxConcurrentTrades: 5,
    },
    memoryConfig: {
      lastMessages: 20,
      maxSessionDurationHours: 24,
      memoryWarningThreshold: 0.8,
    },
    permissionMode,
    onboardingComplete: true,
    startupBannerMode: "quiet",
    mcpServers: [],
    telemetry: { enabled: false, researchData: false },
  } as unknown as GordonConfig;
}

const portfolio: PortfolioState = {
  totalValue: 10_000,
  availableCash: 8_000,
  openPositions: 0,
};

function mockExchange(canTrade = true): Exchange {
  return {
    exchangeId: "binance",
    getAccountInfo: async () => ({
      canTrade,
      balances: [],
      totalEquity: portfolio.totalValue,
    }),
  } as unknown as Exchange;
}

describe("executePlan integration guards", () => {
  beforeEach(() => {
    resetAllKillSwitches();
    resetStreakCircuitForTesting();
  });

  it("blocks when permissionMode is strict", async () => {
    const result = await executePlan(mockExchange(), makePlan(), makeConfig("strict"), portfolio);
    expect(result.success).toBe(false);
    expect(result.error).toContain("strict");
  });

  it("blocks when kill switch is tripped", async () => {
    tripKillSwitch({ scope: "firm" }, "halt");
    const result = await executePlan(mockExchange(), makePlan(), makeConfig("auto"), portfolio);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tripped|kill/i);
  });

  it("blocks when exchange cannot trade", async () => {
    const result = await executePlan(
      mockExchange(false),
      makePlan(),
      makeConfig("auto"),
      portfolio,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("cannot trade");
  });

  it("blocks structurally invalid plans at validation", async () => {
    const result = await executePlan(
      mockExchange(),
      { ...makePlan(), stopLoss: { price: 52_000 } },
      makeConfig("auto"),
      portfolio,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Validation failed");
  });

  it("refuses a live process-managed tiered exit before placing the entry", async () => {
    let priceRead = false;
    const client = {
      ...mockExchange(),
      isSandbox: false,
      getPrice: async () => {
        priceRead = true;
        return 50_000;
      },
    } as Exchange;
    const plan = {
      ...makePlan(),
      takeProfit: [
        { price: 53_000, percentToSell: 0.5 },
        { price: 55_000, percentToSell: 0.5 },
      ],
    };

    const result = await executePlan(client, plan, makeConfig("auto"), portfolio);

    expect(result.success).toBe(false);
    expect(result.error).toContain("GORDON_MANAGED_EXITS_ACK");
    expect(priceRead).toBe(false);
  });

  it("refuses even one live take-profit when the venue has no native OCO", async () => {
    let priceRead = false;
    const client = {
      ...mockExchange(),
      isSandbox: false,
      getPrice: async () => {
        priceRead = true;
        return 50_000;
      },
    } as Exchange;

    const result = await executePlan(client, makePlan(), makeConfig("auto"), portfolio);

    expect(result.success).toBe(false);
    expect(result.error).toContain("GORDON_MANAGED_EXITS_ACK");
    expect(priceRead).toBe(false);
  });

  it("allows one live take-profit to reach native OCO placement without the managed-exit acknowledgement", async () => {
    let priceRead = false;
    const client = {
      ...mockExchange(),
      isSandbox: false,
      placeOCOOrder: async () => ({ orderListId: 1, orders: [] }),
      getPrice: async () => {
        priceRead = true;
        throw new Error("price probe reached");
      },
    } as unknown as Exchange;

    const result = await executePlan(client, makePlan(), makeConfig("auto"), portfolio);

    expect(priceRead).toBe(true);
    expect(result.error).not.toContain("GORDON_MANAGED_EXITS_ACK");
  });

  it("still requires the managed-exit acknowledgement for tiered exits on an OCO-capable venue", async () => {
    let priceRead = false;
    const client = {
      ...mockExchange(),
      isSandbox: false,
      placeOCOOrder: async () => ({ orderListId: 1, orders: [] }),
      getPrice: async () => {
        priceRead = true;
        return 50_000;
      },
    } as unknown as Exchange;
    const plan = {
      ...makePlan(),
      takeProfit: [
        { price: 53_000, percentToSell: 0.5 },
        { price: 55_000, percentToSell: 0.5 },
      ],
    };

    const result = await executePlan(client, plan, makeConfig("auto"), portfolio);

    expect(result.success).toBe(false);
    expect(result.error).toContain("GORDON_MANAGED_EXITS_ACK");
    expect(priceRead).toBe(false);
  });

  for (const entryType of ["market", "limit"] as const) {
    it(`does not invent a fill from a ${entryType} acknowledgement`, async () => {
      const placements: OrderParams[] = [];
      let cancellations = 0;
      const acknowledged: Order = {
        orderId: `ack-${entryType}`,
        clientOrderId: `gordon_exec001_entry`,
        symbol: "BTCUSDT",
        side: "BUY",
        type: entryType === "market" ? "MARKET" : "LIMIT",
        status: "NEW",
        price: entryType === "limit" ? 50_000 : 0,
        quantity: 0.01,
        executedQty: 0,
        cummulativeQuoteQty: 0,
      };
      const client = {
        exchangeId: "binance",
        isSandbox: true,
        getAccountInfo: async () => ({ canTrade: true, balances: [], totalEquity: 10_000 }),
        getPrice: async () => 49_000,
        getOrderHistory: async () => [],
        getOpenOrders: async () => [],
        placeOrder: async (params: OrderParams) => {
          placements.push(params);
          return acknowledged;
        },
        getOrderStatus: async () => ({ ...acknowledged, status: "CANCELED" as const }),
        cancelOrder: async () => {
          cancellations++;
        },
      } as unknown as Exchange;
      const plan = {
        ...makePlan(),
        id: `plan-${entryType}-ack`,
        entry:
          entryType === "market"
            ? { type: "market" as const, price: null }
            : { type: "limit" as const, price: 50_000 },
      };

      const result = await executePlan(client, plan, makeConfig("auto"), portfolio);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no execution was confirmed|cancel/i);
      expect(placements).toHaveLength(1);
      expect(cancellations).toBe(1);
    });
  }

  it("builds the trade from the venue-confirmed entry fill", async () => {
    const placements: OrderParams[] = [];
    const entryAck: Order = {
      orderId: "entry-confirmed",
      clientOrderId: "gordon_confirm_entry",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      status: "NEW",
      price: 0,
      quantity: 0.01,
      executedQty: 0,
      cummulativeQuoteQty: 0,
    };
    const entryFill: Order = {
      ...entryAck,
      status: "FILLED",
      price: 49_250,
      executedQty: 0.006,
      cummulativeQuoteQty: 295.5,
    };
    const stopOrder: Order = {
      orderId: "stop-confirmed",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      status: "NEW",
      price: 47_760,
      quantity: 0.006,
      executedQty: 0,
      cummulativeQuoteQty: 0,
    };
    const client = {
      exchangeId: "binance",
      isSandbox: true,
      getAccountInfo: async () => ({ canTrade: true, balances: [], totalEquity: 10_000 }),
      getPrice: async () => 50_000,
      getOrderHistory: async () => (placements.length > 0 ? [entryFill] : []),
      getOpenOrders: async () => [],
      placeOrder: async (params: OrderParams) => {
        placements.push(params);
        return placements.length === 1
          ? { ...entryAck, clientOrderId: params.newClientOrderId }
          : { ...stopOrder, clientOrderId: params.newClientOrderId, quantity: params.quantity };
      },
      getOrderStatus: async (_symbol: string, orderId: string | number) =>
        String(orderId) === "entry-confirmed" ? entryFill : stopOrder,
      cancelOrder: async () => undefined,
    } as unknown as Exchange;
    const draft = {
      ...makePlan(),
      id: "plan-confirmed-fill",
      entry: { type: "market" as const, price: null },
    };
    const { id: _id, createdAt: _createdAt, ...persistable } = draft;
    const plan = createPlan(persistable);

    const result = await executePlan(client, plan, makeConfig("auto"), portfolio);

    expect(result.success).toBe(true);
    expect(result.trade?.entries[0]).toMatchObject({
      orderId: "entry-confirmed",
      quantity: 0.006,
      price: 49_250,
    });
    expect(placements[1]?.quantity).toBe(0.006);
  });

  it("scopes production close debriefs to the venue account that realized them", async () => {
    const debriefPath = join(tempHome.current(), "debriefs.jsonl");
    process.env[DEBRIEF_MATRIX_PATH_ENV] = debriefPath;
    const closingExchange = (connectionIdentity: string): Exchange =>
      ({
        exchangeId: "binance",
        displayName: "Binance",
        connectionIdentity,
        isSandbox: true,
        getOpenOrders: async () => [],
        getOrderHistory: async () => [],
        cancelOrder: async () => undefined,
        placeOrder: async (params: OrderParams): Promise<Order> => {
          const quantity = params.quantity ?? 0;
          return {
            orderId: `close-${connectionIdentity}-${Math.random()}`,
            clientOrderId: params.newClientOrderId,
            symbol: params.symbol,
            side: params.side,
            type: params.type,
            status: "FILLED",
            price: 90,
            quantity,
            executedQty: quantity,
            cummulativeQuoteQty: quantity * 90,
          };
        },
      }) as unknown as Exchange;
    const closeOneLoss = async (connectionIdentity: string, ordinal: number): Promise<void> => {
      const draft = { ...makePlan(), symbol: `LOSS${ordinal}USDT` };
      const { id: _id, createdAt: _createdAt, ...persistable } = draft;
      const plan = createPlan(persistable);
      const trade = createTrade({
        planId: plan.id,
        openedAt: new Date().toISOString(),
        closedAt: null,
        symbol: plan.symbol,
        entries: [
          {
            orderId: `entry-${ordinal}`,
            price: 100,
            quantity: 1,
            filledAt: new Date().toISOString(),
          },
        ],
        exits: [],
        averageEntry: 100,
        realizedPnl: 0,
        realizedPnlPercent: 0,
        status: "OPEN",
      });

      const result = await closeTrade(closingExchange(connectionIdentity), trade, "STOP");
      expect(result.success).toBe(true);
    };

    try {
      await closeOneLoss("account-a", 1);
      await closeOneLoss("account-a", 2);
      await closeOneLoss("account-a", 3);
      await closeOneLoss("account-b", 4);

      const identities = readDebriefLog(debriefPath).map((entry) => entry.portfolioIdentity);
      expect(identities).toEqual([
        "binance:account:account-a:paper",
        "binance:account:account-a:paper",
        "binance:account:account-a:paper",
        "binance:account:account-b:paper",
      ]);

      const env = {
        GORDON_STREAK_CIRCUIT_BREAKER: "1",
        GORDON_GIVE_BACK_STOP: "0",
        GORDON_ABSORBING_BARRIER: "0",
      } as NodeJS.ProcessEnv;
      const accountA = evaluatePreTradeHaltGates({
        currentEquityUsd: 10_000,
        exposureReducing: false,
        debriefPath,
        portfolioIdentity: "binance:account:account-a:paper",
        env,
      });
      const accountB = evaluatePreTradeHaltGates({
        currentEquityUsd: 10_000,
        exposureReducing: false,
        debriefPath,
        portfolioIdentity: "binance:account:account-b:paper",
        env,
      });

      expect(accountA.blocks.some((block) => block.gate === "GORDON_STREAK_CIRCUIT_BREAKER")).toBe(
        true,
      );
      expect(accountB.blocks).toEqual([]);
    } finally {
      delete process.env[DEBRIEF_MATRIX_PATH_ENV];
    }
  });
});

import { beforeEach, describe, expect, it } from "bun:test";
import { executePlan } from "./executor.ts";
import type { Exchange, Order, OrderParams } from "../../infra/exchange/index.ts";
import type { GordonConfig, Plan } from "../../types/index.ts";
import type { PortfolioState } from "./validator.ts";
import { resetAllKillSwitches, tripKillSwitch } from "../../infra/safety/killSwitches.ts";
import { installTempGordonHome } from "../../test-utils/tempGordonHome.ts";
import { createPlan } from "../../infra/storage/entities/plans.ts";

// executePlan logs gate-block events to the SQLite event store even on
// rejected paths — keep them out of the operator's real ~/.gordon DB.
installTempGordonHome("gordon-executor-int-test-");

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
  beforeEach(() => resetAllKillSwitches());

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
});

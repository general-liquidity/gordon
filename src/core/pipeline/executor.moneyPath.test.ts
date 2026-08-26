import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exchange, Order } from "../../infra/exchange/index.ts";
import type { Plan } from "../../types/index.ts";
import { setDatabasePathForTesting } from "../../infra/storage/database.ts";
import { createPlan, updatePlan } from "../../infra/storage/entities/plans.ts";
import {
  exitSideForPlan,
  entrySideForPlan,
  pnlMultiplierForPlan,
  stopLimitPriceForExit,
  generateDeterministicClientOrderId,
  waitForFill,
  repairProtectiveOrders,
  placeOCOOrders,
} from "./executor.ts";

const dbPath = join(tmpdir(), `gordon-money-path-${process.pid}-${Date.now()}.db`);

beforeAll(() => {
  setDatabasePathForTesting(dbPath);
});

afterAll(() => {
  setDatabasePathForTesting(null);
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${suffix}`;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

function basePlan(overrides: Partial<Omit<Plan, "id" | "createdAt">> = {}): Omit<Plan, "id" | "createdAt"> {
  return {
    symbol: "BTCUSDT",
    direction: "long",
    strategy: "support_bounce",
    allocation: { currency: "USDT", amount: 1000, percentOfPortfolio: 0.01 },
    entry: { type: "limit", price: 50_000 },
    dca: null,
    grid: null,
    stopLoss: { price: 49_000 },
    takeProfit: [{ price: 52_000, percentToSell: 1 }],
    reasoning: "money path test",
    status: "EXECUTING",
    ...overrides,
  };
}

describe("money-path direction helpers", () => {
  it("stopLimitPriceForExit uses 0.995 for long exits (SELL) and 1.005 for short exits (BUY)", () => {
    expect(stopLimitPriceForExit(100, "SELL")).toBe(99.5);
    expect(stopLimitPriceForExit(100, "BUY")).toBe(100.5);
  });

  it("exitSideForPlan and entrySideForPlan flip for shorts", () => {
    expect(exitSideForPlan({ direction: "long" })).toBe("SELL");
    expect(entrySideForPlan({ direction: "long" })).toBe("BUY");
    expect(exitSideForPlan({ direction: "short" })).toBe("BUY");
    expect(entrySideForPlan({ direction: "short" })).toBe("SELL");
  });

  it("pnlMultiplierForPlan inverts for shorts", () => {
    expect(pnlMultiplierForPlan({ direction: "long" })).toBe(1);
    expect(pnlMultiplierForPlan({ direction: "short" })).toBe(-1);
    expect(pnlMultiplierForPlan(null)).toBe(1);
  });
});

describe("waitForFill", () => {
  it("returns success when the order reaches FILLED", async () => {
    let polls = 0;
    const client = {
      getOrderStatus: async (): Promise<Order> => {
        polls++;
        return {
          orderId: "ord-1",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          status: polls >= 2 ? "FILLED" : "NEW",
          price: 50_000,
          quantity: 0.02,
          executedQty: polls >= 2 ? 0.02 : 0,
          cummulativeQuoteQty: polls >= 2 ? 1000 : 0,
        };
      },
    } as unknown as Exchange;

    const result = await waitForFill(client, "BTCUSDT", "ord-1", {
      timeoutMs: 5000,
      pollIntervalMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.fillStatus.filledQuantity).toBe(0.02);
    expect(polls).toBeGreaterThanOrEqual(2);
  });
});

describe("repairProtectiveOrders", () => {
  beforeEach(() => {
    /* fresh plan per test via unique ids */
  });

  it("places a missing stop for an EXECUTING plan with filled entry", async () => {
    const plan = createPlan(basePlan());
    updatePlan(plan.id, { status: "EXECUTING" });

    type CapturedOrderParams = {
      newClientOrderId?: string;
      quantity?: number;
      type?: string;
    };
    const placed: CapturedOrderParams[] = [];

    const entryClientId = generateDeterministicClientOrderId(plan.id, "entry");
    const client = {
      exchangeId: "binance",
      isSandbox: true,
      getOrderHistory: async () => [
        {
          orderId: "entry-1",
          clientOrderId: entryClientId,
          symbol: plan.symbol,
          side: "BUY",
          type: "LIMIT",
          status: "FILLED",
          price: 50_000,
          quantity: 0.02,
          executedQty: 0.02,
          cummulativeQuoteQty: 1000,
        },
      ],
      getOpenOrders: async () => [],
      placeOrder: async (params: CapturedOrderParams) => {
        placed.push(params);
        return {
          orderId: "stop-1",
          clientOrderId: params.newClientOrderId,
          symbol: plan.symbol,
          side: "SELL",
          type: "STOP_LOSS_LIMIT",
          status: "NEW",
          price: 48_755,
          quantity: params.quantity ?? 0,
          executedQty: 0,
          cummulativeQuoteQty: 0,
        };
      },
      getOrderStatus: async () => ({
        orderId: "stop-1",
        symbol: plan.symbol,
        side: "SELL",
        type: "STOP_LOSS_LIMIT",
        status: "NEW",
        price: 48_755,
        quantity: 0.02,
        executedQty: 0,
        cummulativeQuoteQty: 0,
      }),
    } as unknown as Exchange;

    const result = await repairProtectiveOrders(plan.id, client);
    expect(result.repaired).toBe(true);
    expect(result.placed).toContain("stop");
    expect(placed[0]?.newClientOrderId).toBe(generateDeterministicClientOrderId(plan.id, "stop"));
    expect(placed[0]?.quantity).toBe(0.02);
  });

  it("resizes an active stop when quantity does not match position", async () => {
    const plan = createPlan(basePlan());
    updatePlan(plan.id, { status: "EXECUTING" });

    const entryClientId = generateDeterministicClientOrderId(plan.id, "entry");
    const stopClientId = generateDeterministicClientOrderId(plan.id, "stop");
    let cancelCount = 0;
    const placedQtys: number[] = [];
    let stopStatus: Order["status"] = "NEW";

    const client = {
      exchangeId: "binance",
      isSandbox: true,
      getOrderHistory: async () => [
        {
          orderId: "entry-1",
          clientOrderId: entryClientId,
          symbol: plan.symbol,
          side: "BUY",
          type: "LIMIT",
          status: "FILLED",
          price: 50_000,
          quantity: 0.04,
          executedQty: 0.04,
          cummulativeQuoteQty: 2000,
        },
        {
          orderId: "stop-old",
          clientOrderId: stopClientId,
          symbol: plan.symbol,
          side: "SELL",
          type: "STOP_LOSS_LIMIT",
          status: stopStatus,
          price: 48_755,
          quantity: 0.02,
          executedQty: 0,
          cummulativeQuoteQty: 0,
        },
      ],
      getOpenOrders: async () =>
        stopStatus === "NEW"
          ? [
              {
                orderId: "stop-old",
                clientOrderId: stopClientId,
                symbol: plan.symbol,
                side: "SELL",
                type: "STOP_LOSS_LIMIT",
                status: stopStatus,
                price: 48_755,
                quantity: 0.02,
                executedQty: 0,
                cummulativeQuoteQty: 0,
              },
            ]
          : [],
      cancelOrder: async () => {
        cancelCount++;
        stopStatus = "CANCELED";
      },
      placeOrder: async (params: { quantity?: number; newClientOrderId?: string }) => {
        placedQtys.push(params.quantity ?? 0);
        return {
          orderId: "stop-new",
          clientOrderId: params.newClientOrderId,
          symbol: plan.symbol,
          side: "SELL",
          type: "STOP_LOSS_LIMIT",
          status: "NEW",
          price: 48_755,
          quantity: params.quantity ?? 0,
          executedQty: 0,
          cummulativeQuoteQty: 0,
        };
      },
      getOrderStatus: async () => ({
        orderId: "stop-new",
        symbol: plan.symbol,
        side: "SELL",
        type: "STOP_LOSS_LIMIT",
        status: "NEW",
        price: 48_755,
        quantity: 0.04,
        executedQty: 0,
        cummulativeQuoteQty: 0,
      }),
    } as unknown as Exchange;

    const result = await repairProtectiveOrders(plan.id, client);
    expect(cancelCount).toBe(1);
    expect(result.repaired).toBe(true);
    expect(placedQtys[0]).toBe(0.04);
  });
});

describe("placeOCOOrders fallback client IDs", () => {
  it("uses deterministic oco_stop and oco_tp client IDs when planId is set", async () => {
    const planId = "plan-abc12345";
    const captured: string[] = [];

    const client = {
      exchangeId: "kraken",
      isSandbox: true,
      getOrderHistory: async () => [],
      getOpenOrders: async () => [],
      placeOrder: async (params: { newClientOrderId?: string }) => {
        captured.push(params.newClientOrderId ?? "");
        return {
          orderId: `oid-${captured.length}`,
          symbol: "BTCUSDT",
          side: "SELL",
          type: "LIMIT",
          status: "NEW",
          price: 52_000,
          quantity: 0.01,
          executedQty: 0,
          cummulativeQuoteQty: 0,
        };
      },
      getOrderStatus: async (_sym: string, oid: string) => ({
        orderId: oid,
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        status: "NEW",
        price: 52_000,
        quantity: 0.01,
        executedQty: 0,
        cummulativeQuoteQty: 0,
      }),
    } as unknown as Exchange;

    const result = await placeOCOOrders(
      client,
      "BTCUSDT",
      "SELL",
      0.01,
      49_000,
      stopLimitPriceForExit(49_000, "SELL"),
      52_000,
      planId,
    );

    expect(result.success).toBe(true);
    expect(captured).toEqual([
      generateDeterministicClientOrderId(planId, "oco_stop"),
      generateDeterministicClientOrderId(planId, "oco_tp"),
    ]);
  });
});
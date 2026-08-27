import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setDatabasePathForTesting } from "../storage/database.ts";
import { StrategyRuntime } from "../../core/runtime/engine.ts";
import { resetRuntimeStore } from "../../core/runtime/store.ts";
import { placeLimitOrderTool } from "../agents/tools/market/orderbook.ts";
import { placeMarketOrderTool } from "../agents/tools/news/discovery.ts";
import { registerHook } from "./engine.ts";

let root = "";
const previousHome = process.env.GORDON_HOME;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gordon-order-hooks-"));
  process.env.GORDON_HOME = root;
  setDatabasePathForTesting(join(root, "gordon.db"));
});

afterAll(() => {
  setDatabasePathForTesting(null);
  // Risk evaluation creates the runtime singleton against this test database.
  // Reset it before removing the database so later test files cannot retain a
  // repository handle that points at a closed SQLite connection.
  StrategyRuntime.resetInstance();
  resetRuntimeStore();
  if (previousHome === undefined) delete process.env.GORDON_HOME;
  else process.env.GORDON_HOME = previousHome;
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Bun's SQLite wrapper can retain the WAL briefly on Windows.
  }
});

function exchangeContext(placed: Array<Record<string, unknown>>) {
  const exchange = {
    exchangeId: "binance",
    isSandbox: true,
    getPrice: async () => 100,
    getBalance: async () => 100_000,
    getOpenOrders: async () => [],
    getFullAccountDetails: async () => ({
      totalUsdtValue: 100_000,
      nonZeroBalances: [{ asset: "USDT", free: 100_000, locked: 0, total: 100_000 }],
    }),
    placeOrder: async (params: Record<string, unknown>) => {
      placed.push(params);
      const quantity = Number(params.quantity ?? Number(params.quoteOrderQty) / 100);
      const notional = Number(params.quoteOrderQty ?? quantity * 100);
      return {
        orderId: "exchange-order-1",
        symbol: String(params.symbol),
        side: String(params.side),
        type: String(params.type),
        status: "FILLED",
        price: Number(params.price ?? 100),
        quantity,
        executedQty: quantity,
        cummulativeQuoteQty: notional,
      };
    },
  };
  const values: Record<string, unknown> = {
    exchange,
    config: { permissionMode: "auto" },
  };
  return { requestContext: { get: (key: string) => values[key] } } as never;
}

function brokerContext(placed: Array<Record<string, unknown>>) {
  const broker = {
    brokerId: "alpaca",
    displayName: "Alpaca Paper",
    isPaper: true,
    capabilities: {
      supportsMarketOrders: true,
      supportsLimitOrders: true,
      supportsExtendedHours: false,
      supportsFractionalShares: true,
      supportsShortSelling: true,
      supportsOptions: false,
      supportsStreaming: false,
      supportsPaperTrading: true,
      supportsHistoricalBars: true,
    },
    getAccount: async () => ({
      id: "paper",
      status: "ACTIVE",
      currency: "USD",
      cash: 100_000,
      buyingPower: 100_000,
      portfolioValue: 100_000,
      patternDayTrader: false,
      shortingEnabled: true,
      tradingBlocked: false,
    }),
    getPositions: async () => [],
    getLatestQuote: async (symbol: string) => ({
      symbol,
      bidPrice: 99,
      bidSize: 100,
      askPrice: 100,
      askSize: 100,
      timestamp: new Date().toISOString(),
    }),
    placeOrder: async (params: Record<string, unknown>) => {
      placed.push(params);
      const filledQty = Number(params.qty ?? Number(params.notional) / 100);
      return {
        id: "broker-order-1",
        symbol: String(params.symbol),
        side: String(params.side) as "buy" | "sell",
        type: "market" as const,
        timeInForce: "day" as const,
        status: "filled" as const,
        qty: filledQty,
        filledQty,
        notional: Number(params.notional ?? filledQty * 100),
        extendedHours: false,
      };
    },
  };
  const values: Record<string, unknown> = {
    exchange: null,
    broker,
    config: { permissionMode: "auto" },
  };
  return { requestContext: { get: (key: string) => values[key] } } as never;
}

describe("production order hooks", () => {
  it("applies a size-only limit-order reduction and awaits the post-order hook", async () => {
    const placed: Array<Record<string, unknown>> = [];
    let postCompleted = false;
    const unregisterPre = registerHook({
      id: "reduce-limit-size",
      point: "PreOrderPlacement",
      handler: (payload) => ({
        action: "modify",
        replacement: { quantity: payload.quantity / 2, notionalUsd: payload.notionalUsd / 2 },
      }),
    });
    const unregisterPost = registerHook({
      id: "audit-limit-fill",
      point: "PostOrderPlacement",
      handler: async () => {
        await Bun.sleep(10);
        postCompleted = true;
        return { action: "allow" };
      },
    });

    try {
      const result = (await placeLimitOrderTool.execute!(
        { symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, timeInForce: "GTC" },
        exchangeContext(placed),
      )) as { success?: boolean; error?: string };
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(placed[0]?.quantity).toBe(0.5);
      expect(postCompleted).toBe(true);
    } finally {
      unregisterPost();
      unregisterPre();
    }
  });

  it("risk-checks and safely reduces a quote-notional market order", async () => {
    const placed: Array<Record<string, unknown>> = [];
    const unregister = registerHook({
      id: "reduce-market-notional",
      point: "PreOrderPlacement",
      handler: (payload) => ({
        action: "modify",
        replacement: { notionalUsd: payload.notionalUsd / 2 },
      }),
    });

    try {
      const result = (await placeMarketOrderTool.execute!(
        { symbol: "BTCUSDT", side: "BUY", quoteOrderQty: 100 },
        exchangeContext(placed),
      )) as { success?: boolean; error?: string };
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(placed[0]?.quoteOrderQty).toBe(50);
    } finally {
      unregister();
    }
  });

  it("emits and awaits PostOrderPlacement for paper-broker fills", async () => {
    const placed: Array<Record<string, unknown>> = [];
    const observed: string[] = [];
    const unregister = registerHook({
      id: "audit-broker-fill",
      point: "PostOrderPlacement",
      handler: async (payload) => {
        await Bun.sleep(10);
        observed.push(payload.orderId);
        return { action: "allow" };
      },
    });

    try {
      const result = (await placeMarketOrderTool.execute!(
        { symbol: "AAPL", side: "BUY", quantity: 1 },
        brokerContext(placed),
      )) as { success?: boolean; error?: string };
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(placed).toHaveLength(1);
      expect(observed).toEqual(["broker-order-1"]);
    } finally {
      unregister();
    }
  });
});

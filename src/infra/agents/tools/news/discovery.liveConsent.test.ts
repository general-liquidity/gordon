/**
 * Live-consent gate on the discovery order tools. Both reached the venue with
 * only a kill-switch + permission-mode check before this gate.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONSENT_PATH_ENV } from "../../../safety/consent.ts";
import { placeBracketOrderTool, placeMarketOrderTool } from "./discovery.ts";

const consentPath = join(tmpdir(), `gordon-consent-discovery-${process.pid}-${Date.now()}.json`);
let previousConsentPath: string | undefined;

beforeAll(() => {
  previousConsentPath = process.env[CONSENT_PATH_ENV];
  process.env[CONSENT_PATH_ENV] = consentPath;
  if (existsSync(consentPath)) rmSync(consentPath);
});

afterAll(() => {
  if (previousConsentPath === undefined) delete process.env[CONSENT_PATH_ENV];
  else process.env[CONSENT_PATH_ENV] = previousConsentPath;
});

function makeExecContext(placed: string[], isSandbox: boolean) {
  const exchange = {
    exchangeId: "binance",
    connectionIdentity: "discovery-account",
    isSandbox,
    getPrice: async () => 100,
    getBalance: async () => 100_000,
    getOpenOrders: async () => [],
    getFullAccountDetails: async () => ({
      totalUsdtValue: 100_000,
      nonZeroBalances: [{ asset: "USDT", free: 100_000, locked: 0, total: 100_000 }],
    }),
    placeOrder: async (params: { symbol: string }) => {
      placed.push(params.symbol);
      return {
        orderId: "order-1",
        symbol: params.symbol,
        side: "BUY",
        type: "MARKET",
        status: "FILLED",
        price: 100,
        quantity: 1,
        executedQty: 1,
        cummulativeQuoteQty: 100,
      };
    },
  };
  const values: Record<string, unknown> = { exchange, config: { permissionMode: "auto" } };
  return { requestContext: { get: (key: string) => values[key] } } as never;
}

function makeBrokerExecContext(placed: string[]) {
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
      cash: 10_000,
      buyingPower: 10_000,
      portfolioValue: 10_000,
      patternDayTrader: false,
      shortingEnabled: true,
      tradingBlocked: false,
    }),
    getPositions: async () => [
      {
        symbol: "AAPL",
        qty: 95,
        side: "long",
        marketValue: 9_500,
        avgEntryPrice: 100,
        unrealizedPl: 0,
        unrealizedPlPercent: 0,
      },
    ],
    getLatestQuote: async (symbol: string) => ({
      symbol,
      bidPrice: 99,
      bidSize: 100,
      askPrice: 100,
      askSize: 100,
      timestamp: new Date().toISOString(),
    }),
    placeOrder: async (params: { symbol: string }) => {
      placed.push(params.symbol);
      return {
        id: "broker-order-1",
        symbol: params.symbol,
        side: "buy",
        type: "market",
        timeInForce: "day",
        status: "filled",
        qty: 1000,
        filledQty: 1000,
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

function makeBracketExecContext(
  events: string[],
  options: { protectionFails?: boolean; closeFails?: boolean } = {},
) {
  const exchange = {
    exchangeId: "binance",
    connectionIdentity: "discovery-bracket-account",
    isSandbox: true,
    getPrice: async () => 100,
    getOrderHistory: async () => [],
    getOpenOrders: async () => [],
    getFullAccountDetails: async () => ({
      totalUsdtValue: 100_000,
      nonZeroBalances: [{ asset: "USDT", free: 100_000, locked: 0, total: 100_000 }],
    }),
    placeOrder: async (params: { symbol: string; side: "BUY" | "SELL"; quantity: number }) => {
      events.push(params.side);
      if (params.side === "SELL" && options.closeFails) throw new Error("close unavailable");
      return {
        orderId: params.side === "BUY" ? "entry-1" : "close-1",
        symbol: params.symbol,
        side: params.side,
        type: "MARKET",
        status: "FILLED",
        price: 100,
        quantity: params.quantity,
        executedQty: params.quantity,
        cummulativeQuoteQty: 100 * params.quantity,
      };
    },
    placeOCOOrder: async () => {
      events.push("OCO");
      if (options.protectionFails) throw new Error("OCO unavailable");
      return {
        orderListId: 7,
        orders: [{ orderId: "stop-1" }, { orderId: "take-1" }],
      };
    },
  };
  const values: Record<string, unknown> = {
    exchange,
    config: { permissionMode: "auto" },
    requestedActionId: "bracket-action-1",
  };
  return { requestContext: { get: (key: string) => values[key] } } as never;
}

describe("discovery order tools live-consent gate", () => {
  it("place_bracket_order refuses on a live venue without consent", async () => {
    const placed: string[] = [];
    const res = (await placeBracketOrderTool.execute!(
      {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.01,
        stopLossPrice: 90,
        takeProfitPrice: 120,
      } as never,
      makeExecContext(placed, false),
    )) as { error?: string };

    expect(res.error).toMatch(/have not yet acknowledged live trading/);
    expect(placed).toEqual([]);
  });

  it("place_market_order refuses on a live venue without consent", async () => {
    const placed: string[] = [];
    const res = (await placeMarketOrderTool.execute!(
      { symbol: "BTCUSDT", side: "BUY", quantity: 0.01 } as never,
      makeExecContext(placed, false),
    )) as { error?: string };

    expect(res.error).toMatch(/have not yet acknowledged live trading/);
    expect(placed).toEqual([]);
  });

  it("runs the common risk gate before dispatching a paper-broker order", async () => {
    const placed: string[] = [];
    const res = (await placeMarketOrderTool.execute!(
      { symbol: "AAPL", side: "BUY", quantity: 6 } as never,
      makeBrokerExecContext(placed),
    )) as { error?: string };

    expect(res.error).toContain("Risk kernel rejected");
    expect(placed).toEqual([]);
  });

  it("refuses an unsupported bracket before placing the entry", async () => {
    const placed: string[] = [];
    const res = (await placeBracketOrderTool.execute!(
      {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.01,
        stopLossPrice: 90,
        takeProfitPrice: 120,
      } as never,
      makeExecContext(placed, true),
    )) as { error?: string };

    expect(res.error).toContain("refused before entry");
    expect(placed).toEqual([]);
  });

  it("flattens the entry when OCO protection fails", async () => {
    const events: string[] = [];
    const res = (await placeBracketOrderTool.execute!(
      {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.01,
        stopLossPrice: 90,
        takeProfitPrice: 120,
      } as never,
      makeBracketExecContext(events, { protectionFails: true }),
    )) as { error?: string };

    expect(res.error).toContain("flattened the filled position");
    expect(events).toEqual(["BUY", "OCO", "SELL"]);
  });

  it("reports critical operator action when protection and flattening both fail", async () => {
    const events: string[] = [];
    const res = (await placeBracketOrderTool.execute!(
      {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.01,
        stopLossPrice: 90,
        takeProfitPrice: 120,
      } as never,
      makeBracketExecContext(events, { protectionFails: true, closeFails: true }),
    )) as { error?: string };

    expect(res.error).toContain("CRITICAL");
    expect(res.error).toContain("immediate operator attention");
    expect(events).toEqual(["BUY", "OCO", "SELL"]);
  });
});

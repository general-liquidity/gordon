import { beforeEach, describe, expect, it } from "bun:test";
import { executePlan } from "./executor.ts";
import type { Exchange } from "../../infra/exchange/index.ts";
import type { GordonConfig, Plan } from "../../types/index.ts";
import type { PortfolioState } from "./validator.ts";
import { resetAllKillSwitches, tripKillSwitch } from "../../infra/safety/killSwitches.ts";

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
    const result = await executePlan(mockExchange(false), makePlan(), makeConfig("auto"), portfolio);
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
});
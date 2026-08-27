import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { TradingService } from "./trading.service.ts";
import { ServiceContainer, setContainer } from "./container.ts";
import { InvalidPlanError, TradingModeError } from "../errors/index.ts";
import type { GordonConfig, Plan } from "../types/index.ts";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-test-001",
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
    reasoning: "test plan",
    status: "APPROVED",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<GordonConfig> = {}): GordonConfig {
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
    permissionMode: "ask",
    onboardingComplete: true,
    startupBannerMode: "quiet",
    mcpServers: [],
    telemetry: { enabled: false, researchData: false },
    ...overrides,
  } as unknown as GordonConfig;
}

describe("TradingService", () => {
  let container: ServiceContainer;
  const service = new TradingService();

  beforeEach(async () => {
    container = new ServiceContainer();
    await container.initialize({ logLevel: "error" });
    setContainer(container);
  });

  afterEach(() => {
    container.reset();
    setContainer(new ServiceContainer());
  });

  it("validatePlan rejects strict permission mode", async () => {
    await expect(
      service.validatePlan(makePlan(), makeConfig({ permissionMode: "strict" }), 10_000),
    ).rejects.toBeInstanceOf(TradingModeError);
  });

  it("validatePlan rejects unapproved plans", async () => {
    await expect(
      service.validatePlan(makePlan({ status: "DRAFT" }), makeConfig(), 10_000),
    ).rejects.toBeInstanceOf(InvalidPlanError);
  });

  it("validatePlan rejects allocation above preference cap", async () => {
    await expect(
      service.validatePlan(
        makePlan({ allocation: { currency: "USDT", amount: 2_000, percentOfPortfolio: 0.25 } }),
        makeConfig({
          preferences: {
            cashReservePercent: 0.2,
            maxAllocationPerTrade: 0.1,
            defaultTimeframes: ["1h"],
            topNCoins: 50,
            maxConcurrentTrades: 5,
          },
        }),
        10_000,
      ),
    ).rejects.toThrow(/allocation/i);
  });

  it("checkFunds fails when exchange is unavailable", async () => {
    await expect(service.checkFunds(100)).rejects.toThrow(/not available/i);
  });
});

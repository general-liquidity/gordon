import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PortfolioService } from "./portfolio.service.ts";
import { ServiceContainer, setContainer } from "./container.ts";
import type { Exchange } from "../infra/exchange/index.ts";

describe("PortfolioService", () => {
  let container: ServiceContainer;
  const service = new PortfolioService();

  beforeEach(async () => {
    container = new ServiceContainer();
    await container.initialize({ logLevel: "error" });
    setContainer(container);
  });

  afterEach(() => {
    container.reset();
    setContainer(new ServiceContainer());
  });

  it("returns empty portfolio when exchange is unavailable", async () => {
    const summary = await service.getPortfolio();
    expect(summary.totalValue).toBe(0);
    expect(summary.holdings).toEqual([]);
    expect(summary.openTrades).toBe(0);
  });

  it("values stablecoin balances at par", async () => {
    const mockExchange = {
      exchangeId: "binance",
      getAllBalances: async () => [{ asset: "USDT", free: 1000, locked: 0 }],
      getBalance: async () => 1000,
      getPrice: async () => 1,
    } as unknown as Exchange;

    container.register("exchange", mockExchange);

    const summary = await service.getPortfolio();
    expect(summary.totalValue).toBe(1000);
    expect(summary.availableCash).toBe(1000);
    expect(summary.holdings[0]?.asset).toBe("USDT");
  });

  it("calculateAllocation respects max cap", () => {
    expect(service.calculateAllocation(10_000, 0.05, 300)).toBe(300);
    expect(service.calculateAllocation(10_000, 0.05)).toBe(500);
  });
});

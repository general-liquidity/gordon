import { describe, it, expect } from "bun:test";

import { CorrelationChecker } from "./correlation.ts";
import { RiskKernel } from "./kernel.ts";
import type { OpenPosition } from "./portfolio-context.ts";
import type { OrderRequest } from "./audit.ts";
import type { PortfolioContext } from "./portfolio-context.ts";

function position(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    symbol: "BTCUSDT",
    side: "long",
    size: 0.01,
    entryPrice: 100_000,
    currentPrice: 100_000,
    unrealizedPnL: 0,
    exchangeId: "test",
    ...overrides,
  };
}

function context(overrides: Partial<PortfolioContext> = {}): PortfolioContext {
  return {
    totalEquity: 100_000,
    availableBalance: 100_000,
    openPositions: [],
    todayPnL: 0,
    todayTradeCount: 0,
    currentDrawdown: 0,
    peakEquity: 100_000,
    ...overrides,
  };
}

function order(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    symbol: "BTCUSDT",
    side: "buy",
    type: "limit",
    quantity: 0.001,
    price: 100_000,
    exchangeId: "test",
    agentId: "test-agent",
    ...overrides,
  };
}

describe("CorrelationChecker — three-way verdict", () => {
  it("returns a checked verdict for a pair that is in the table", async () => {
    const result = await new CorrelationChecker().checkCorrelation(
      "ETHUSDT",
      "long",
      [position({ symbol: "SOLUSDT" })],
      40,
      100_000,
    );

    expect(result.status).toBe("checked");
    expect(result.acceptable).toBe(true);
    expect(result.unknownSymbols).toEqual([]);
    expect(result.maxCorrelation).toBeGreaterThan(0.5);
  });

  it("does not report an unlisted pair as low correlation", async () => {
    const result = await new CorrelationChecker().checkCorrelation(
      "NOSUCHUSDT",
      "long",
      [position({ symbol: "ALSONOSUCHUSDT" })],
      40,
      100_000,
    );

    expect(result.status).toBe("unknown");
    expect(result.details).not.toMatch(/low correlation/i);
    expect(result.details).not.toMatch(/good diversification/i);
    expect(result.unknownSymbols).toContain("NOSUCHUSDT");
    expect(result.unknownSymbols).toContain("ALSONOSUCHUSDT");
  });

  it("flags a listed symbol held against an unlisted position as unknown", async () => {
    const result = await new CorrelationChecker().checkCorrelation(
      "ETHUSDT",
      "long",
      [position({ symbol: "NOSUCHUSDT" })],
      40,
      100_000,
    );

    expect(result.status).toBe("unknown");
    expect(result.unknownSymbols).toEqual(["NOSUCHUSDT"]);
  });

  it("does not report a pass when the check throws", async () => {
    const result = await new CorrelationChecker().checkCorrelation(
      "BTCUSDT",
      "long",
      // A non-string symbol makes the group lookup throw.
      [position({ symbol: 42 as unknown as string })],
      40,
      100_000,
    );

    expect(result.status).toBe("error");
    expect(result.acceptable).toBe(false);
    expect(result.maxCorrelation).toBeNull();
    expect(result.groupExposurePercent).toBeNull();
    expect(result.details).not.toMatch(/acceptable/i);
  });

  it("treats an empty portfolio as checked, not unknown", async () => {
    const result = await new CorrelationChecker().checkCorrelation(
      "NOSUCHUSDT",
      "long",
      [],
      40,
      100_000,
    );

    expect(result.status).toBe("checked");
    expect(result.acceptable).toBe(true);
  });
});

describe("RiskKernel — correlation verdict reaches the decision", () => {
  it("does not fold an unknown correlation into an all-checks-passed decision", async () => {
    const kernel = new RiskKernel({ mode: "enforce", autoAdjustSize: false });

    const decision = await kernel.evaluate(
      order({ symbol: "NOSUCHUSDT" }),
      context({ openPositions: [position({ symbol: "NOSUCHUSDT" })] }),
    );

    const correlation = decision.checks.find((c) => c.name === "correlation");
    expect(correlation?.passed).toBe(false);
    expect(correlation?.severity).toBe("warning");
    expect(correlation?.details).toMatch(/UNKNOWN/);
    // Routine, not a violation: the order still goes through.
    expect(decision.approved).toBe(true);
    expect(decision.reason).not.toMatch(/All risk checks passed/);
  });

  it("does not approve on a correlation check that threw", async () => {
    const kernel = new RiskKernel({ mode: "enforce", autoAdjustSize: false });

    const decision = await kernel.evaluate(
      order(),
      context({ openPositions: [position({ symbol: 42 as unknown as string })] }),
    );

    const correlation = decision.checks.find((c) => c.name === "correlation");
    expect(correlation?.passed).toBe(false);
    expect(correlation?.severity).toBe("critical");
    expect(decision.approved).toBe(false);
  });
});

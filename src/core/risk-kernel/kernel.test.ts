import { describe, it, expect } from "bun:test";

import { RiskKernel } from "./kernel.ts";
import type { OrderRequest } from "./audit.ts";
import type { PortfolioContext } from "./portfolio-context.ts";

/**
 * 0.5 BTC. Against a $5,000 notional cap this is a ~$50,000 order, but
 * `quantity` alone reads as 0.50 — three orders of magnitude under the cap.
 */
function unpricedMarketOrder(): OrderRequest {
  return {
    symbol: "BTCUSDT",
    side: "buy",
    type: "market",
    quantity: 0.5,
    exchangeId: "test",
    agentId: "test-agent",
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

describe("RiskKernel — market order with no price", () => {
  it("does not silently pass the notional cap when the order cannot be priced", async () => {
    const kernel = new RiskKernel({
      mode: "enforce",
      autoAdjustSize: false,
      maxPositionSizeUsd: 5_000,
    });

    const decision = await kernel.evaluate(unpricedMarketOrder(), context());

    expect(decision.approved).toBe(false);
    const positionSize = decision.checks.find((c) => c.name === "position_size");
    expect(positionSize?.passed).toBe(false);
    expect(positionSize?.severity).toBe("critical");
    expect(positionSize?.details).toContain("Cannot price");
  });

  it("prices the order off the mark price of an existing position in the same symbol", async () => {
    const kernel = new RiskKernel({
      mode: "enforce",
      autoAdjustSize: false,
      maxPositionSizeUsd: 5_000,
    });

    const decision = await kernel.evaluate(
      unpricedMarketOrder(),
      context({
        openPositions: [
          {
            symbol: "BTCUSDT",
            side: "long",
            size: 0.01,
            entryPrice: 100_000,
            currentPrice: 100_000,
            unrealizedPnL: 0,
            exchangeId: "test",
          },
        ],
      }),
    );

    const positionSize = decision.checks.find((c) => c.name === "position_size");
    expect(positionSize?.passed).toBe(false);
    // Priced at the $100k mark, 0.5 BTC is $50,000 — a real cap breach, not an
    // unpriceable order.
    expect(positionSize?.details).toContain("50000.00");
    expect(decision.approved).toBe(false);
  });

  it("still prices limit orders off the limit price", async () => {
    const kernel = new RiskKernel({
      mode: "enforce",
      autoAdjustSize: false,
      maxPositionSizeUsd: 5_000,
    });

    const decision = await kernel.evaluate(
      { ...unpricedMarketOrder(), type: "limit", quantity: 0.01, price: 100_000 },
      context(),
    );

    const positionSize = decision.checks.find((c) => c.name === "position_size");
    expect(positionSize?.passed).toBe(true);
    expect(decision.approved).toBe(true);
  });
});

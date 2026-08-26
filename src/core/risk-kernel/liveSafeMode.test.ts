import { describe, it, expect } from "bun:test";

import { resolveLiveSafeMode } from "./config.ts";
import { RiskKernel } from "./kernel.ts";
import type { OrderRequest } from "./audit.ts";
import type { PortfolioContext } from "./portfolio-context.ts";

describe("resolveLiveSafeMode", () => {
  it("upgrades warn -> enforce on a live (non-sandbox) venue", () => {
    expect(resolveLiveSafeMode("warn", false)).toBe("enforce");
  });

  it("leaves warn untouched on a sandbox venue", () => {
    expect(resolveLiveSafeMode("warn", true)).toBe("warn");
  });

  it("upgrades paper -> enforce on a live (non-sandbox) venue", () => {
    // Paper mode approves every order without running a check. A live venue
    // fills a live order regardless of what the kernel calls its own mode.
    expect(resolveLiveSafeMode("paper", false)).toBe("enforce");
  });

  it("leaves paper untouched on a sandbox venue", () => {
    expect(resolveLiveSafeMode("paper", true)).toBe("paper");
  });

  it("never touches enforce", () => {
    expect(resolveLiveSafeMode("enforce", false)).toBe("enforce");
    expect(resolveLiveSafeMode("enforce", true)).toBe("enforce");
  });
});

function breachingOrder(): OrderRequest {
  // $50k notional — blows past the $5k default position-size cap.
  return {
    symbol: "BTCUSDT",
    side: "buy",
    type: "limit",
    quantity: 1,
    price: 50_000,
    exchangeId: "test",
    agentId: "test-agent",
  };
}

function context(): PortfolioContext {
  return {
    totalEquity: 100_000,
    availableBalance: 100_000,
    openPositions: [],
    todayPnL: 0,
    todayTradeCount: 0,
    currentDrawdown: 0,
    peakEquity: 100_000,
  };
}

describe("RiskKernel.evaluate — warn mode on a live venue", () => {
  it("warn config + live venue (sandboxActive=false) hard-rejects a position-size breach", async () => {
    const kernel = new RiskKernel({ mode: "warn", autoAdjustSize: false });
    const decision = await kernel.evaluate(breachingOrder(), context(), {
      sandboxActive: false,
    });
    // warn was upgraded to enforce, so the breach is rejected, not approved-through.
    expect(decision.approved).toBe(false);
    expect(decision.action).toBe("reject");
  });

  it("warn config + sandbox venue (sandboxActive=true) lets the breach through", async () => {
    const kernel = new RiskKernel({ mode: "warn", autoAdjustSize: false });
    const decision = await kernel.evaluate(breachingOrder(), context(), {
      sandboxActive: true,
    });
    // warn stays warn on sandbox — critical violations are logged but allowed.
    expect(decision.approved).toBe(true);
  });
});

describe("RiskKernel.evaluate — paper mode on a live venue", () => {
  it("paper modeOverride + live venue hard-rejects a position-size breach", async () => {
    const kernel = new RiskKernel({ mode: "enforce", autoAdjustSize: false });
    const decision = await kernel.evaluate(breachingOrder(), context(), {
      modeOverride: "paper",
      sandboxActive: false,
    });
    expect(decision.approved).toBe(false);
    expect(decision.reason).not.toContain("Paper mode");
  });

  it("paper config + live venue hard-rejects a position-size breach", async () => {
    const kernel = new RiskKernel({ mode: "paper", autoAdjustSize: false });
    const decision = await kernel.evaluate(breachingOrder(), context(), {
      sandboxActive: false,
    });
    expect(decision.approved).toBe(false);
    expect(decision.action).toBe("reject");
  });

  it("paper config + sandbox venue still approves everything", async () => {
    const kernel = new RiskKernel({ mode: "paper", autoAdjustSize: false });
    const decision = await kernel.evaluate(breachingOrder(), context(), {
      sandboxActive: true,
    });
    expect(decision.approved).toBe(true);
    expect(decision.reason).toContain("Paper mode");
  });
});

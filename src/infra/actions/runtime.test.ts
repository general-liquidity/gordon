import { describe, expect, it } from "bun:test";

import { GordonConfigSchema, type GordonConfig } from "../../types/index.ts";
import type { GordonContext } from "../agents/types.ts";
import { evaluateToolRequestPolicy, planActionExecution } from "./runtime.ts";

function createConfig(mode: "SAFE" | "ARMED" = "SAFE"): GordonConfig {
  return GordonConfigSchema.parse({
    mode,
    armedUntil: mode === "ARMED" ? new Date(Date.now() + 60_000).toISOString() : null,
    exchanges: [{
      id: "binance-default",
      type: "binance",
      apiKey: "key",
      apiSecret: "secret",
      isDefault: true,
    }],
    activeExchangeId: "binance-default",
  });
}

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: {
      exchangeId: "binance",
      displayName: "Binance",
      getPrice: async () => 50000,
    } as unknown as GordonContext["exchange"],
    broker: null,
    agentRails: null,
    llm: {} as GordonContext["llm"],
    config: createConfig(),
    portfolioValue: 10000,
    availableCash: 1000,
    requestedActionId: "trading.preview_market_order",
    requestedTaskScope: "execution",
    credentialProfile: "paper",
    ...overrides,
  };
}

describe("action runtime", () => {
  it("builds a preview plan with blockers in SAFE mode", async () => {
    const plan = await planActionExecution(
      "trading.preview_market_order",
      { symbol: "BTC", side: "BUY", quoteOrderQty: 100 },
      createContext(),
    );

    expect(plan.actionId).toBe("trading.preview_market_order");
    expect(plan.preview?.symbol).toBe("BTCUSDT");
    expect(plan.preview?.estimatedBaseQty).toBeGreaterThan(0);
    expect(plan.blockers).toContain("System is in SAFE mode.");
    expect(plan.ready).toBeFalse();
  });

  it("blocks live market-order tools during preview-only requests", async () => {
    const decision = await evaluateToolRequestPolicy("place_market_order", createContext());
    expect(decision.allowed).toBeFalse();
    expect(decision.reason).toContain("preview/read");
  });

  it("allows the live market order action when the request explicitly targets execution", async () => {
    const decision = await evaluateToolRequestPolicy(
      "place_market_order",
      createContext({
        requestedActionId: "trading.market_order",
        config: createConfig("ARMED"),
        credentialProfile: "live",
      }),
    );

    expect(decision.allowed).toBeTrue();
    expect(decision.requiresArmedMode).toBeTrue();
  });
});

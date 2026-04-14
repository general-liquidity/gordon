import { describe, expect, it } from "bun:test";

import { GordonConfigSchema, type GordonConfig } from "../../../types/index.ts";
import type { GordonContext } from "../../agents/types.ts";
import { evaluateToolRequestPolicy, planActionExecution } from "./runtime.ts";

function createConfig(permissionMode: "auto" | "ask" | "strict" | "paper" | "observe" | "plan" = "ask"): GordonConfig {
  return GordonConfigSchema.parse({
    permissionMode,
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
  it("builds a preview plan with blockers in strict mode", async () => {
    const plan = await planActionExecution(
      "trading.preview_market_order",
      { symbol: "BTC", side: "BUY", quoteOrderQty: 100 },
      createContext({ config: createConfig("strict") }),
    );

    expect(plan.actionId).toBe("trading.preview_market_order");
    expect(plan.preview?.symbol).toBe("BTCUSDT");
    expect(plan.preview?.resolutionSource).toBe("heuristic");
    expect(plan.preview?.quoteAsset).toBeUndefined();
    expect((plan.preview?.capabilities as { supportsOrderBook: boolean } | undefined)?.supportsOrderBook).toBeTrue();
    expect(plan.preview?.estimatedBaseQty).toBeGreaterThan(0);
    expect(plan.blockers).toContain("permissionMode is 'strict' (read-only).");
    expect(plan.ready).toBeFalse();
  });

  it("builds a broker-backed preview plan for stocks when the symbol resolves to equities", async () => {
    const plan = await planActionExecution(
      "trading.preview_market_order",
      { symbol: "AAPL", side: "BUY", quantity: 2 },
      createContext({
        exchange: null,
        broker: {
          brokerId: "webull",
          displayName: "Webull",
          getLatestQuote: async () => ({ symbol: "AAPL", bidPrice: 210, askPrice: 211, lastPrice: 210.5, timestamp: Date.now() }),
          getAccount: async () => ({
            accountId: "acct-1",
            accountType: "cash",
            buyingPower: 5000,
            cash: 5000,
            portfolioValue: 5000,
            dayTradeBuyingPower: 5000,
          }),
        } as unknown as GordonContext["broker"],
      }),
    );

    expect(plan.actionId).toBe("trading.preview_market_order");
    expect(plan.preview?.symbol).toBe("AAPL");
    expect(plan.preview?.marketFamily).toBe("stocks");
    expect(plan.preview?.venue).toBe("webull");
    expect(plan.preview?.venueRoute).toBe("broker");
    expect(plan.preview?.resolutionSource).toBe("broker_quote");
    expect(plan.preview?.quoteAsset).toBe("USD");
    expect(plan.preview?.estimatedNotional).toBe(422);
    expect(plan.preview?.availableBuyingPower).toBe(5000);
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
        config: createConfig("auto"),
        credentialProfile: "live",
      }),
    );

    expect(decision.allowed).toBeTrue();
    expect(decision.requiresTradePermission).toBeTrue();
  });
});

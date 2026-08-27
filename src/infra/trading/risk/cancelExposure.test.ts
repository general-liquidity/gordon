import { describe, expect, test } from "bun:test";

import { classifyCancellationExposure, inspectCancellationMarket } from "./cancelExposure.ts";

const entry = {
  orderId: "entry-1",
  symbol: "BTCUSDT",
  side: "BUY" as const,
  type: "LIMIT" as const,
  quantity: 1,
  executedQty: 0,
};

describe("cancellation exposure direction", () => {
  test("cancelling an unfilled spot buy removes prospective exposure", () => {
    expect(classifyCancellationExposure(entry, [], { market: "spot" })).toBe("reduces_risk");
  });

  test("cancelling a sell that protects an existing long increases unprotected risk", () => {
    expect(
      classifyCancellationExposure(
        { ...entry, orderId: "stop-1", side: "SELL", type: "STOP_LOSS", quantity: 0.5 },
        [{ asset: "BTC", total: 1 }],
        { market: "spot" },
      ),
    ).toBe("removes_protection");
  });

  test("missing or contradictory metadata is unknown and therefore fail-closed", () => {
    expect(
      classifyCancellationExposure(
        { ...entry, side: "SELL", quantity: 2 },
        [{ asset: "BTC", total: 1 }],
        { market: "spot" },
      ),
    ).toBe("unknown");
  });

  test("a BUY protecting a short derivative position requires consent", () => {
    expect(
      classifyCancellationExposure(entry, [], {
        market: "derivative",
        position: { side: "short", contracts: 1, contractSize: 1 },
      }),
    ).toBe("removes_protection");
  });

  test("derivative order quantity is compared with position contracts, not contract notional", () => {
    expect(
      classifyCancellationExposure({ ...entry, quantity: 5 }, [], {
        market: "derivative",
        position: { side: "short", contracts: 10, contractSize: 0.001 },
      }),
    ).toBe("removes_protection");
  });

  test("an all-positions derivative lookup still identifies a single protective short leg", async () => {
    const context = await inspectCancellationMarket(
      {
        getFullAccountDetails: async () => ({
          accountInfo: { accountType: "SPOT" },
          nonZeroBalances: [],
        }),
        getMarketType: async () => "derivative",
        supports: (method: string) => method === "fetchPositions",
        fetchPositions: async () => [
          { symbol: "BTC/USDT", side: "short", contracts: 10, contractSize: 0.001 },
        ],
      } as never,
      "BTCUSDT",
    );

    expect(context.context).toEqual({
      market: "derivative",
      position: { side: "short", contracts: 10, contractSize: 0.001 },
    });
    expect(classifyCancellationExposure({ ...entry, quantity: 5 }, [], context.context)).toBe(
      "removes_protection",
    );
  });

  test("a singular derivative lookup is never sufficient to waive consent", async () => {
    let singularCalled = false;
    const context = await inspectCancellationMarket(
      {
        getFullAccountDetails: async () => ({
          accountInfo: { accountType: "SPOT" },
          nonZeroBalances: [],
        }),
        getMarketType: async () => "derivative",
        supports: (method: string) => method === "fetchPosition",
        fetchPosition: async () => {
          singularCalled = true;
          return { side: "short", contracts: 10, contractSize: 0.001 };
        },
      } as never,
      "BTCUSDT",
    );

    expect(singularCalled).toBe(false);
    expect(context.context).toEqual({ market: "unknown" });
    expect(classifyCancellationExposure(entry, [], context.context)).toBe("unknown");
  });

  test("hedge-mode long and short legs never collapse into a consent-free cancellation", async () => {
    let singularCalled = false;
    const context = await inspectCancellationMarket(
      {
        getFullAccountDetails: async () => ({
          accountInfo: { accountType: "SPOT" },
          nonZeroBalances: [],
        }),
        getMarketType: async () => "derivative",
        supports: (method: string) => method === "fetchPosition" || method === "fetchPositions",
        fetchPositions: async () => [
          { symbol: "BTC/USDT", side: "long", contracts: 1, contractSize: 1 },
          { symbol: "BTC/USDT", side: "short", contracts: 1, contractSize: 1 },
        ],
        fetchPosition: async () => {
          singularCalled = true;
          return { side: "long", contracts: 1, contractSize: 1 };
        },
      } as never,
      "BTCUSDT",
    );

    expect(singularCalled).toBe(false);
    expect(context.context).toEqual({ market: "unknown" });
    expect(classifyCancellationExposure(entry, [], context.context)).toBe("unknown");
  });

  test("an unrelated venue position cannot classify the requested symbol", async () => {
    const context = await inspectCancellationMarket(
      {
        getFullAccountDetails: async () => ({
          accountInfo: { accountType: "SPOT" },
          nonZeroBalances: [],
        }),
        getMarketType: async () => "derivative",
        supports: (method: string) => method === "fetchPositions",
        fetchPositions: async () => [
          { symbol: "ETH/USDT", side: "long", contracts: 1, contractSize: 1 },
        ],
      } as never,
      "BTCUSDT",
    );

    expect(context.context).toEqual({ market: "unknown" });
    expect(classifyCancellationExposure(entry, [], context.context)).toBe("unknown");
  });

  test("a flat or unsupported derivative surface is not treated as a proven spot entry", async () => {
    for (const fetchPosition of [async () => null, async () => Promise.reject(new Error("nope"))]) {
      const context = await inspectCancellationMarket(
        {
          getFullAccountDetails: async () => ({
            accountInfo: { accountType: "SPOT" },
            nonZeroBalances: [],
          }),
          getMarketType: async () => "derivative",
          supports: (method: string) => method === "fetchPosition",
          fetchPosition,
        } as never,
        "BTCUSDT",
      );
      expect(context.context).toEqual({ market: "unknown" });
    }
  });

  test("a real CCXT spot surface is spot even though the adapter class exposes fetchPosition", async () => {
    let derivativeLookupCalled = false;
    const exchange = {
      getFullAccountDetails: async () => ({
        accountInfo: { accountType: "SPOT" },
        nonZeroBalances: [],
      }),
      // CcxtAdapter has this method on every instance. The underlying CCXT
      // capability is the authoritative signal that this connection cannot
      // be a derivative position surface.
      getMarketType: async () => "spot",
      supports: () => true,
      fetchPosition: async () => {
        derivativeLookupCalled = true;
        throw new Error("NotSupported: fetchPosition");
      },
    };

    const context = await inspectCancellationMarket(exchange as never, "BTCUSDT");

    expect(derivativeLookupCalled).toBe(false);
    expect(context.context).toEqual({ market: "spot" });
    expect(classifyCancellationExposure(entry, [], context.context)).toBe("reduces_risk");
  });

  test("spot market metadata does not waive consent for a margin account", async () => {
    const context = await inspectCancellationMarket(
      {
        getFullAccountDetails: async () => ({
          accountInfo: { accountType: "MARGIN" },
          nonZeroBalances: [],
        }),
        getMarketType: async () => "spot",
        supports: () => false,
      } as never,
      "BTCUSDT",
    );

    expect(context.context).toEqual({ market: "unknown" });
    expect(classifyCancellationExposure(entry, [], context.context)).toBe("unknown");
  });

  test("unknown market metadata never assumes a BUY is an entry", () => {
    expect(classifyCancellationExposure(entry, [])).toBe("unknown");
  });
});

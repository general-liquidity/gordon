import { describe, expect, test } from "bun:test";
import {
  buildTickerSymbolPlan,
  loadBootLiveData,
  parseTickerSymbol,
  refreshBootTicker,
  type BootLiveDeps,
  type TickerSymbol,
} from "./bootLiveData.ts";
import type { GordonConfig } from "../../types/index.ts";

const baseConfig = {
  exchanges: [
    {
      id: "binance",
      type: "ccxt:binance",
      apiKey: "key",
      apiSecret: "secret",
      isDefault: true,
      sandbox: true,
    },
  ],
  activeExchangeId: "binance",
  permissionMode: "ask",
} as unknown as GordonConfig;

function deps(overrides: Partial<BootLiveDeps> = {}): BootLiveDeps {
  return {
    loadConfig: async () => baseConfig,
    testVenue: async () => ({ connected: true }),
    fetchEquity: async () => 12_408.32,
    verifyAudit: () => ({ valid: true, checked: 1_204 }),
    fetchTicker: async () => [
      { symbol: "BTC", kind: "crypto", priceUsd: 67_432, changePercent24h: 2.3 },
      { symbol: "ETH", kind: "crypto", priceUsd: 3_521, changePercent24h: -0.8 },
    ],
    timeoutMs: 50,
    ...overrides,
  };
}

describe("loadBootLiveData", () => {
  test("returns fully populated data when all probes succeed", async () => {
    const data = await loadBootLiveData(deps());
    expect(data).toEqual({
      venue: { label: "binance", paper: true, connectivity: "connected" },
      equityUsd: 12_408.32,
      audit: { state: "ok", checked: 1_204 },
      ticker: [
        { symbol: "BTC", kind: "crypto", priceUsd: 67_432, changePercent24h: 2.3 },
        { symbol: "ETH", kind: "crypto", priceUsd: 3_521, changePercent24h: -0.8 },
      ],
      tickerSymbols: [
        { symbol: "BTC", kind: "crypto" },
        { symbol: "ETH", kind: "crypto" },
      ],
      tickerExtra: 0,
    });
  });

  test("degrades connectivity independently when the venue probe rejects", async () => {
    const data = await loadBootLiveData(
      deps({
        testVenue: async () => {
          throw new Error("network down");
        },
      }),
    );
    expect(data.venue.connectivity).toBe("offline");
    expect(data.equityUsd).toBe(12_408.32);
    expect(data.audit.state).toBe("ok");
    expect(data.ticker).toHaveLength(2);
  });

  test("times out a hanging venue probe", async () => {
    const data = await loadBootLiveData(
      deps({
        testVenue: () => new Promise(() => {}),
        timeoutMs: 20,
      }),
    );
    expect(data.venue.connectivity).toBe("offline");
  });

  test("reports none when no exchange is configured", async () => {
    let equityCalled = false;
    const data = await loadBootLiveData(
      deps({
        loadConfig: async () =>
          ({ ...baseConfig, exchanges: [], activeExchangeId: undefined }) as GordonConfig,
        fetchEquity: async () => {
          equityCalled = true;
          return 1;
        },
      }),
    );
    expect(data.venue).toEqual({ label: null, paper: false, connectivity: "none" });
    expect(data.equityUsd).toBeNull();
    expect(equityCalled).toBe(false);
  });

  test("marks audit unavailable when verification throws", async () => {
    const data = await loadBootLiveData(
      deps({
        verifyAudit: () => {
          throw new Error("sqlite unavailable");
        },
      }),
    );
    expect(data.audit).toEqual({ state: "unavailable", checked: 0 });
  });

  test("never rejects when every probe fails", async () => {
    await expect(
      loadBootLiveData(
        deps({
          loadConfig: async () => {
            throw new Error("config failed");
          },
          testVenue: async () => {
            throw new Error("venue failed");
          },
          fetchEquity: async () => {
            throw new Error("equity failed");
          },
          verifyAudit: () => {
            throw new Error("audit failed");
          },
          fetchTicker: async () => {
            throw new Error("ticker failed");
          },
          timeoutMs: 20,
        }),
      ),
    ).resolves.toEqual({
      venue: { label: null, paper: false, connectivity: "none" },
      equityUsd: null,
      audit: { state: "unavailable", checked: 0 },
      ticker: null,
      tickerSymbols: [
        { symbol: "BTC", kind: "crypto" },
        { symbol: "ETH", kind: "crypto" },
      ],
      tickerExtra: 0,
    });
  });

  test("passes the loaded config into the ticker fetcher", async () => {
    let seenConfig: GordonConfig | null | undefined;
    await loadBootLiveData(
      deps({
        fetchTicker: async (_symbols, config) => {
          seenConfig = config;
          return [];
        },
      }),
    );
    expect(seenConfig?.activeExchangeId).toBe("binance");
  });
});

describe("ticker symbol planning", () => {
  test("supports explicit crypto, equity, and onchain ticker symbols", () => {
    const config = {
      ...baseConfig,
      ui: {
        tickerSymbols: [
          "crypto:PEPE",
          "equity:AAPL",
          "onchain:base:0xabc:DEGEN",
          "onchain:ethereum:pool:0xpool:UNI",
        ],
      },
    } as unknown as GordonConfig;

    expect(buildTickerSymbolPlan(config).display).toEqual([
      { symbol: "PEPE", kind: "crypto" },
      { symbol: "AAPL", kind: "equity" },
      { symbol: "DEGEN", kind: "crypto", chain: "base", tokenAddress: "0xabc" },
      { symbol: "UNI", kind: "crypto", chain: "ethereum", poolAddress: "0xpool" },
    ]);
  });

  test("infers common quoted crypto pairs without requiring a prefix", () => {
    expect(parseTickerSymbol("BTCUSDT")).toEqual({ symbol: "BTCUSDT", kind: "crypto" });
    expect(parseTickerSymbol("AAPL")).toEqual({ symbol: "AAPL", kind: "equity" });
  });
});

describe("refreshBootTicker", () => {
  test("re-fetches the displayed symbols through the ticker dependency", async () => {
    const symbols: TickerSymbol[] = [{ symbol: "BTC", kind: "crypto" }];
    let calls = 0;
    const refreshDeps = deps({
      fetchTicker: async (receivedSymbols) => {
        calls += 1;
        expect(receivedSymbols).toEqual(symbols);
        return [
          {
            symbol: "BTC",
            kind: "crypto",
            priceUsd: 60_000 + calls,
            changePercent24h: 1.2,
          },
        ];
      },
    });

    await expect(refreshBootTicker(symbols, refreshDeps)).resolves.toEqual([
      { symbol: "BTC", kind: "crypto", priceUsd: 60_001, changePercent24h: 1.2 },
    ]);
    await expect(refreshBootTicker(symbols, refreshDeps)).resolves.toEqual([
      { symbol: "BTC", kind: "crypto", priceUsd: 60_002, changePercent24h: 1.2 },
    ]);
    expect(calls).toBe(2);
  });

  test("times out a hanging ticker refresh", async () => {
    await expect(
      refreshBootTicker(
        [{ symbol: "BTC", kind: "crypto" }],
        deps({
          fetchTicker: () => new Promise(() => {}),
          timeoutMs: 20,
        }),
      ),
    ).resolves.toBeNull();
  });
});

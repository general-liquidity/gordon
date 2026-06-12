import { describe, expect, test } from "bun:test";
import { loadBootLiveData, type BootLiveDeps } from "./bootLiveData.ts";
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
      { symbol: "BTC", priceUsd: 67_432, changePercent24h: 2.3 },
      { symbol: "ETH", priceUsd: 3_521, changePercent24h: -0.8 },
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
        { symbol: "BTC", priceUsd: 67_432, changePercent24h: 2.3 },
        { symbol: "ETH", priceUsd: 3_521, changePercent24h: -0.8 },
      ],
    });
  });

  test("degrades connectivity independently when the venue probe rejects", async () => {
    const data = await loadBootLiveData(deps({
      testVenue: async () => {
        throw new Error("network down");
      },
    }));
    expect(data.venue.connectivity).toBe("offline");
    expect(data.equityUsd).toBe(12_408.32);
    expect(data.audit.state).toBe("ok");
    expect(data.ticker).toHaveLength(2);
  });

  test("times out a hanging venue probe", async () => {
    const data = await loadBootLiveData(deps({
      testVenue: () => new Promise(() => {}),
      timeoutMs: 20,
    }));
    expect(data.venue.connectivity).toBe("offline");
  });

  test("reports none when no exchange is configured", async () => {
    let equityCalled = false;
    const data = await loadBootLiveData(deps({
      loadConfig: async () => ({ ...baseConfig, exchanges: [], activeExchangeId: undefined }) as GordonConfig,
      fetchEquity: async () => {
        equityCalled = true;
        return 1;
      },
    }));
    expect(data.venue).toEqual({ label: null, paper: false, connectivity: "none" });
    expect(data.equityUsd).toBeNull();
    expect(equityCalled).toBe(false);
  });

  test("marks audit unavailable when verification throws", async () => {
    const data = await loadBootLiveData(deps({
      verifyAudit: () => {
        throw new Error("sqlite unavailable");
      },
    }));
    expect(data.audit).toEqual({ state: "unavailable", checked: 0 });
  });

  test("never rejects when every probe fails", async () => {
    await expect(loadBootLiveData(deps({
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
    }))).resolves.toEqual({
      venue: { label: null, paper: false, connectivity: "none" },
      equityUsd: null,
      audit: { state: "unavailable", checked: 0 },
      ticker: null,
    });
  });
});

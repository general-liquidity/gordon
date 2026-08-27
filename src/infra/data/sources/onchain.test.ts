import { describe, expect, it } from "bun:test";

import { onchainDataSources } from "./onchain.ts";
import type { OHLCParams } from "./types.ts";

const baseParams: OHLCParams = {
  symbol: "BTCUSDT",
  timeframe: "1h",
  startTime: Date.now() - 86_400_000,
  endTime: Date.now(),
};

describe("onchain data sources", () => {
  const sources = onchainDataSources();

  it("registers all six onchain price sources with distinct ids + priorities", () => {
    const ids = sources.map((s) => s.id);
    expect(ids.sort()).toEqual([
      "birdeye",
      "codex",
      "coingecko-onchain",
      "defillama",
      "dexscreener",
      "oneinch",
    ]);
    // Unique priorities so the manager has a deterministic fallback order.
    expect(new Set(sources.map((s) => s.priority)).size).toBe(sources.length);
  });

  it("each implements the DataSource contract + declares crypto market family", () => {
    for (const s of sources) {
      expect(typeof s.id).toBe("string");
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.requiresAuth).toBe("boolean");
      const caps = s.getCapabilities();
      expect(caps.markets).toEqual(["crypto"]);
      expect(caps.supportedTimeframes.length).toBeGreaterThan(0);
    }
  });

  it("returns [] (never throws) when chain/token addressing is absent — so the manager falls through", async () => {
    for (const s of sources) {
      // No chain / no tokenAddress → onchain source must decline, not throw.
      const out = await s.fetchOHLC(baseParams);
      expect(out).toEqual([]);
    }
  });

  it("returns [] when a chain is given but no token/pool address", async () => {
    for (const s of sources) {
      const out = await s.fetchOHLC({ ...baseParams, chain: "ethereum" });
      expect(out).toEqual([]);
    }
  });
});

import { describe, expect, it } from "bun:test";

import {
  onchainMetricSources,
  OnchainMetricsManager,
  registerOnchainMetricSources,
} from "./index.ts";

describe("onchain metrics adapter", () => {
  const sources = onchainMetricSources();

  it("registers the five providers with distinct ids + priorities", () => {
    expect(sources.map((s) => s.id).sort()).toEqual([
      "cryptoquant",
      "glassnode",
      "intotheblock",
      "messari",
      "santiment",
    ]);
    expect(new Set(sources.map((s) => s.priority)).size).toBe(sources.length);
  });

  it("each declares a non-empty canonical-metric catalog + assets + resolutions", () => {
    for (const s of sources) {
      const caps = s.getCapabilities();
      expect(caps.metrics.length).toBeGreaterThan(0);
      expect(caps.assets.length).toBeGreaterThan(0);
      expect(caps.resolutions.length).toBeGreaterThan(0);
    }
  });

  it("the union of providers covers the headline metrics (exchange flow, mvrv, active addresses)", () => {
    const all = new Set(sources.flatMap((s) => s.getCapabilities().metrics));
    expect(all.has("exchange_netflow")).toBeTrue();
    expect(all.has("mvrv")).toBeTrue();
    expect(all.has("active_addresses")).toBeTrue();
  });

  it("manager returns null (never throws) when no provider is available — no keys set", async () => {
    const m = new OnchainMetricsManager();
    registerOnchainMetricSources(m);
    const out = await m.getMetric({ asset: "BTC", metric: "exchange_netflow", timeframe: "1d" });
    expect(out).toBeNull();
  });

  it("manager returns null for a metric no provider supports", async () => {
    const m = new OnchainMetricsManager();
    registerOnchainMetricSources(m);
    // stablecoin_supply was not mapped by any provider in this set.
    const out = await m.getMetric({ asset: "BTC", metric: "stablecoin_supply" });
    expect(out).toBeNull();
  });
});

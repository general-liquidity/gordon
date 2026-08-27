import { describe, expect, it } from "bun:test";

import { getExecutionVenueMetadata, getIntegrationSurfaceMetadata } from "./taxonomy.ts";

describe("integration taxonomy", () => {
  it("derives crypto venue metadata from the ccxt id (no hardcoded venue list)", () => {
    // DEX (decentralized) — both canonical ccxt: and legacy bare forms resolve.
    for (const id of ["ccxt:hyperliquid", "hyperliquid"] as const) {
      const meta = getExecutionVenueMetadata(id);
      expect(meta.marketFamily).toBe("crypto");
      expect(meta.venueKind).toBe("dex");
      expect(meta.executionModel).toBe("decentralized");
    }
    // CEX (centralized) — first-class + arbitrary long-tail both derive.
    for (const id of ["ccxt:binance", "ccxt:bybit", "ccxt:kucoin"] as const) {
      const meta = getExecutionVenueMetadata(id);
      expect(meta.marketFamily).toBe("crypto");
      expect(meta.venueKind).toBe("cex");
      expect(meta.executionModel).toBe("centralized");
    }
  });

  it("exposes CCXT as the single unified crypto execution surface", () => {
    const ccxt = getIntegrationSurfaceMetadata("ccxt");
    expect(ccxt.integrationDomain).toBe("execution_venue");
    expect(ccxt.marketFamily).toBe("crypto");
  });

  it("classifies first-party model providers", () => {
    expect(getIntegrationSurfaceMetadata("anthropic").integrationDomain).toBe("model_provider");
    expect(getIntegrationSurfaceMetadata("xai").integrationDomain).toBe("model_provider");
  });

  it("classifies the model providers + observability (non-crypto surfaces retained)", () => {
    expect(getIntegrationSurfaceMetadata("openai").integrationDomain).toBe("model_provider");
    expect(getIntegrationSurfaceMetadata("opentelemetry").integrationDomain).toBe(
      "observability_provider",
    );
  });
});

import { describe, expect, it } from "bun:test";

import {
  getExecutionVenueMetadata,
  getIntegrationSurfaceMetadata,
} from "./taxonomy.ts";

describe("integration taxonomy", () => {
  it("classifies Uniswap as an amm_dex", () => {
    const metadata = getExecutionVenueMetadata("uniswap");
    expect(metadata.venueKind).toBe("dex");
    expect(metadata.venueSubtype).toBe("amm_dex");
    expect(metadata.executionModel).toBe("decentralized");
  });

  it("classifies Hyperliquid as a perps_dex", () => {
    const metadata = getExecutionVenueMetadata("hyperliquid");
    expect(metadata.venueKind).toBe("dex");
    expect(metadata.venueSubtype).toBe("perps_dex");
  });

  it("classifies Dedalus as the routed model gateway parent", () => {
    const gateway = getIntegrationSurfaceMetadata("dedalus");
    const routed = getIntegrationSurfaceMetadata("dedalus/openai");
    expect(gateway.integrationDomain).toBe("model_gateway");
    expect(routed.integrationDomain).toBe("model_provider");
    expect(routed.gatewayParent).toBe("dedalus");
  });

  it("classifies SynthData as a research analytics provider", () => {
    const metadata = getIntegrationSurfaceMetadata("synthdata");
    expect(metadata.integrationDomain).toBe("research_analytics_provider");
    expect(metadata.gordonEnabledMarkets).toEqual(["crypto", "stocks"]);
  });

  it("classifies Base RPC and Flashblocks as chain infrastructure surfaces", () => {
    expect(getIntegrationSurfaceMetadata("base_rpc").infraKind).toBe("chain_ecosystem");
    expect(getIntegrationSurfaceMetadata("base_flashblocks").infraKind).toBe("chain_ecosystem");
  });

  it("tracks nested Solana dependencies instead of flattening them into first-class venues", () => {
    const drift = getIntegrationSurfaceMetadata("drift");
    const jupiter = getIntegrationSurfaceMetadata("jupiter");
    expect(drift.taxonomyScope).toBe("nested_dependency");
    expect(drift.parentSurfaceId).toBe("solanakit");
    expect(jupiter.venueSubtype).toBe("dex_aggregator");
  });
});

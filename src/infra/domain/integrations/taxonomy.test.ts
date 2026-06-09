import { describe, expect, it } from "bun:test";

import {
  getExecutionVenueMetadata,
  getIntegrationSurfaceMetadata,
} from "./taxonomy.ts";

describe("integration taxonomy", () => {
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

  it("classifies Base RPC and Flashblocks as chain infrastructure surfaces", () => {
    expect(getIntegrationSurfaceMetadata("base_rpc").infraKind).toBe("chain_ecosystem");
    expect(getIntegrationSurfaceMetadata("base_flashblocks").infraKind).toBe("chain_ecosystem");
  });
});

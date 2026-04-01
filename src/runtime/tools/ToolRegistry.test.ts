import { describe, expect, it } from "bun:test";
import { ToolRegistry } from "./ToolRegistry.ts";

describe("ToolRegistry", () => {
  it("registers external runtime tools with richer definitions", () => {
    const registry = new ToolRegistry();
    registry.registerExternalTools([
      {
        origin: "mcp",
        spec: {
          ...registry.ensure("coingecko_prices"),
          origin: "mcp",
          pluginId: "coingecko",
          serverId: "coingecko",
          displayName: "CoinGecko Prices",
        },
      },
    ]);

    const definition = registry.getDefinition("coingecko_prices");
    expect(definition?.origin).toBe("mcp");
    expect(definition?.spec.pluginId).toBe("coingecko");
    expect(registry.listDefinitions().length).toBeGreaterThan(0);
  });
});

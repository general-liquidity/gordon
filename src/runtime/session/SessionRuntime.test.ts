import { describe, expect, it } from "bun:test";

import { SessionRuntimeFactory } from "./SessionRuntimeFactory.ts";

describe("SessionRuntime", () => {
  it("preserves routed tool metadata when syncing tooling state", () => {
    const factory = new SessionRuntimeFactory({
      resolveContext: async () => ({
        userId: "user-1",
        config: { mode: "SAFE" },
      }) as any,
    });

    try {
      const runtime = factory.get("app", { sessionId: "app" });
      runtime.syncToolingState({
        commands: ["/scan", "/analyze"],
        tools: [
          {
            id: "coingecko_prices",
            origin: "mcp",
            pluginId: "coingecko",
            serverId: "coingecko",
            displayName: "CoinGecko prices",
            routedToAgent: "Analyst",
            exposedOnGordon: true,
          },
        ],
      });

      expect(runtime.getState().tooling.commands).toEqual(["/scan", "/analyze"]);
      expect(runtime.getState().tooling.tools[0]?.routedToAgent).toBe("Analyst");
      expect(runtime.getState().tooling.tools[0]?.exposedOnGordon).toBe(true);
    } finally {
      factory.dispose();
    }
  });
});

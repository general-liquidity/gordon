import { describe, expect, it } from "bun:test";

import { RuntimePluginManager } from "./RuntimePluginManager.ts";

describe("RuntimePluginManager", () => {
  it("syncs plugin and MCP inventory into the runtime", async () => {
    const updates: unknown[] = [];
    const runtime = {
      syncToolingState(input: unknown) {
        updates.push(input);
      },
    } as any;

    const manager = new RuntimePluginManager({
      initializePlugins: async () => undefined,
      listPlugins: () => [
        {
          id: "coingecko",
          name: "CoinGecko",
          enabled: true,
          category: "data-provider",
          toolCount: 2,
          commandCount: 2,
          integrationCommands: ["/scan", "/analyze"],
          defaultAgent: "Analyst",
          alsoOnGordon: true,
          routedToolCount: 1,
        },
      ],
      listMcpServers: () => [
        { id: "coingecko", name: "CoinGecko", category: "data", toolCount: 2 },
      ],
      listTools: () => [
        {
          id: "coingecko_prices",
          origin: "mcp",
          pluginId: "coingecko",
          serverId: "coingecko",
          displayName: "prices",
          routedToAgent: "Analyst",
          exposedOnGordon: true,
        },
      ],
      listCommands: () => ["/scan", "/analyze"],
      reloadPlugins: async () => undefined,
      enableHotReload: () => undefined,
      disableHotReload: () => undefined,
    });

    const inventory = await manager.initialize(runtime);
    expect(inventory.plugins).toHaveLength(1);
    expect(inventory.tools[0]?.id).toBe("coingecko_prices");
    expect(inventory.tools[0]?.routedToAgent).toBe("Analyst");
    expect(inventory.commands).toEqual(["/scan", "/analyze"]);
    expect(updates).toHaveLength(1);
    expect((updates[0] as { commands: string[] }).commands).toEqual(["/scan", "/analyze"]);
  });

  it("surfaces lifecycle attention when a plugin exposes no commands", async () => {
    const runtime = {
      syncToolingState() {
        return undefined;
      },
    } as any;

    const manager = new RuntimePluginManager({
      initializePlugins: async () => undefined,
      listPlugins: () => [
        {
          id: "agent-only",
          name: "Agent Only",
          enabled: true,
          category: "execution",
          status: "ready",
          lifecycle: "routed",
          toolCount: 2,
          commandCount: 0,
          surfacedCommandCount: 0,
          integrationCommands: [],
          attentionLevel: "warning",
          attentionReasons: ["no commands surfaced", "agent-routed only"],
        },
      ],
      listMcpServers: () => [],
      listTools: () => [],
      listCommands: () => [],
      reloadPlugins: async () => undefined,
      enableHotReload: () => undefined,
      disableHotReload: () => undefined,
    });

    const inventory = await manager.initialize(runtime);
    expect(inventory.plugins[0]?.attentionLevel).toBe("warning");
    expect(inventory.plugins[0]?.attentionReasons).toContain("no commands surfaced");
  });
});

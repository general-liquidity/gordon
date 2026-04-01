import { describe, expect, it } from "bun:test";
import { RuntimeStore } from "./RuntimeStore.ts";
import { createDefaultRuntimeSessionState } from "./SessionState.ts";

describe("RuntimeStore", () => {
  it("tracks stream lifecycle transitions", () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    store.startStream({
      session: { runtimeId: "app", resourceId: "user-1", threadId: "thread-1" },
      userMessage: "hello",
    });
    expect(store.getState().stream.status).toBe("running");
    expect(store.getState().lastUserMessage).toBe("hello");

    store.markAgentSwitch("Analyst");
    expect(store.getState().stream.activeAgent).toBe("Analyst");

    store.completeStream("done");
    expect(store.getState().stream.status).toBe("completed");
    expect(store.getState().lastAssistantMessage).toBe("done");
  });

  it("tracks tooling and remote runtime metadata", () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));

    store.setToolingState({
      commands: ["reload-plugins"],
      plugins: [{ id: "coingecko", name: "CoinGecko", enabled: true, category: "data" }],
      mcpServers: [{ id: "coingecko", name: "CoinGecko", category: "data", toolCount: 4 }],
      tools: [{ id: "coingecko_prices", origin: "mcp", pluginId: "coingecko", serverId: "coingecko" }],
    });
    store.setRemoteState({
      connectionStatus: "connected",
      reachable: true,
      actor: "daemon",
      detail: "healthy",
    });

    expect(store.getState().tooling.plugins).toHaveLength(1);
    expect(store.getState().tooling.mcpServers[0]?.id).toBe("coingecko");
    expect(store.getState().remote.connectionStatus).toBe("connected");
    expect(store.getState().remote.reachable).toBe(true);
  });
});

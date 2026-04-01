import { describe, expect, it } from "bun:test";
import { createAppStore, createInitialAppState } from "./AppStore.ts";
import { OVERLAY_NONE } from "../overlayState.ts";

describe("AppStore", () => {
  it("publishes state updates through the external store", () => {
    const store = createAppStore(createInitialAppState({
      setupMode: "advanced",
      setupSection: null,
      overlay: OVERLAY_NONE,
    }));

    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    store.patchState({ isLoading: true });
    expect(store.getState().isLoading).toBe(true);
    expect(notified).toBe(1);

    store.setState((previous) => ({
      ...previous,
      activityStatus: "Running",
    }));
    expect(store.getState().activityStatus).toBe("Running");
    expect(notified).toBe(2);

    unsubscribe();
  });

  it("supports semantic message and runtime inspector actions", () => {
    const store = createAppStore(createInitialAppState({
      setupMode: "advanced",
      setupSection: null,
      overlay: OVERLAY_NONE,
    }));

    store.appendMessages([
      { role: "user", content: "hello", timestamp: "t1" },
      { role: "gordon", content: "world", timestamp: "t2" },
    ]);
    expect(store.getState().messages).toHaveLength(2);

    store.updateMessages((messages) => messages.map((message) => (
      message.timestamp === "t2"
        ? { ...message, content: "updated" }
        : message
    )));
    expect(store.getState().messages[1]?.content).toBe("updated");

    store.replaceMessages([{ role: "gordon", content: "fresh", timestamp: "t3" }]);
    expect(store.getState().messages).toHaveLength(1);
    expect(store.getState().messages[0]?.content).toBe("fresh");

    store.setView("chat");
    expect(store.getState().view).toBe("chat");

    store.setRuntimeInspector({
      streamStatus: "idle",
      permissionScopes: [],
      backgroundTaskCount: 0,
      pendingApprovalCount: 0,
      recentApprovalCount: 0,
      pendingApprovals: [],
      pluginCount: 0,
      mcpServerCount: 0,
      registeredToolCount: 0,
      commandCount: 0,
      routingCount: 0,
      toolingHotReloadEnabled: false,
      recentPlugins: [],
      remoteConnectionStatus: "offline",
      remoteReachable: false,
      activeBridgeSessions: 0,
      recentBridge: [],
      transcriptEntryCount: 0,
      compactionCount: 0,
      recentTranscript: [],
      recentApprovals: [],
      recentScratchpad: [],
      recentHandoffs: [],
      hasContent: false,
      lastUpdatedAt: new Date().toISOString(),
    });
    expect(store.getState().runtimeInspector).not.toBeNull();
  });
});

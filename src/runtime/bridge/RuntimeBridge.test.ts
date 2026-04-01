import { describe, expect, it } from "bun:test";

import { RuntimeBridge } from "./RuntimeBridge.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";

describe("RuntimeBridge", () => {
  it("tracks active and completed ingress sessions", () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const bridge = new RuntimeBridge(store);

    const session = bridge.begin({
      runtimeId: "app",
      sessionId: "app",
      source: "daemon",
      commandType: "chat.send_message",
      correlationId: "corr-1",
    });

    expect(store.getState().bridge.active).toHaveLength(1);
    expect(store.getState().remote.connectionStatus).toBe("connected");

    bridge.complete(session.id, "chat completed");
    expect(store.getState().bridge.active).toHaveLength(0);
    expect(store.getState().bridge.recent[0]?.status).toBe("completed");
  });
});

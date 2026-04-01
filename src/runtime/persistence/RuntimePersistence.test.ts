import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { RuntimePersistence } from "./RuntimePersistence.ts";
import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";

describe("RuntimePersistence", () => {
  it("round-trips runtime state, transcript, and scratchpad", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-runtime-"));
    const persistence = new RuntimePersistence({ baseDir: dir });
    try {
      const runtimeState = createDefaultRuntimeSessionState("app");
      runtimeState.remote.connectionStatus = "connected";
      runtimeState.remote.reachable = true;
      runtimeState.approvals.recent = [
        {
          id: "approval-1",
          toolName: "place_market_order",
          permissionScope: "livetrade.execute",
          approvalClass: "per_action",
          riskClass: "high",
          sideEffectLevel: "execution",
          runtimeId: "app",
          sessionId: "app",
          resourceId: "user-1",
          threadId: "thread-1",
          fingerprint: "fp-1",
          status: "approved",
          reason: "Operator approved live trade.",
          actor: "operator",
          decisionSource: "human",
          requestedAt: "2026-01-01T00:00:03.000Z",
          decidedAt: "2026-01-01T00:00:04.000Z",
        },
      ];
      runtimeState.bridge.recent = [
        {
          id: "bridge-1",
          runtimeId: "app",
          sessionId: "app",
          source: "daemon",
          commandType: "chat.send_message",
          status: "completed",
          startedAt: "2026-01-01T00:00:05.000Z",
          updatedAt: "2026-01-01T00:00:06.000Z",
          detail: "chat completed",
        },
      ];

      persistence.save("app", {
        runtimeState,
        transcript: [
          { id: "1", timestamp: "2026-01-01T00:00:00.000Z", role: "user", content: "hello" },
        ],
        scratchpad: {
          entries: [
            {
              id: "2",
              timestamp: "2026-01-01T00:00:01.000Z",
              worker: "Analyst",
              kind: "note",
              content: "watching BTC",
            },
          ],
          handoffs: [
            {
              id: "3",
              timestamp: "2026-01-01T00:00:02.000Z",
              fromWorker: "Gordon",
              toWorker: "Analyst",
              reason: "Need market read",
            },
          ],
        },
      });

      const loaded = persistence.load("app");
      expect(loaded?.runtimeState?.remote.connectionStatus).toBe("connected");
      expect(loaded?.transcript).toHaveLength(1);
      expect(loaded?.scratchpad?.entries).toHaveLength(1);
      expect(loaded?.scratchpad?.handoffs).toHaveLength(1);
      expect(persistence.searchHistory("hello")).toHaveLength(1);
      expect(persistence.searchHistory("place_market_order")[0]?.source).toBe("approval");
      expect(persistence.searchHistory("chat.send_message")[0]?.source).toBe("bridge");
      expect(persistence.listRecentSessions(1)[0]?.runtimeId).toBe("app");
    } finally {
      persistence.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

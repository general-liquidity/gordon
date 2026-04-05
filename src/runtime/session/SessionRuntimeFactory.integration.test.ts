import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { RuntimePersistence } from "../persistence/RuntimePersistence.ts";
import { SessionRuntimeFactory } from "./SessionRuntimeFactory.ts";

describe("SessionRuntimeFactory integration", () => {
  it("persists and restores runtime transcript, scratchpad, and history across factory instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-runtime-e2e-"));
    const persistence = new RuntimePersistence({ baseDir: dir });
    let factory: SessionRuntimeFactory | null = null;
    let reloadedFactory: SessionRuntimeFactory | null = null;
    try {
      factory = new SessionRuntimeFactory({
        persistence,
        resolveContext: async () => ({
          userId: "user-1",
          config: { permissionMode: "ask" },
        }) as any,
      });

      const runtime = factory.get("app", { sessionId: "app" });
      runtime.getTranscriptStore().append({
        id: "u1",
        timestamp: "2026-01-01T00:00:00.000Z",
        role: "user",
        content: "search BTC setup",
      });
      runtime.getScratchpadStore().appendEntry({
        id: "n1",
        timestamp: "2026-01-01T00:00:01.000Z",
        worker: "Analyst",
        kind: "note",
        content: "BTC pullback watch",
      });
      runtime.persistNow();

      reloadedFactory = new SessionRuntimeFactory({
        persistence,
        resolveContext: async () => ({
          userId: "user-1",
          config: { permissionMode: "ask" },
        }) as any,
      });

      const restored = reloadedFactory.get("app", { sessionId: "app" });
      expect(restored.getTranscript()).toHaveLength(1);
      expect(restored.getScratchpadEntries()).toHaveLength(1);
      expect(restored.searchHistory("BTC")).toHaveLength(2);
      expect(restored.listRecentHistory(1)[0]?.runtimeId).toBe("app");
    } finally {
      factory?.dispose();
      reloadedFactory?.dispose();
      persistence.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

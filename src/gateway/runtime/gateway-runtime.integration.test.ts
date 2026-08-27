import { describe, expect, it } from "bun:test";

import { createEnvelopeMeta } from "../protocol/envelope.ts";
import { GatewayRuntime } from "./gateway-runtime.ts";
import { SessionRuntimeFactory } from "../../runtime/index.ts";
import { RuntimePersistence } from "../../runtime/persistence/RuntimePersistence.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("GatewayRuntime integration", () => {
  it("records bridge ingress into the shared runtime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-gateway-runtime-"));
    const persistence = new RuntimePersistence({ baseDir: dir });
    let sessionRuntimeFactory: SessionRuntimeFactory | null = null;
    try {
      sessionRuntimeFactory = new SessionRuntimeFactory({
        persistence,
        resolveContext: async ({ session }) =>
          ({
            userId: session.resourceId ?? "user-1",
            config: { permissionMode: "ask" },
          }) as any,
      });

      const runtime = new GatewayRuntime({
        sessionRuntimeFactory,
        resolveContext: async () =>
          ({
            userId: "user-1",
            config: { permissionMode: "ask" },
          }) as any,
      });

      const envelope = {
        meta: createEnvelopeMeta({
          sessionId: "app",
          source: "agent",
          idempotencyKey: `test_${Date.now()}`,
        }),
        command: {
          type: "runtime.background_status",
          payload: {},
        },
      };
      const handler = (runtime as any).handlers.get("runtime.background_status") as (
        input: typeof envelope,
      ) => Promise<unknown>;
      const response = await handler(envelope);
      expect(response).toBeDefined();

      const sessionRuntime = sessionRuntimeFactory.get("app", { sessionId: "app" });
      expect(sessionRuntime.getBridgeSessions().recent.length).toBeGreaterThan(0);
      expect(sessionRuntime.getState().remote.connectionStatus).toBe("connected");
    } finally {
      sessionRuntimeFactory?.dispose();
      persistence.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

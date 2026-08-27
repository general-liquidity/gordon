import { afterEach, describe, expect, it } from "bun:test";

import { SessionRuntimeFactory } from "./SessionRuntimeFactory.ts";
import { clearHooks, registerHook } from "../../infra/hooks/engine.ts";
import {
  getActiveACELessonRevision,
  resetActiveACELessonRevision,
  setActiveACELessonRevision,
} from "../../infra/agents/ace/activeRevision.ts";

afterEach(() => {
  clearHooks();
  resetActiveACELessonRevision();
});

describe("SessionRuntime", () => {
  it("preserves routed tool metadata when syncing tooling state", () => {
    const factory = new SessionRuntimeFactory({
      resolveContext: async () =>
        ({
          userId: "user-1",
          config: { permissionMode: "ask" },
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

  it("emits session start, stop, and end through the production runtime lifecycle", async () => {
    const events: string[] = [];
    registerHook({
      id: "start",
      point: "SessionStart",
      handler: () => {
        events.push("start");
        return { action: "allow" };
      },
    });
    registerHook({
      id: "stop",
      point: "Stop",
      handler: async () => {
        await Bun.sleep(5);
        events.push("stop");
        return { action: "allow" };
      },
    });
    registerHook({
      id: "end",
      point: "SessionEnd",
      handler: async () => {
        await Bun.sleep(5);
        events.push("end");
        return { action: "allow" };
      },
    });
    const info = {
      resourceId: "user-1",
      threadId: "thread-1",
      isNewSession: true,
      previousThreadId: null,
    };
    const factory = new SessionRuntimeFactory({
      resolveContext: async () =>
        ({ userId: "user-1", config: { permissionMode: "ask" } }) as never,
      sessionController: {
        captureState: async () => ({ marker: "before" }),
        restoreState: async () => undefined,
        initializeSession: async () => info,
        resumeSession: async () => info,
        startNewSession: async () => info,
        getCurrentSession: async () => ({ resourceId: "user-1", threadId: "thread-1" }),
      } as never,
    });
    const runtime = factory.get("app", { sessionId: "app" });
    await runtime.initializeSession();
    await factory.disposeAsync();
    expect(events).toEqual(["start", "stop", "end"]);
  });

  it("attempts SessionEnd and disposes the factory before surfacing a Stop-hook failure", async () => {
    const events: string[] = [];
    registerHook({
      id: "stop-failure",
      point: "Stop",
      handler: () => ({ action: "block", reason: "audit sink unavailable" }),
    });
    registerHook({
      id: "end-observer",
      point: "SessionEnd",
      handler: () => {
        events.push("end");
        return { action: "allow" };
      },
    });
    const factory = new SessionRuntimeFactory({
      resolveContext: async () =>
        ({ userId: "user-1", config: { permissionMode: "ask" } }) as never,
    });
    factory.get("app", { sessionId: "app" });

    await expect(factory.disposeAsync()).rejects.toThrow(/lifecycle failures/);
    expect(events).toEqual(["end"]);
    await expect(factory.disposeAsync()).resolves.toBeUndefined();
  });

  it("rolls back the persisted and in-memory session transition when SessionStart vetoes it", async () => {
    const restored: unknown[] = [];
    registerHook({
      id: "veto-session",
      point: "SessionStart",
      handler: () => ({ action: "block", reason: "maintenance window" }),
    });
    const info = {
      resourceId: "user-2",
      threadId: "rejected-thread",
      isNewSession: true,
      previousThreadId: "old-thread",
    };
    const factory = new SessionRuntimeFactory({
      resolveContext: async () =>
        ({ userId: "user-2", config: { permissionMode: "ask" } }) as never,
      sessionController: {
        captureState: async () => ({ threadId: "old-thread" }),
        restoreState: async (state: unknown) => {
          restored.push(state);
        },
        initializeSession: async () => info,
        resumeSession: async () => info,
        startNewSession: async () => info,
        getCurrentSession: async () => ({ resourceId: "user-2", threadId: "rejected-thread" }),
      } as never,
    });
    try {
      const runtime = factory.get("veto-runtime", { sessionId: "veto-session" });
      const before = structuredClone(runtime.getState().session);
      await expect(runtime.initializeSession()).rejects.toThrow(/maintenance window/);
      expect(restored).toEqual([{ threadId: "old-thread" }]);
      expect(runtime.getState().session).toEqual(before);
    } finally {
      factory.dispose();
    }
  });

  it("clears every session alias for the active ACE revision on synchronous teardown", () => {
    const factory = new SessionRuntimeFactory({
      resolveContext: async () =>
        ({ userId: "user-1", config: { permissionMode: "ask" } }) as never,
    });
    const runtime = factory.get("runtime-1", { sessionId: "session-1" });
    runtime.getState().session.threadId = "thread-1";
    runtime.getState().session.resourceId = "user-1";
    setActiveACELessonRevision(7, ["session-1", "thread-1", "user-1"]);

    factory.dispose();

    expect(getActiveACELessonRevision("session-1")).toBe(0);
    expect(getActiveACELessonRevision("thread-1")).toBe(0);
    expect(getActiveACELessonRevision("user-1")).toBe(0);
  });
});

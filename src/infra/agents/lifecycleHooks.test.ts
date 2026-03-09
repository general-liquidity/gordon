import { describe, expect, it } from "bun:test";

import { GordonConfigSchema } from "../../types/config.ts";
import {
  clearLifecycleHooks,
  clearLifecycleSessions,
  endLifecycleSession,
  registerLifecycleHook,
  runLifecycleHooks,
  startLifecycleSession,
} from "./lifecycleHooks.ts";
import type { GordonContext } from "./types.ts";

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({}),
    portfolioValue: 0,
    availableCash: 0,
    threadId: "thread-lifecycle-hooks",
    ...overrides,
  };
}

describe("lifecycleHooks", () => {
  it("aggregates annotations and supports blocking", async () => {
    clearLifecycleHooks();
    registerLifecycleHook("annotate", "before_request", async () => ({
      annotations: ["runtime note"],
    }));
    registerLifecycleHook("block", "before_request", async () => ({
      blocked: true,
      reason: "blocked by test",
    }));

    const result = await runLifecycleHooks("before_request", createContext(), {
      userMessage: "hello",
    });

    expect(result.blocked).toBeTrue();
    expect(result.reason).toBe("blocked by test");
    expect(result.annotations).toContain("runtime note");
    clearLifecycleHooks();
  });

  it("fires session_start and session_end only once per thread lifecycle", async () => {
    clearLifecycleHooks();
    clearLifecycleSessions();
    const events: string[] = [];
    registerLifecycleHook("session-start", "session_start", async () => {
      events.push("start");
    });
    registerLifecycleHook("session-end", "session_end", async () => {
      events.push("end");
    });

    const context = createContext();
    await startLifecycleSession(context, { threadId: context.threadId });
    await startLifecycleSession(context, { threadId: context.threadId });
    await endLifecycleSession(context, { threadId: context.threadId });
    await endLifecycleSession(context, { threadId: context.threadId });

    expect(events).toEqual(["start", "end"]);
    clearLifecycleHooks();
    clearLifecycleSessions();
  });
});

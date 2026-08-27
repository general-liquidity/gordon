import { afterEach, describe, expect, test } from "bun:test";

import { clearHooks, registerHook } from "../hooks/engine.ts";
import { resetSubagentHookBridgeForTests } from "../hooks/subagentHookBridge.ts";
import { applyUserPromptSubmitHooks, buildInlineSupervisorDelegation } from "./orchestrator.ts";
import type { StreamProcessingState } from "./orchestrator/streamProcessor.ts";

afterEach(() => {
  clearHooks();
  resetSubagentHookBridgeForTests();
});

describe("UserPromptSubmit production bridge", () => {
  test("threads a hook-modified prompt into the model-facing path", async () => {
    registerHook({
      id: "prefix",
      point: "UserPromptSubmit",
      handler: (payload) => ({
        action: "modify",
        replacement: { prompt: `[reviewed] ${payload.prompt}` },
      }),
    });
    const context = { threadId: "thread-1", runtime: { sessionId: "session-1" } } as never;
    expect(await applyUserPromptSubmitHooks("hello", context)).toBe("[reviewed] hello");
  });

  test("turns a block into a fail-closed prompt refusal", async () => {
    registerHook({
      id: "deny",
      point: "UserPromptSubmit",
      handler: () => ({ action: "block", reason: "operator policy" }),
    });
    await expect(applyUserPromptSubmitHooks("hello", {} as never)).rejects.toThrow(
      "operator policy",
    );
  });

  test("refuses a malformed prompt replacement instead of dispatching it", async () => {
    registerHook({
      id: "malformed",
      point: "UserPromptSubmit",
      handler: () => ({ action: "modify", replacement: { prompt: undefined } as never }),
    });
    await expect(applyUserPromptSubmitHooks("hello", {} as never)).rejects.toThrow(
      /invalid non-string prompt/,
    );
  });
});

describe("inline supervisor lifecycle bridge", () => {
  test("pairs a non-native delegation start and completion by tool-call id", async () => {
    const seen: Array<{ point: string; id: string; status?: string }> = [];
    registerHook({
      id: "start-observer",
      point: "SubagentStart",
      handler: (payload) => {
        seen.push({ point: "start", id: payload.subagentId });
        return { action: "allow" };
      },
    });
    registerHook({
      id: "stop-observer",
      point: "SubagentStop",
      handler: (payload) => {
        seen.push({ point: "stop", id: payload.subagentId, status: payload.status });
        return { action: "allow" };
      },
    });
    const state: StreamProcessingState = {
      currentAgent: undefined,
      fullText: "",
      lastSubAgentToolResult: null,
      pendingToolCalls: new Map(),
    };
    const delegation = buildInlineSupervisorDelegation(state, "thread-1");
    expect(
      await (delegation.onDelegationStart as (ctx: unknown) => Promise<unknown>)({
        primitiveId: "researcher",
        toolCallId: "call-1",
      }),
    ).toEqual({ proceed: true });
    await (delegation.onDelegationComplete as (ctx: unknown) => Promise<unknown>)({
      primitiveId: "researcher",
      toolCallId: "call-1",
    });
    expect(seen).toEqual([
      { point: "start", id: "call-1" },
      { point: "stop", id: "call-1", status: "completed" },
    ]);
  });

  test("a SubagentStart veto prevents the non-native delegation", async () => {
    registerHook({
      id: "veto",
      point: "SubagentStart",
      handler: () => ({ action: "block", reason: "research disabled" }),
    });
    const state: StreamProcessingState = {
      currentAgent: undefined,
      fullText: "",
      lastSubAgentToolResult: null,
      pendingToolCalls: new Map(),
    };
    const delegation = buildInlineSupervisorDelegation(state, "thread-1");
    const result = await (delegation.onDelegationStart as (ctx: unknown) => Promise<any>)({
      primitiveId: "researcher",
      toolCallId: "call-2",
    });
    expect(result.proceed).toBe(false);
    expect(result.rejectionReason).toContain("research disabled");
    expect(state.currentAgent).toBeUndefined();
  });
});

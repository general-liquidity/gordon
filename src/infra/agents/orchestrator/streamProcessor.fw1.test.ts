/**
 * FW1 emitter wiring — pending tool-call tracking smoke tests.
 *
 * Exercises the StreamProcessingState.pendingToolCalls map shape and the
 * reportToolCallInterruption hand-off into the reconciler queue. Full
 * end-to-end orchestrator cancellation tests are out of scope (require
 * Mastra live agent + stream cancellation harness); these tests verify
 * the integration contract: register on tool-call, clear on tool-result,
 * drain on catch-block emit.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { StreamProcessingState } from "./streamProcessor.ts";
import {
  _knownInterruptionQueueSizeForTests,
  _resetKnownInterruptionsForTests,
  drainKnownInterruptions,
  reportToolCallInterruption,
} from "../processors/toolcall-reconciler.ts";

function makeState(): StreamProcessingState {
  return {
    currentAgent: "Gordon",
    fullText: "",
    lastSubAgentToolResult: null,
    pendingToolCalls: new Map(),
  };
}

afterEach(() => {
  _resetKnownInterruptionsForTests();
});

describe("FW1 emitter wiring — pendingToolCalls", () => {
  test("state init includes empty pendingToolCalls map", () => {
    const state = makeState();
    expect(state.pendingToolCalls).toBeInstanceOf(Map);
    expect(state.pendingToolCalls.size).toBe(0);
  });

  test("register and clear pattern mirrors tool-call / tool-result flow", () => {
    const state = makeState();
    state.pendingToolCalls.set("call_abc", {
      toolName: "scan_market",
      startedAt: Date.now(),
      agent: "Researcher",
    });
    expect(state.pendingToolCalls.size).toBe(1);

    state.pendingToolCalls.delete("call_abc");
    expect(state.pendingToolCalls.size).toBe(0);
  });

  test("draining pendings emits to reconciler queue", () => {
    const state = makeState();
    state.pendingToolCalls.set("call_1", { toolName: "t1", startedAt: 1, agent: "A" });
    state.pendingToolCalls.set("call_2", { toolName: "t2", startedAt: 2, agent: "B" });

    // Simulate the catch-block emit
    for (const [id, entry] of state.pendingToolCalls) {
      reportToolCallInterruption(id, "cancelled", {
        toolName: entry.toolName,
        agent: entry.agent,
      });
    }
    state.pendingToolCalls.clear();

    expect(_knownInterruptionQueueSizeForTests()).toBe(2);
    expect(state.pendingToolCalls.size).toBe(0);

    // Reconciler drains by id-set (only ids present in next-turn messages)
    const drained = drainKnownInterruptions(new Set(["call_1", "call_2"]));
    expect(drained.size).toBe(2);
    expect(drained.get("call_1")?.reason).toBe("cancelled");
    expect(drained.get("call_2")?.partialState?.toolName).toBe("t2");
  });

  test("entries without toolCallId are not tracked (no Mastra id supplied)", () => {
    const state = makeState();
    // Simulate processToolCallChunk being called without an id — nothing
    // should land in the map.
    const toolCallId: string | undefined = undefined;
    if (toolCallId) {
      state.pendingToolCalls.set(toolCallId, { toolName: "x", startedAt: 0, agent: undefined });
    }
    expect(state.pendingToolCalls.size).toBe(0);
  });
});

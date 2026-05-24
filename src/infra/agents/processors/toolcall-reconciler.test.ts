import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  GordonToolCallReconciler,
  reportToolCallInterruption,
  drainKnownInterruptions,
  _resetKnownInterruptionsForTests,
  _knownInterruptionQueueSizeForTests,
} from "./toolcall-reconciler.ts";
import { TOOLCALL_RECONCILER_FLAG_ENV } from "../runtime/toolCallReconciler.ts";

const savedFlag = process.env[TOOLCALL_RECONCILER_FLAG_ENV];

function enableFlag() {
  process.env[TOOLCALL_RECONCILER_FLAG_ENV] = "1";
}

function disableFlag() {
  delete process.env[TOOLCALL_RECONCILER_FLAG_ENV];
}

beforeEach(() => {
  _resetKnownInterruptionsForTests();
  disableFlag();
});

afterEach(() => {
  if (savedFlag !== undefined) {
    process.env[TOOLCALL_RECONCILER_FLAG_ENV] = savedFlag;
  } else {
    delete process.env[TOOLCALL_RECONCILER_FLAG_ENV];
  }
});

function abortStub(_reason?: string): never {
  throw new Error("abort called: " + (_reason ?? ""));
}

function makeArgs(messages: unknown[]): {
  messages: unknown;
  abort: typeof abortStub;
} {
  return {
    messages: messages as unknown,
    abort: abortStub,
  };
}

describe("GordonToolCallReconciler — flag gating", () => {
  test("flag off → returns messages unchanged (no-op)", async () => {
    const reconciler = new GordonToolCallReconciler();
    const msgs = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_1", toolName: "x" }],
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await reconciler.processInput(makeArgs(msgs) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(result as any).toBe(msgs as any);
  });

  test("flag on → repairs dangling tool_use", async () => {
    enableFlag();
    const reconciler = new GordonToolCallReconciler();
    const msgs = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_1", toolName: "x" }],
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await reconciler.processInput(makeArgs(msgs) as any)) as unknown[];
    // Length grows by 1 (one inserted tool message)
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(msgs.length + 1);
  });

  test("flag on, no dangling calls → returns messages unchanged", async () => {
    enableFlag();
    const reconciler = new GordonToolCallReconciler();
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await reconciler.processInput(makeArgs(msgs) as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(result as any).toBe(msgs as any);
  });

  test("flag on, empty messages → returns input unchanged", async () => {
    enableFlag();
    const reconciler = new GordonToolCallReconciler();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await reconciler.processInput(makeArgs([]) as any);
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(0);
  });
});

describe("reportToolCallInterruption + drainKnownInterruptions", () => {
  test("reports and drains a single interruption", () => {
    reportToolCallInterruption("call_1", "force_stop", {
      partial: "data",
    });
    expect(_knownInterruptionQueueSizeForTests()).toBe(1);
    const drained = drainKnownInterruptions(new Set(["call_1"]));
    expect(drained.size).toBe(1);
    expect(drained.get("call_1")?.reason).toBe("force_stop");
    expect(drained.get("call_1")?.partialState).toEqual({ partial: "data" });
    // Drained entries are removed from the queue
    expect(_knownInterruptionQueueSizeForTests()).toBe(0);
  });

  test("drain only consumes matching ids; unmatched persist", () => {
    reportToolCallInterruption("call_1", "force_stop");
    reportToolCallInterruption("call_2", "timeout");
    const drained = drainKnownInterruptions(new Set(["call_1"]));
    expect(drained.size).toBe(1);
    expect(_knownInterruptionQueueSizeForTests()).toBe(1);
  });

  test("queue eviction at MAX_QUEUE_SIZE (oldest dropped)", () => {
    // Push 64 entries to fill, then one more to trigger eviction.
    for (let i = 0; i < 64; i++) {
      reportToolCallInterruption(`call_${i}`, "force_stop");
    }
    expect(_knownInterruptionQueueSizeForTests()).toBe(64);
    reportToolCallInterruption("call_overflow", "timeout");
    expect(_knownInterruptionQueueSizeForTests()).toBe(64);
    // The oldest (call_0) should have been evicted
    const drained = drainKnownInterruptions(new Set(["call_0"]));
    expect(drained.size).toBe(0);
    // call_overflow should be present
    const overflowDrain = drainKnownInterruptions(new Set(["call_overflow"]));
    expect(overflowDrain.size).toBe(1);
  });

  test("empty callId is ignored", () => {
    reportToolCallInterruption("", "force_stop");
    expect(_knownInterruptionQueueSizeForTests()).toBe(0);
  });

  test("re-reporting the same callId overwrites the entry", () => {
    reportToolCallInterruption("call_1", "force_stop");
    reportToolCallInterruption("call_1", "timeout", { newer: true });
    expect(_knownInterruptionQueueSizeForTests()).toBe(1);
    const drained = drainKnownInterruptions(new Set(["call_1"]));
    expect(drained.get("call_1")?.reason).toBe("timeout");
    expect(drained.get("call_1")?.partialState).toEqual({ newer: true });
  });
});

describe("GordonToolCallReconciler — interruption hint integration", () => {
  test("known interruption maps to synthesized tool_result reason", async () => {
    enableFlag();
    reportToolCallInterruption("call_1", "force_stop", {
      side: "BUY",
      filled: 0,
    });
    const reconciler = new GordonToolCallReconciler();
    const msgs = [
      { role: "user", content: "place order" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_1", toolName: "place_order" },
        ],
      },
    ];
    const result = (await reconciler.processInput(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeArgs(msgs) as any,
    )) as unknown[];
    const inserted = result[2] as { content: unknown[] };
    const part = inserted.content[0] as {
      result: { reason: string; partialState: Record<string, unknown> };
    };
    expect(part.result.reason).toBe("force_stop");
    expect(part.result.partialState).toEqual({ side: "BUY", filled: 0 });
    // After processing, the interruption was drained
    expect(_knownInterruptionQueueSizeForTests()).toBe(0);
  });

  test("unknown dangling call falls back to reason='unknown'", async () => {
    enableFlag();
    const reconciler = new GordonToolCallReconciler();
    const msgs = [
      { role: "user", content: "x" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "lonely", toolName: "y" }],
      },
    ];
    const result = (await reconciler.processInput(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeArgs(msgs) as any,
    )) as unknown[];
    const inserted = result[2] as { content: unknown[] };
    const part = inserted.content[0] as { result: { reason: string } };
    expect(part.result.reason).toBe("unknown");
  });

  test("only drains interruptions for ids actually present in messages", async () => {
    enableFlag();
    reportToolCallInterruption("present_id", "force_stop");
    reportToolCallInterruption("absent_id", "timeout");
    const reconciler = new GordonToolCallReconciler();
    const msgs = [
      { role: "user", content: "x" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "present_id", toolName: "t" },
        ],
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reconciler.processInput(makeArgs(msgs) as any);
    // absent_id should still be in the queue
    expect(_knownInterruptionQueueSizeForTests()).toBe(1);
    const remaining = drainKnownInterruptions(new Set(["absent_id"]));
    expect(remaining.size).toBe(1);
  });
});

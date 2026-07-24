import { describe, expect, test } from "bun:test";
import {
  reconcileToolCalls,
  formatReconciliationReport,
  type InterruptionReason,
} from "./toolCallReconciler.ts";

// Helper builders for synthetic message arrays
function userMsg(content: string): Record<string, unknown> {
  return { role: "user", content };
}

function assistantTextMsg(content: string): Record<string, unknown> {
  return { role: "assistant", content };
}

function assistantWithToolCall(
  callId: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "calling tool" },
      { type: "tool-call", toolCallId: callId, toolName, args },
    ],
  };
}

function toolResultMsg(callId: string, toolName: string, result: unknown): Record<string, unknown> {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: callId, toolName, result }],
  };
}

describe("reconcileToolCalls", () => {
  test("empty input → no_messages verdict", () => {
    const r = reconcileToolCalls({ messages: [] });
    expect(r.verdict).toBe("no_messages");
    expect(r.repairCount).toBe(0);
  });

  test("non-array input → non_message_input verdict", () => {
    const r = reconcileToolCalls({
      messages: null as unknown as Record<string, unknown>[],
    });
    expect(r.verdict).toBe("non_message_input");
  });

  test("well-formed transcript (text only) → no_dangling_calls", () => {
    const msgs = [
      userMsg("hello"),
      assistantTextMsg("hi"),
      userMsg("what time is it?"),
      assistantTextMsg("noon"),
    ];
    const r = reconcileToolCalls({ messages: msgs });
    expect(r.verdict).toBe("no_dangling_calls");
    expect(r.wasWellFormed).toBe(true);
    expect(r.repairCount).toBe(0);
    expect(r.reconciledMessages.length).toBe(msgs.length);
  });

  test("well-formed transcript with paired tool call → no_dangling_calls", () => {
    const msgs = [
      userMsg("get weather"),
      assistantWithToolCall("call_1", "get_weather", { city: "NYC" }),
      toolResultMsg("call_1", "get_weather", { temp: 72 }),
      assistantTextMsg("It's 72°F"),
    ];
    const r = reconcileToolCalls({ messages: msgs });
    expect(r.verdict).toBe("no_dangling_calls");
    expect(r.repairCount).toBe(0);
  });

  test("single dangling tool_use → repaired with one synthesized result", () => {
    const msgs = [
      userMsg("get weather"),
      assistantWithToolCall("call_1", "get_weather", { city: "NYC" }),
      // no tool_result follows
      userMsg("hello again"),
    ];
    const r = reconcileToolCalls({ messages: msgs });
    expect(r.verdict).toBe("repaired");
    expect(r.repairCount).toBe(1);
    expect(r.dangling.length).toBe(1);
    expect(r.dangling[0]!.id).toBe("call_1");
    expect(r.dangling[0]!.toolName).toBe("get_weather");
    expect(r.synthesized[0]!.reason).toBe("unknown"); // default
    // Reconciled array length = original + 1 inserted tool message
    expect(r.reconciledMessages.length).toBe(msgs.length + 1);
    // The inserted message should be at index 2 (right after the assistant)
    const inserted = r.reconciledMessages[2]!;
    expect(inserted.role).toBe("tool");
    const insertedContent = inserted.content as Record<string, unknown>[];
    expect(insertedContent[0]!.toolCallId).toBe("call_1");
  });

  test("multiple dangling calls in same assistant message → grouped into one tool message", () => {
    const assistantMulti: Record<string, unknown> = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "a", toolName: "x" },
        { type: "tool-call", toolCallId: "b", toolName: "y" },
        { type: "tool-call", toolCallId: "c", toolName: "z" },
      ],
    };
    const r = reconcileToolCalls({
      messages: [userMsg("multi"), assistantMulti],
    });
    expect(r.repairCount).toBe(3);
    // One inserted tool message with 3 result parts
    expect(r.reconciledMessages.length).toBe(3); // user + assistant + 1 tool msg
    const insertedContent = r.reconciledMessages[2]!.content as Record<
      string,
      unknown
    >[];
    expect(insertedContent.length).toBe(3);
  });

  test("dangling calls across multiple assistant messages → one tool message per source", () => {
    const msgs = [
      userMsg("first"),
      assistantWithToolCall("call_1", "t1"),
      userMsg("second"),
      assistantWithToolCall("call_2", "t2"),
    ];
    const r = reconcileToolCalls({ messages: msgs });
    expect(r.repairCount).toBe(2);
    // Original 4 + 2 inserted tool messages
    expect(r.reconciledMessages.length).toBe(6);
    // After assistant call_1 (originally idx 1) → tool msg at idx 2
    expect((r.reconciledMessages[2]!.role as string)).toBe("tool");
    // After assistant call_2 → tool msg at end
    expect((r.reconciledMessages[5]!.role as string)).toBe("tool");
  });

  test("partial result: one call paired, one dangling in same assistant message", () => {
    const assistantMulti: Record<string, unknown> = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "a", toolName: "x" },
        { type: "tool-call", toolCallId: "b", toolName: "y" },
      ],
    };
    const msgs = [
      userMsg("multi"),
      assistantMulti,
      toolResultMsg("a", "x", { ok: true }), // only "a" paired
    ];
    const r = reconcileToolCalls({ messages: msgs });
    expect(r.repairCount).toBe(1);
    expect(r.dangling[0]!.id).toBe("b");
  });

  test("knownInterruptions: reason and partialState propagate", () => {
    const msgs = [userMsg("go"), assistantWithToolCall("call_1", "place_order")];
    const known = new Map<
      string,
      { reason: InterruptionReason; partialState?: Record<string, unknown> }
    >([
      [
        "call_1",
        {
          reason: "force_stop",
          partialState: { side: "BUY", filled: 0, intended: 100 },
        },
      ],
    ]);
    const r = reconcileToolCalls({
      messages: msgs,
      knownInterruptions: known,
    });
    expect(r.synthesized[0]!.reason).toBe("force_stop");
    expect(r.synthesized[0]!.partialState).toEqual({
      side: "BUY",
      filled: 0,
      intended: 100,
    });
    const inserted = r.reconciledMessages[2]!;
    const part = (inserted.content as Record<string, unknown>[])[0]!;
    const result = part.result as Record<string, unknown>;
    expect(result.status).toBe("interrupted");
    expect(result.reason).toBe("force_stop");
    expect(result.partialState).toEqual({
      side: "BUY",
      filled: 0,
      intended: 100,
    });
  });

  test("custom defaultReason applies to unknown calls", () => {
    const msgs = [userMsg("x"), assistantWithToolCall("call_1", "tool")];
    const r = reconcileToolCalls({
      messages: msgs,
      defaultReason: "timeout",
    });
    expect(r.synthesized[0]!.reason).toBe("timeout");
  });

  test("accepts Anthropic-raw shape (tool_use / tool_result with snake_case ids)", () => {
    const msgs: Record<string, unknown>[] = [
      { role: "user", content: "raw" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_01",
            name: "get_weather",
            input: { city: "Tokyo" },
          },
        ],
      },
      // dangling — no tool_result follows
    ];
    const r = reconcileToolCalls({ messages: msgs });
    expect(r.repairCount).toBe(1);
    expect(r.dangling[0]!.id).toBe("toolu_01");
    expect(r.dangling[0]!.toolName).toBe("get_weather");
  });

  test("Anthropic-raw tool_result pairing recognized via tool_use_id", () => {
    const msgs: Record<string, unknown>[] = [
      { role: "user", content: "raw" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_01", name: "x" }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_01",
            content: "ok",
          },
        ],
      },
    ];
    const r = reconcileToolCalls({ messages: msgs });
    expect(r.verdict).toBe("no_dangling_calls");
  });

  test("does not mutate input message array", () => {
    const msgs = [userMsg("x"), assistantWithToolCall("call_1", "tool")];
    const snapshot = JSON.stringify(msgs);
    reconcileToolCalls({ messages: msgs });
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });

  test("string-content assistant messages are skipped (no tool-call parts to find)", () => {
    const msgs = [
      userMsg("hi"),
      assistantTextMsg("hello"),
      userMsg("bye"),
      assistantTextMsg("goodbye"),
    ];
    const r = reconcileToolCalls({ messages: msgs });
    expect(r.verdict).toBe("no_dangling_calls");
  });

  test("missing tool_use id is silently dropped (cannot reconcile without id)", () => {
    const noIdAssistant: Record<string, unknown> = {
      role: "assistant",
      content: [{ type: "tool-call", toolName: "x" }], // no id
    };
    const r = reconcileToolCalls({
      messages: [userMsg("x"), noIdAssistant],
    });
    expect(r.repairCount).toBe(0);
    expect(r.verdict).toBe("no_dangling_calls");
  });

  test("formatReconciliationReport renders verdict, dangling, synthesized", () => {
    const msgs = [
      userMsg("x"),
      assistantWithToolCall("call_1", "place_order"),
      userMsg("y"),
      assistantWithToolCall("call_2", "cancel_order"),
    ];
    const r = reconcileToolCalls({
      messages: msgs,
      knownInterruptions: new Map([
        ["call_1", { reason: "force_stop" as const }],
      ]),
    });
    const text = formatReconciliationReport(r);
    expect(text).toContain("Tool-Call Reconciler");
    expect(text).toContain("call_1");
    expect(text).toContain("call_2");
    expect(text).toContain("force_stop");
    expect(text).toContain("unknown");
  });

  test("repeated tool_use with same id (defensive: first wins, no duplicate dangling)", () => {
    const msgs: Record<string, unknown>[] = [
      userMsg("x"),
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "dup", toolName: "t" },
          { type: "tool-call", toolCallId: "dup", toolName: "t" },
        ],
      },
    ];
    const r = reconcileToolCalls({ messages: msgs });
    // Should only produce one dangling entry for "dup"
    expect(r.dangling.length).toBe(1);
    expect(r.repairCount).toBe(1);
  });
});

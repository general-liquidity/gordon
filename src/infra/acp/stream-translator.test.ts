import { describe, it, expect } from "bun:test";
import { StreamTranslator, classifyToolKind, humanizeToolName } from "./stream-translator.ts";
import type { StreamEvent } from "../agents/orchestrator/types.ts";

// =================== classifyToolKind ===================

describe("classifyToolKind", () => {
  it("classifies fetch-style prefixes", () => {
    expect(classifyToolKind("get_trade_history")).toBe("fetch");
    expect(classifyToolKind("fetch_balance")).toBe("fetch");
    expect(classifyToolKind("list_plans")).toBe("fetch");
    expect(classifyToolKind("show_position")).toBe("fetch");
  });

  it("classifies read prefixes", () => {
    expect(classifyToolKind("read_file")).toBe("read");
    expect(classifyToolKind("load_skill")).toBe("read");
  });

  it("classifies search prefixes", () => {
    expect(classifyToolKind("search_market")).toBe("search");
    expect(classifyToolKind("scan_market")).toBe("search");
    expect(classifyToolKind("find_setup")).toBe("search");
    expect(classifyToolKind("discover_tokens")).toBe("search");
  });

  it("classifies think prefixes", () => {
    expect(classifyToolKind("analyze_pair")).toBe("think");
    expect(classifyToolKind("evaluate_risk")).toBe("think");
    expect(classifyToolKind("classify_setup")).toBe("think");
    expect(classifyToolKind("check_risk")).toBe("think");
    expect(classifyToolKind("explain_strategy")).toBe("think");
  });

  it("classifies edit prefixes", () => {
    expect(classifyToolKind("write_file")).toBe("edit");
    expect(classifyToolKind("update_trailing_stop")).toBe("edit");
    expect(classifyToolKind("set_permission_mode")).toBe("edit");
    expect(classifyToolKind("edit_order")).toBe("edit");
  });

  it("classifies delete prefixes", () => {
    expect(classifyToolKind("cancel_order")).toBe("delete");
    expect(classifyToolKind("close_trade")).toBe("delete");
    expect(classifyToolKind("delete_plan")).toBe("delete");
    expect(classifyToolKind("remove_alert")).toBe("delete");
  });

  it("classifies execute prefixes", () => {
    expect(classifyToolKind("execute_plan")).toBe("execute");
    expect(classifyToolKind("place_market_order")).toBe("execute");
    expect(classifyToolKind("place_limit_order")).toBe("execute");
    expect(classifyToolKind("swap_tokens")).toBe("execute");
    expect(classifyToolKind("buy_btc")).toBe("execute");
    expect(classifyToolKind("sell_position")).toBe("execute");
    expect(classifyToolKind("approve_plan")).toBe("execute");
  });

  it("falls back to other when no prefix matches", () => {
    expect(classifyToolKind("weird_unknown_tool")).toBe("other");
    expect(classifyToolKind("xyz")).toBe("other");
  });

  it("matches case-insensitively", () => {
    expect(classifyToolKind("GET_PRICE")).toBe("fetch");
    expect(classifyToolKind("Place_Market_Order")).toBe("execute");
  });
});

// =================== humanizeToolName ===================

describe("humanizeToolName", () => {
  it("converts snake_case to Sentence case", () => {
    expect(humanizeToolName("get_trade_history")).toBe("Get trade history");
    expect(humanizeToolName("place_market_order")).toBe("Place market order");
    expect(humanizeToolName("check_risk")).toBe("Check risk");
  });

  it("handles single-word names", () => {
    expect(humanizeToolName("scan")).toBe("Scan");
  });

  it("handles empty / edge cases", () => {
    expect(humanizeToolName("")).toBe("");
    expect(humanizeToolName("___")).toBe("___");
  });
});

// =================== StreamTranslator ===================

describe("StreamTranslator — basic events", () => {
  it("text_delta → agent_message_chunk", () => {
    const t = new StreamTranslator();
    const r = t.translate({ type: "text_delta", content: "Hello" });
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0]!.sessionUpdate).toBe("agent_message_chunk");
    expect((r.updates[0]!.content as { text: string }).text).toBe("Hello");
    expect(r.textForHistory).toBe("Hello");
  });

  it("text_delta with empty content → no updates", () => {
    const t = new StreamTranslator();
    const r = t.translate({ type: "text_delta", content: "" });
    expect(r.updates).toHaveLength(0);
  });

  it("thinking_delta → agent_thought_chunk", () => {
    const t = new StreamTranslator();
    const r = t.translate({ type: "thinking_delta", content: "let me think..." });
    expect(r.updates[0]!.sessionUpdate).toBe("agent_thought_chunk");
    expect(r.textForHistory).toBeUndefined();
  });

  it("done → end_turn stop signal", () => {
    const t = new StreamTranslator();
    const r = t.translate({ type: "done" });
    expect(r.stop).toBe("end_turn");
  });

  it("cancelled → cancelled stop signal", () => {
    const t = new StreamTranslator();
    const r = t.translate({ type: "cancelled" });
    expect(r.stop).toBe("cancelled");
  });

  it("error → emit chunk + refusal stop signal", () => {
    const t = new StreamTranslator();
    const r = t.translate({ type: "error", error: "boom" });
    expect(r.stop).toBe("refusal");
    expect((r.updates[0]!.content as { text: string }).text).toContain("boom");
  });

  it("step_complete → silent no-op", () => {
    const t = new StreamTranslator();
    const r = t.translate({ type: "step_complete" });
    expect(r.updates).toHaveLength(0);
    expect(r.stop).toBeUndefined();
  });

  it("agent_switch → informational thought chunk", () => {
    const t = new StreamTranslator();
    const r = t.translate({ type: "agent_switch", agentName: "executor" });
    expect(r.updates[0]!.sessionUpdate).toBe("agent_thought_chunk");
    expect((r.updates[0]!.content as { text: string }).text).toContain("executor");
  });
});

describe("StreamTranslator — tool call lifecycle", () => {
  it("tool_call_start → tool_call with pending status + matched tool_call_end", () => {
    const t = new StreamTranslator();
    const startEvent: StreamEvent = {
      type: "tool_call_start",
      toolName: "get_trade_history",
      toolArgs: { symbol: "BTCUSDT" },
      stepIndex: 0,
    };
    const startR = t.translate(startEvent);
    expect(startR.updates[0]!.sessionUpdate).toBe("tool_call");
    expect(startR.updates[0]!.title).toBe("Get trade history");
    expect(startR.updates[0]!.kind).toBe("fetch");
    expect(startR.updates[0]!.status).toBe("pending");
    expect(startR.updates[0]!.toolCallId).toMatch(/^tc_[0-9a-f]{16}$/);
    const toolCallId = startR.updates[0]!.toolCallId;

    const endEvent: StreamEvent = {
      type: "tool_call_end",
      toolName: "get_trade_history",
      toolResult: { trades: [] },
      stepIndex: 0,
    };
    const endR = t.translate(endEvent);
    expect(endR.updates[0]!.sessionUpdate).toBe("tool_call_update");
    expect(endR.updates[0]!.toolCallId).toBe(toolCallId);
    expect(endR.updates[0]!.status).toBe("completed");
    expect(endR.updates[0]!.rawOutput).toEqual({ trades: [] });
  });

  it("tool_call_end with error → failed status", () => {
    const t = new StreamTranslator();
    t.translate({ type: "tool_call_start", toolName: "place_market_order", stepIndex: 0 });
    const endR = t.translate({
      type: "tool_call_end",
      toolName: "place_market_order",
      error: "insufficient balance",
      stepIndex: 0,
    });
    expect(endR.updates[0]!.status).toBe("failed");
  });

  it("untracked tool_call_end synthesizes a fresh tool_call as completed", () => {
    const t = new StreamTranslator();
    const r = t.translate({
      type: "tool_call_end",
      toolName: "get_price",
      toolResult: 50000,
      stepIndex: 0,
    });
    expect(r.updates[0]!.sessionUpdate).toBe("tool_call");
    expect(r.updates[0]!.status).toBe("completed");
    expect(r.updates[0]!.toolCallId).toMatch(/^tc_[0-9a-f]{16}$/);
  });

  it("matches start↔end across multiple concurrent tool calls", () => {
    const t = new StreamTranslator();
    const startA = t.translate({ type: "tool_call_start", toolName: "get_price", stepIndex: 0 });
    const startB = t.translate({ type: "tool_call_start", toolName: "get_price", stepIndex: 1 });
    const endB = t.translate({ type: "tool_call_end", toolName: "get_price", stepIndex: 1 });
    const endA = t.translate({ type: "tool_call_end", toolName: "get_price", stepIndex: 0 });
    expect(endB.updates[0]!.toolCallId).toBe(startB.updates[0]!.toolCallId);
    expect(endA.updates[0]!.toolCallId).toBe(startA.updates[0]!.toolCallId);
    expect(startA.updates[0]!.toolCallId).not.toBe(startB.updates[0]!.toolCallId);
  });
});

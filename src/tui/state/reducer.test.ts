import { describe, expect, it } from "bun:test";
import { appReducer } from "./reducer.ts";
import { INITIAL_STATE, type AppState } from "./types.ts";

function state(overrides: Partial<AppState> = {}): AppState {
  return { ...INITIAL_STATE, ...overrides };
}

describe("appReducer", () => {
  it("blocks permission escalation while streaming", () => {
    const next = appReducer(state({ permissionMode: "strict", isStreaming: true }), {
      type: "SET_PERMISSION_MODE",
      mode: "auto",
    });
    expect(next.permissionMode).toBe("strict");
    expect(next.messages.at(-1)?.content).toContain("streaming");
  });

  it("allows permission de-escalation while approvals are pending", () => {
    const next = appReducer(
      state({
        permissionMode: "auto",
        pendingApprovals: [{ id: "approval-1" } as never],
      }),
      { type: "SET_PERMISSION_MODE", mode: "strict" },
    );
    expect(next.permissionMode).toBe("strict");
  });

  it("shows a mode banner on paper/live boundary crossings", () => {
    const next = appReducer(state({ permissionMode: "paper" }), {
      type: "SET_PERMISSION_MODE",
      mode: "ask",
    });
    expect(next.permissionMode).toBe("ask");
    expect(next.modeBanner?.mode).toBe("ask");
    expect(next.modeBanner?.liveCapable).toBe(true);
  });

  it("tracks active thinking and clears it on stop", () => {
    const thinking = appReducer(state(), { type: "SET_ACTIVE_THINKING", thinking: "reasoning" });
    expect(thinking.activeThinking).toBe("reasoning");
    const stopped = appReducer(thinking, { type: "STOP_STREAMING" });
    expect(stopped.activeThinking).toBe("");
  });

  it("updates a streaming message and stream buffer atomically", () => {
    const base = state({
      streamBuffer: "",
      messages: [{ id: "streaming-1", role: "gordon", content: "", timestamp: "t", streaming: true }],
    });
    const next = appReducer(base, {
      type: "UPDATE_STREAMING_MESSAGE",
      id: "streaming-1",
      content: "hello",
      streamBuffer: "hello",
    });
    expect(next.messages[0]?.content).toBe("hello");
    expect(next.streamBuffer).toBe("hello");
  });

  it("returns same reference when streaming message id is absent", () => {
    const base = state();
    expect(appReducer(base, {
      type: "UPDATE_STREAMING_MESSAGE",
      id: "missing",
      content: "x",
      streamBuffer: "x",
    })).toBe(base);
  });

  it("sets and clears active tool calls", () => {
    const call = { id: "tc-1", toolName: "get_price", status: "running" as const, startedAt: 1 };
    const next = appReducer(state(), { type: "SET_ACTIVE_TOOL_CALLS", calls: [call] });
    expect(next.activeToolCalls).toEqual([call]);
    expect(appReducer(next, { type: "RESET_STREAM_STATE" }).activeToolCalls).toEqual([]);
  });

  it("resets session-visible state", () => {
    const next = appReducer(
      state({
        messages: [{ id: "m", role: "user", content: "hi", timestamp: "t" }],
        pendingApprovals: [{ id: "approval-1" } as never],
        streamBuffer: "x",
        isStreaming: true,
        showResetConfirm: true,
      }),
      { type: "RESET_SESSION" },
    );
    expect(next.messages).toEqual([]);
    expect(next.pendingApprovals).toEqual([]);
    expect(next.isStreaming).toBe(false);
    expect(next.showResetConfirm).toBe(false);
  });

  it("opens overlay views and closes the palette", () => {
    const next = appReducer(state({ showPalette: true }), { type: "OPEN_OVERLAY_VIEW", view: "tradeQueue" });
    expect(next.activeOverlayView).toBe("tradeQueue");
    expect(next.showPalette).toBe(false);
  });

  it("sets radar focus and clears it when streaming starts", () => {
    const focused = appReducer(state(), {
      type: "SET_RADAR_FOCUS",
      focus: { id: "s1", category: "volatility", title: "BTC" },
    });
    expect(focused.radarFocus?.id).toBe("s1");
    expect(appReducer(focused, { type: "START_STREAMING" }).radarFocus).toBeNull();
  });
});

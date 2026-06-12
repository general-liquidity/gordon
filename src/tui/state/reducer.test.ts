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
    // Fully-populated state: every field in the RESET_SESSION contract is non-default.
    const next = appReducer(
      state({
        messages: [{ id: "m", role: "user", content: "hi", timestamp: "t" }],
        completedMessageCount: 3,
        streamBuffer: "x",
        isStreaming: true,
        activeThinking: "thinking...",
        activeToolCalls: [{ id: "tc-1", toolName: "get_price", status: "running", startedAt: 1 } as never],
        activeAgents: [{ id: "chain-1" } as never],
        handoffHistory: [{ from: "gordon", to: "executor", timestamp: 1 } as never],
        pendingApprovals: [{ id: "approval-1" } as never],
        notifications: [{ id: "n1", type: "trade:opened", variant: "fill", message: "filled", timestamp: "t" }],
        backgroundTasks: [{ id: "bt-1", label: "scan", status: "running" }],
        contextTokens: 1234,
        lastTurnDurationMs: 8200,
        lastTurnTokens: 567,
        ctrlCPressed: true,
        showPalette: true,
        showHelp: true,
        showResetConfirm: true,
        pager: { title: "p", content: "c" },
        radarFocus: { id: "r1", category: "volatility", title: "BTC" },
        openDialogs: [{ id: "settings" }],
        // Survivors — must NOT be reset.
        permissionMode: "paper",
        sessionId: "sess-1",
        threadId: "thread-1",
        isResumedSession: true,
        tokenCount: 9999,
        cost: 1.23,
        runtimeReady: true,
        bootPhase: "ready",
        swarmMode: true,
        autonomousActive: true,
        autonomousStrategyCount: 2,
        privacyMode: true,
        activeWorkspace: "trading",
        showSetup: true,
      }),
      { type: "RESET_SESSION" },
    );

    // Reset to []
    expect(next.messages).toEqual([]);
    expect(next.activeAgents).toEqual([]);
    expect(next.handoffHistory).toEqual([]);
    expect(next.pendingApprovals).toEqual([]);
    expect(next.notifications).toEqual([]);
    expect(next.backgroundTasks).toEqual([]);
    expect(next.activeToolCalls).toEqual([]);
    expect(next.openDialogs).toEqual([]);
    // Reset to ""
    expect(next.streamBuffer).toBe("");
    expect(next.activeThinking).toBe("");
    // Reset to false
    expect(next.isStreaming).toBe(false);
    expect(next.ctrlCPressed).toBe(false);
    expect(next.showPalette).toBe(false);
    expect(next.showHelp).toBe(false);
    expect(next.showResetConfirm).toBe(false);
    // Reset to 0
    expect(next.completedMessageCount).toBe(0);
    expect(next.contextTokens).toBe(0);
    expect(next.lastTurnDurationMs).toBe(0);
    expect(next.lastTurnTokens).toBe(0);
    // Reset to null
    expect(next.pager).toBeNull();
    expect(next.radarFocus).toBeNull();

    // Preserved
    expect(next.permissionMode).toBe("paper");
    expect(next.sessionId).toBe("sess-1");
    expect(next.threadId).toBe("thread-1");
    expect(next.isResumedSession).toBe(true);
    expect(next.tokenCount).toBe(9999);
    expect(next.cost).toBe(1.23);
    expect(next.runtimeReady).toBe(true);
    expect(next.bootPhase).toBe("ready");
    expect(next.swarmMode).toBe(true);
    expect(next.autonomousActive).toBe(true);
    expect(next.autonomousStrategyCount).toBe(2);
    expect(next.privacyMode).toBe(true);
    expect(next.activeWorkspace).toBe("trading");
    expect(next.showSetup).toBe(true);
  });

  it("maintains a dialog stack", () => {
    const settings = appReducer(state(), { type: "OPEN_DIALOG", id: "settings" });
    const theme = appReducer(settings, { type: "OPEN_DIALOG", id: "themePicker", payload: { source: "settings" } });
    expect(theme.openDialogs.map((dialog) => dialog.id)).toEqual(["settings", "themePicker"]);
    expect(theme.openDialogs[1]?.payload).toEqual({ source: "settings" });

    const reopened = appReducer(theme, { type: "OPEN_DIALOG", id: "settings", payload: { tab: "general" } });
    expect(reopened.openDialogs.map((dialog) => dialog.id)).toEqual(["themePicker", "settings"]);
    expect(reopened.openDialogs[1]?.payload).toEqual({ tab: "general" });

    const closedTop = appReducer(reopened, { type: "CLOSE_TOP_DIALOG" });
    expect(closedTop.openDialogs.map((dialog) => dialog.id)).toEqual(["themePicker"]);
    const closed = appReducer(closedTop, { type: "CLOSE_DIALOG", id: "themePicker" });
    expect(closed.openDialogs).toEqual([]);
    expect(appReducer(closed, { type: "CLOSE_DIALOG", id: "themePicker" })).toBe(closed);
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

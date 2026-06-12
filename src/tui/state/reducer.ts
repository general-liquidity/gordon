/**
 * TUI State Reducer
 * Pure reducer function handling every Action type.
 * Phase 2 of the 100% parity plan.
 */

import type { AppState, Action } from "./types.js";
import { appendNotificationCapped } from "./notificationRetention.ts";
import { evaluatePermissionModeTransition, isLiveCapable } from "./permissionModeFsm.ts";
import type { Message } from "../components/messages/MessageBubble.tsx";

function systemMessage(content: string, variant: Message["variant"] = "system"): Message {
  return {
    id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: "system",
    variant,
    content,
    timestamp: new Date().toISOString(),
  };
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_BOOT_PHASE":
      return { ...state, bootPhase: action.phase };

    case "SET_RUNTIME_READY":
      return { ...state, runtimeReady: action.ready };

    case "SET_PERMISSION_MODE": {
      if (state.permissionMode === action.mode) return state;
      const transition = evaluatePermissionModeTransition({
        from: state.permissionMode,
        to: action.mode,
        pendingApprovals: state.pendingApprovals.length,
        isStreaming: state.isStreaming,
      });
      if (!transition.allowed) {
        return {
          ...state,
          messages: [
            ...state.messages,
            systemMessage(transition.reason ?? `Cannot switch permission mode to ${action.mode}.`),
          ],
        };
      }
      const crossesLiveBoundary =
        isLiveCapable(state.permissionMode) !== isLiveCapable(action.mode) ||
        state.permissionMode === "paper" ||
        action.mode === "paper";
      return {
        ...state,
        permissionMode: action.mode,
        modeBanner: crossesLiveBoundary
          ? {
              mode: action.mode,
              liveCapable: isLiveCapable(action.mode),
              shownAt: Date.now(),
              dismissed: false,
            }
          : state.modeBanner,
      };
    }

    case "ADD_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, action.message],
      };

    case "SET_MESSAGES":
      return { ...state, messages: action.messages };

    case "SET_COMPLETED_MESSAGE_COUNT":
      return { ...state, completedMessageCount: action.count };

    case "START_STREAMING":
      return {
        ...state,
        isStreaming: true,
        streamBuffer: "",
        activeThinking: "",
        activeToolCalls: [],
        activeAgents: [],
        handoffHistory: state.handoffHistory,
        radarFocus: null,
      };

    case "STOP_STREAMING":
      return {
        ...state,
        isStreaming: false,
        streamBuffer: "",
        activeThinking: "",
        activeToolCalls: [],
        activeAgents: [],
      };

    case "SET_STREAM_BUFFER":
      return { ...state, streamBuffer: action.buffer };

    case "SET_ACTIVE_THINKING":
      return state.activeThinking === action.thinking ? state : { ...state, activeThinking: action.thinking };

    case "SET_ACTIVE_TOOL_CALLS":
      return state.activeToolCalls === action.calls ? state : { ...state, activeToolCalls: action.calls };

    case "UPDATE_STREAMING_MESSAGE": {
      const index = state.messages.findIndex((message) => message.id === action.id);
      if (index === -1) return state;
      const current = state.messages[index]!;
      if (current.content === action.content && state.streamBuffer === action.streamBuffer) {
        return state;
      }
      const messages = [...state.messages];
      messages[index] = { ...current, content: action.content };
      return { ...state, messages, streamBuffer: action.streamBuffer };
    }

    case "SET_ACTIVE_AGENTS":
      return { ...state, activeAgents: action.agents };

    case "ADD_AGENT_CHAIN":
      return {
        ...state,
        activeAgents: [...state.activeAgents, action.chain],
      };

    case "COMPLETE_AGENT_CHAINS":
      return {
        ...state,
        activeAgents: state.activeAgents.map((chain) =>
          chain.status === "running"
            ? { ...chain, status: "done" as const, duration: Date.now() - chain.startedAt }
            : chain
        ),
      };

    case "SET_HANDOFF_HISTORY":
      return { ...state, handoffHistory: action.history };

    case "ADD_HANDOFF":
      return {
        ...state,
        handoffHistory: [...state.handoffHistory, action.handoff],
      };

    case "SET_PENDING_APPROVALS":
      return { ...state, pendingApprovals: action.approvals };

    case "SET_SESSION":
      return {
        ...state,
        sessionId: action.sessionId,
        threadId: action.threadId,
      };

    case "SET_RESUMED_SESSION":
      return { ...state, isResumedSession: action.isResumed };

    case "ADD_TOKENS":
      return { ...state, tokenCount: state.tokenCount + action.tokens };

    case "SET_COST":
      return { ...state, cost: action.cost };

    case "SET_BACKGROUND_TASKS":
      return { ...state, backgroundTasks: action.tasks };

    case "TOGGLE_PALETTE":
      return {
        ...state,
        showPalette: !state.showPalette,
        showHelp: false,
      };

    case "SET_SHOW_PALETTE":
      return { ...state, showPalette: action.show };

    case "SET_SHOW_SETUP":
      return { ...state, showSetup: action.show };

    case "SET_SHOW_FIRST_TRADE_TOUR":
      return { ...state, showFirstTradeTour: action.show };

    case "SET_SHOW_HELP":
      return { ...state, showHelp: action.show };

    case "SET_SHOW_RESET_CONFIRM":
      return { ...state, showResetConfirm: action.show };

    case "SET_CTRL_C_PRESSED":
      return { ...state, ctrlCPressed: action.pressed };

    case "SET_SWARM_MODE":
      return { ...state, swarmMode: action.enabled };

    case "SET_ACTIVE_WORKSPACE":
      return { ...state, activeWorkspace: action.workspace };

    case "RESET_STREAM_STATE":
      return {
        ...state,
        isStreaming: false,
        streamBuffer: "",
        activeThinking: "",
        activeToolCalls: [],
        activeAgents: [],
        handoffHistory: [],
      };

    case "RESET_SESSION":
      return {
        ...state,
        messages: [],
        completedMessageCount: 0,
        streamBuffer: "",
        isStreaming: false,
        activeThinking: "",
        activeToolCalls: [],
        activeAgents: [],
        handoffHistory: [],
        pendingApprovals: [],
        notifications: [],
        backgroundTasks: [],
        contextTokens: 0,
        lastTurnDurationMs: 0,
        lastTurnTokens: 0,
        ctrlCPressed: false,
        showPalette: false,
        showResetConfirm: false,
        showHelp: false,
        pager: null,
        radarFocus: null,
        openDialogs: [],
      };

    case "SHOW_MODE_BANNER":
      return { ...state, modeBanner: action.banner };

    case "DISMISS_MODE_BANNER":
      return state.modeBanner ? { ...state, modeBanner: { ...state.modeBanner, dismissed: true } } : state;

    case "SET_KILL_SWITCH_STATUS":
      return state.killSwitches?.signature === action.status.signature
        ? state
        : { ...state, killSwitches: action.status };

    case "OPEN_OVERLAY_VIEW":
      return { ...state, activeOverlayView: action.view, showPalette: false };

    case "CLOSE_OVERLAY_VIEW":
      return state.activeOverlayView === null ? state : { ...state, activeOverlayView: null };

    case "OPEN_PAGER":
      return { ...state, pager: action.pager, showPalette: false };

    case "CLOSE_PAGER":
      return state.pager === null ? state : { ...state, pager: null };

    case "SET_RADAR_FOCUS":
      return state.radarFocus === action.focus ? state : { ...state, radarFocus: action.focus };

    case "OPEN_DIALOG": {
      const next = state.openDialogs.filter((dialog) => dialog.id !== action.id);
      next.push({ id: action.id, payload: action.payload });
      return { ...state, openDialogs: next };
    }

    case "CLOSE_DIALOG": {
      const next = state.openDialogs.filter((dialog) => dialog.id !== action.id);
      return next.length === state.openDialogs.length ? state : { ...state, openDialogs: next };
    }

    case "CLOSE_TOP_DIALOG":
      return state.openDialogs.length === 0
        ? state
        : { ...state, openDialogs: state.openDialogs.slice(0, -1) };

    // Phase 4 — Event-driven notifications
    case "INJECT_NOTIFICATION":
      return {
        ...state,
        notifications: appendNotificationCapped(state.notifications, action.notification),
      };

    case "DISMISS_NOTIFICATION":
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, dismissed: true } : n
        ),
      };

    case "CLEAR_NOTIFICATIONS":
      return { ...state, notifications: [] };

    case "AGENT_SWITCH":
      return {
        ...state,
        handoffHistory: [
          ...state.handoffHistory,
          { from: action.from, to: action.to, timestamp: Date.now() },
        ],
      };

    case "UPDATE_COST":
      return {
        ...state,
        cost: state.cost + action.pnl,
      };

    // Phase 6 — Autonomous loop
    case "SET_AUTONOMOUS_ACTIVE":
      return {
        ...state,
        autonomousActive: action.active,
        autonomousStrategyCount: action.strategyCount ?? (action.active ? 1 : 0),
      };

    case "SET_PRIVACY_MODE":
      return { ...state, privacyMode: action.enabled };

    default: {
      // Exhaustive check — if we get here, we missed a case
      const _exhaustive: never = action;
      return state;
    }
  }
}

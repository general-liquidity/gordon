/**
 * TUI State Reducer
 * Pure reducer function handling every Action type.
 * Phase 2 of the 100% parity plan.
 */

import type { AppState, Action } from "./types.js";
import { appendNotificationCapped } from "./notificationRetention.ts";

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_BOOT_PHASE":
      return { ...state, bootPhase: action.phase };

    case "SET_RUNTIME_READY":
      return { ...state, runtimeReady: action.ready };

    case "SET_PERMISSION_MODE":
      return { ...state, permissionMode: action.mode };

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
        activeAgents: [],
        handoffHistory: state.handoffHistory,
      };

    case "STOP_STREAMING":
      return {
        ...state,
        isStreaming: false,
        streamBuffer: "",
        activeAgents: [],
      };

    case "SET_STREAM_BUFFER":
      return { ...state, streamBuffer: action.buffer };

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

    case "SET_SHOW_HELP":
      return { ...state, showHelp: action.show };

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
        activeAgents: [],
        handoffHistory: [],
      };

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

    // Phase 15-18 — Panel toggles
    case "SET_SHOW_SETTINGS":
      return { ...state, showSettings: action.show };

    case "SET_SHOW_EXPORT":
      return { ...state, showExport: action.show };

    case "SET_SHOW_EMERGENCY":
      return { ...state, showEmergency: action.show };

    case "SET_SHOW_CONTEXT":
      return { ...state, showContext: action.show };

    case "SET_SHOW_SESSIONS":
      return { ...state, showSessions: action.show };

    case "SET_SHOW_MEMORY":
      return { ...state, showMemory: action.show };

    case "SET_PRIVACY_MODE":
      return { ...state, privacyMode: action.enabled };

    default: {
      // Exhaustive check — if we get here, we missed a case
      const _exhaustive: never = action;
      return state;
    }
  }
}

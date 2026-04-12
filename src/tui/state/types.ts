/**
 * TUI State Types
 * Central type definitions for the Gordon TUI application state.
 * Phase 2 of the 100% parity plan.
 */

import type { Message } from "../components/MessageBubble.js";
import type { AgentChain, HandoffEvent } from "../components/AgentProgress.js";
import type { ApprovalRequest } from "../components/ApprovalDialog.js";

// ============================================================================
// Notification (Phase 4 — event-driven updates)
// ============================================================================

export type NotificationVariant =
  | "fill"       // trade fills, approvals
  | "alert"      // price alerts, position changes, risk rejections
  | "strategy"   // autonomous loop, opportunities
  | "info"       // plan created, general info
  | "error"      // system errors
  | "system";    // agent fallbacks, internal

export interface TuiNotification {
  id: string;
  type: string;           // e.g. "trade:opened", "system:error"
  variant: NotificationVariant;
  message: string;
  timestamp: string;
  dismissed?: boolean;
}

// ============================================================================
// Permission & Boot
// ============================================================================

export type PermissionMode =
  | "auto"        // Trades execute without per-action approval (only constitution + rules block)
  | "ask"         // Each trade requires explicit user approval via ApprovalDialog
  | "strict"      // Read-only mode; all trades blocked, analysis-only
  | "paper"       // Paper trading only — real orders blocked, simulated fills allowed
  | "observe"     // Pure observation — no execution of any kind, even paper trades
  | "plan"        // Preview/planning only — can create plans but not execute them;

export type BootPhase = "boot" | "ready";

// ============================================================================
// Background Task
// ============================================================================

export interface BackgroundTask {
  id: string;
  label: string;
  status: string;
}

// ============================================================================
// AppState
// ============================================================================

export interface AppState {
  // Permission
  permissionMode: PermissionMode;

  // Messages
  messages: Message[];
  completedMessageCount: number;

  // Streaming
  streamBuffer: string;
  isStreaming: boolean;
  activeThinking: string;

  // Agents
  activeAgents: AgentChain[];
  swarmMode: boolean;
  handoffHistory: HandoffEvent[];

  // Approvals
  pendingApprovals: ApprovalRequest[];

  // Session
  sessionId: string | null;
  threadId: string | null;
  isResumedSession: boolean;

  // Cost / tokens
  tokenCount: number;
  cost: number;

  // Background
  backgroundTasks: BackgroundTask[];

  // Notifications (Phase 4 — event-driven)
  notifications: TuiNotification[];

  // Autonomous loop (Phase 6)
  autonomousActive: boolean;
  autonomousStrategyCount: number;

  // UI
  ctrlCPressed: boolean;
  showPalette: boolean;
  showSetup: boolean;
  showHelp: boolean;
  runtimeReady: boolean;
  bootPhase: BootPhase;

  // Phase 15-18 panels
  showSettings: boolean;
  showExport: boolean;
  showEmergency: boolean;
  showContext: boolean;
  showSessions: boolean;
  showMemory: boolean;
  privacyMode: boolean;

  // Workspace (legacy lens system)
  activeWorkspace: string | null;
}

export const INITIAL_STATE: AppState = {
  permissionMode: "ask",
  messages: [],
  completedMessageCount: 0,
  streamBuffer: "",
  isStreaming: false,
  activeThinking: "",
  activeAgents: [],
  swarmMode: false,
  handoffHistory: [],
  pendingApprovals: [],
  sessionId: null,
  threadId: null,
  isResumedSession: false,
  tokenCount: 0,
  cost: 0,
  backgroundTasks: [],
  notifications: [],
  autonomousActive: false,
  autonomousStrategyCount: 0,
  ctrlCPressed: false,
  showPalette: false,
  showSetup: false,
  showHelp: false,
  runtimeReady: false,
  bootPhase: "boot",
  showSettings: false,
  showExport: false,
  showEmergency: false,
  showContext: false,
  showSessions: false,
  showMemory: false,
  privacyMode: false,
  activeWorkspace: null,
};

// ============================================================================
// Action Types (22 variants)
// ============================================================================

export type Action =
  | { type: "SET_BOOT_PHASE"; phase: BootPhase }
  | { type: "SET_RUNTIME_READY"; ready: boolean }
  | { type: "SET_PERMISSION_MODE"; mode: PermissionMode }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "SET_COMPLETED_MESSAGE_COUNT"; count: number }
  | { type: "START_STREAMING" }
  | { type: "STOP_STREAMING" }
  | { type: "SET_STREAM_BUFFER"; buffer: string }
  | { type: "SET_ACTIVE_AGENTS"; agents: AgentChain[] }
  | { type: "ADD_AGENT_CHAIN"; chain: AgentChain }
  | { type: "COMPLETE_AGENT_CHAINS" }
  | { type: "SET_HANDOFF_HISTORY"; history: HandoffEvent[] }
  | { type: "ADD_HANDOFF"; handoff: HandoffEvent }
  | { type: "SET_PENDING_APPROVALS"; approvals: ApprovalRequest[] }
  | { type: "SET_SESSION"; sessionId: string | null; threadId: string | null }
  | { type: "SET_RESUMED_SESSION"; isResumed: boolean }
  | { type: "ADD_TOKENS"; tokens: number }
  | { type: "SET_COST"; cost: number }
  | { type: "SET_BACKGROUND_TASKS"; tasks: BackgroundTask[] }
  | { type: "TOGGLE_PALETTE" }
  | { type: "SET_SHOW_PALETTE"; show: boolean }
  | { type: "SET_SHOW_SETUP"; show: boolean }
  | { type: "SET_SHOW_HELP"; show: boolean }
  | { type: "SET_CTRL_C_PRESSED"; pressed: boolean }
  | { type: "SET_SWARM_MODE"; enabled: boolean }
  | { type: "SET_ACTIVE_WORKSPACE"; workspace: string | null }
  | { type: "RESET_STREAM_STATE" }
  // Phase 4 — Event-driven notifications
  | { type: "INJECT_NOTIFICATION"; notification: TuiNotification }
  | { type: "DISMISS_NOTIFICATION"; id: string }
  | { type: "CLEAR_NOTIFICATIONS" }
  | { type: "AGENT_SWITCH"; from: string; to: string }
  | { type: "UPDATE_COST"; pnl: number; pnlPercent: number }
  // Phase 6 — Autonomous loop
  | { type: "SET_AUTONOMOUS_ACTIVE"; active: boolean; strategyCount?: number }
  // Phase 15-18 — Panel toggles
  | { type: "SET_SHOW_SETTINGS"; show: boolean }
  | { type: "SET_SHOW_EXPORT"; show: boolean }
  | { type: "SET_SHOW_EMERGENCY"; show: boolean }
  | { type: "SET_SHOW_CONTEXT"; show: boolean }
  | { type: "SET_SHOW_SESSIONS"; show: boolean }
  | { type: "SET_SHOW_MEMORY"; show: boolean }
  | { type: "SET_PRIVACY_MODE"; enabled: boolean };

// ============================================================================
// Dispatch
// ============================================================================

export type Dispatch = (action: Action) => void;

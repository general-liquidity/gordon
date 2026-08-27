/**
 * TUI State Types
 * Central type definitions for the Gordon TUI application state.
 * Phase 2 of the 100% parity plan.
 */

import type { Message } from "../components/messages/MessageBubble.tsx";
import type { AgentChain, HandoffEvent } from "../components/status/AgentProgress.tsx";
import type { ApprovalRequest } from "../components/dialogs/ApprovalDialog.tsx";
import type { ToolCallState } from "../components/status/ToolCallInline.tsx";
import type { KillSwitchStatus } from "./killSwitchStatus.ts";

// ============================================================================
// Notification (Phase 4 — event-driven updates)
// ============================================================================

export type NotificationVariant =
  | "fill" // trade fills, approvals
  | "alert" // price alerts, position changes, risk rejections
  | "strategy" // autonomous loop, opportunities
  | "info" // plan created, general info
  | "error" // system errors
  | "system"; // agent fallbacks, internal

export interface TuiNotification {
  id: string;
  type: string; // e.g. "trade:opened", "system:error"
  variant: NotificationVariant;
  message: string;
  timestamp: string;
  dismissed?: boolean;
}

// ============================================================================
// Permission & Boot
// ============================================================================

export type PermissionMode =
  | "auto" // Trades execute without per-action approval (only constitution + rules block)
  | "ask" // Each trade requires explicit user approval via ApprovalDialog
  | "strict" // Read-only mode; all trades blocked, analysis-only
  | "paper" // Paper trading only — real orders blocked, simulated fills allowed
  | "observe" // Pure observation — no execution of any kind, even paper trades
  | "plan"; // Preview/planning only — can create plans but not execute them;

export type BootPhase = "boot" | "ready";

export interface ModeBannerState {
  mode: PermissionMode;
  liveCapable: boolean;
  shownAt: number;
  dismissed: boolean;
}

// ============================================================================
// Background Task
// ============================================================================

export interface BackgroundTask {
  id: string;
  label: string;
  status: string;
}

export interface RadarFocus {
  id: string;
  category: string;
  title: string;
}

export type OverlayViewId = "tradeQueue" | "safety";

export interface PagerContent {
  title: string;
  content: string;
}

export type DialogId =
  | "settings"
  | "export"
  | "emergency"
  | "context"
  | "sessions"
  | "memory"
  | "feedback"
  | "audit"
  | "scheduler"
  | "playbooks"
  | "strategies"
  | "genome"
  | "indicators"
  | "consensus"
  | "orderbook"
  | "autonomous"
  | "skills"
  | "constitution"
  | "injectionDefense"
  | "dataHealth"
  | "riskConfig"
  | "defi"
  | "marketOverview"
  | "regime"
  | "stats"
  | "globalSearch"
  | "exitFlow"
  | "backtestWizard"
  | "brokerManager"
  | "exchangeManager"
  | "genomeEvolution"
  | "historySearch"
  | "indicatorValue"
  | "insights"
  | "marketPulse"
  | "messageSelector"
  | "optimization"
  | "planEditor"
  | "plugins"
  | "quickOpen"
  | "reconciliation"
  | "taskDeps"
  | "walkForward"
  | "hip3"
  | "modelPicker"
  | "mcpManager"
  | "marketplace"
  | "cliBrowser"
  | "themePicker"
  | "exchangePicker"
  | "brokerPicker"
  | "doctor"
  | "helpBrowser"
  | "configEditor"
  | "threadBrowser"
  | "journal"
  | "shortcuts"
  | "approvalBrowser"
  | "labs"
  | "planDiff"
  | "postTradeFeedback"
  | "counterfactual"
  | "debateView"
  | "elicitation";

export interface OpenDialog {
  id: DialogId;
  payload?: unknown;
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
  activeToolCalls: ToolCallState[];

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
  /** Cumulative session tokens (sum of completion + prompt across all turns).
   *  Used for /cost-style accounting, NOT for the percentage display. */
  tokenCount: number;
  /** Tokens currently sitting in the context window — input + cache_read +
   *  cache_creation from the most recent API call. This is the figure
   *  Claude Code shows in its status line: it represents 'how full is the
   *  context right now', not 'how much have we spent total'. */
  contextTokens: number;
  /** Wall-clock duration of the most recent turn, in milliseconds. */
  lastTurnDurationMs: number;
  /** Tokens emitted by the most recent turn (output + tool deltas). */
  lastTurnTokens: number;
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
  showFirstTradeTour: boolean;
  showHelp: boolean;
  showResetConfirm: boolean;
  runtimeReady: boolean;
  bootPhase: BootPhase;
  modeBanner: ModeBannerState | null;
  killSwitches: KillSwitchStatus | null;
  activeOverlayView: OverlayViewId | null;
  pager: PagerContent | null;
  radarFocus: RadarFocus | null;
  openDialogs: OpenDialog[];

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
  activeToolCalls: [],
  activeAgents: [],
  swarmMode: false,
  handoffHistory: [],
  pendingApprovals: [],
  sessionId: null,
  threadId: null,
  isResumedSession: false,
  tokenCount: 0,
  contextTokens: 0,
  lastTurnDurationMs: 0,
  lastTurnTokens: 0,
  cost: 0,
  backgroundTasks: [],
  notifications: [],
  autonomousActive: false,
  autonomousStrategyCount: 0,
  ctrlCPressed: false,
  showPalette: false,
  showSetup: false,
  showFirstTradeTour: false,
  showHelp: false,
  showResetConfirm: false,
  runtimeReady: false,
  bootPhase: "boot",
  modeBanner: null,
  killSwitches: null,
  activeOverlayView: null,
  pager: null,
  radarFocus: null,
  openDialogs: [],
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
  | { type: "SET_ACTIVE_THINKING"; thinking: string }
  | { type: "SET_ACTIVE_TOOL_CALLS"; calls: ToolCallState[] }
  | { type: "UPDATE_STREAMING_MESSAGE"; id: string; content: string; streamBuffer: string }
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
  | { type: "SET_SHOW_FIRST_TRADE_TOUR"; show: boolean }
  | { type: "SET_SHOW_HELP"; show: boolean }
  | { type: "SET_SHOW_RESET_CONFIRM"; show: boolean }
  | { type: "SET_CTRL_C_PRESSED"; pressed: boolean }
  | { type: "SET_SWARM_MODE"; enabled: boolean }
  | { type: "SET_ACTIVE_WORKSPACE"; workspace: string | null }
  | { type: "RESET_STREAM_STATE" }
  | { type: "RESET_SESSION" }
  | { type: "SHOW_MODE_BANNER"; banner: ModeBannerState }
  | { type: "DISMISS_MODE_BANNER" }
  | { type: "SET_KILL_SWITCH_STATUS"; status: KillSwitchStatus }
  | { type: "OPEN_OVERLAY_VIEW"; view: OverlayViewId }
  | { type: "CLOSE_OVERLAY_VIEW" }
  | { type: "OPEN_PAGER"; pager: PagerContent }
  | { type: "CLOSE_PAGER" }
  | { type: "SET_RADAR_FOCUS"; focus: RadarFocus | null }
  | { type: "OPEN_DIALOG"; id: DialogId; payload?: unknown }
  | { type: "CLOSE_DIALOG"; id: DialogId }
  | { type: "CLOSE_TOP_DIALOG" }
  // Phase 4 — Event-driven notifications
  | { type: "INJECT_NOTIFICATION"; notification: TuiNotification }
  | { type: "DISMISS_NOTIFICATION"; id: string }
  | { type: "CLEAR_NOTIFICATIONS" }
  | { type: "AGENT_SWITCH"; from: string; to: string }
  | { type: "UPDATE_COST"; pnl: number; pnlPercent: number }
  // Phase 6 — Autonomous loop
  | { type: "SET_AUTONOMOUS_ACTIVE"; active: boolean; strategyCount?: number }
  | { type: "SET_PRIVACY_MODE"; enabled: boolean };

// ============================================================================
// Dispatch
// ============================================================================

export type Dispatch = (action: Action) => void;

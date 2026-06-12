/**
 * Memoized Selectors — 20+ selectors for AppState slices
 *
 * Each selector is a pure function `(state: AppState) => T`.
 * When used with `useAppState(selector)`, the `Object.is` comparison
 * in the provider prevents re-renders when the selected value is unchanged.
 *
 * For derived/computed values, we use a simple memo cache keyed on the
 * input slice reference. This avoids recomputing on every render while
 * keeping selectors composable.
 *
 * Phase 2 of the 100% parity plan.
 */

import type {
  AppState,
  PermissionMode,
  BootPhase,
  BackgroundTask,
  TuiNotification,
  ModeBannerState,
  OverlayViewId,
  PagerContent,
  RadarFocus,
  DialogId,
  OpenDialog,
} from "./types.js";
import type { Message } from "../components/messages/MessageBubble.tsx";
import type { AgentChain, HandoffEvent } from "../components/status/AgentProgress.tsx";
import type { ApprovalRequest } from "../components/dialogs/ApprovalDialog.tsx";

// ============================================================================
// Memoization helper
// ============================================================================

/**
 * Creates a selector that caches its result. Recomputes only when the
 * input slice (selected by `inputFn`) changes by reference.
 */
function createMemoSelector<TInput, TOutput>(
  inputFn: (state: AppState) => TInput,
  computeFn: (input: TInput) => TOutput,
): (state: AppState) => TOutput {
  let lastInput: TInput | undefined;
  let lastOutput: TOutput | undefined;
  let initialized = false;

  return (state: AppState): TOutput => {
    const input = inputFn(state);
    if (initialized && Object.is(input, lastInput)) {
      return lastOutput as TOutput;
    }
    lastInput = input;
    lastOutput = computeFn(input);
    initialized = true;
    return lastOutput;
  };
}

// ============================================================================
// 1. Boot / Runtime
// ============================================================================

/** Current boot phase */
export function selectBootPhase(state: AppState): BootPhase {
  return state.bootPhase;
}

/** Whether the runtime has finished initializing */
export function selectRuntimeReady(state: AppState): boolean {
  return state.runtimeReady;
}

/** Whether we're still in the boot phase (not yet "ready") */
export function selectIsBooting(state: AppState): boolean {
  return state.bootPhase === "boot";
}

// ============================================================================
// 2. Permission
// ============================================================================

/** Current permission mode */
export function selectPermissionMode(state: AppState): PermissionMode {
  return state.permissionMode;
}

/** Whether auto-approve is on */
export function selectIsAutoApprove(state: AppState): boolean {
  return state.permissionMode === "auto";
}

// ============================================================================
// 3. Messages
// ============================================================================

/** Full message array */
export function selectMessages(state: AppState): Message[] {
  return state.messages;
}

/** Number of completed (committed) messages */
export function selectCompletedMessageCount(state: AppState): number {
  return state.completedMessageCount;
}

/** Total message count */
export function selectMessageCount(state: AppState): number {
  return state.messages.length;
}

/** Last message in the list */
export const selectLastMessage = createMemoSelector(
  (state: AppState) => state.messages,
  (messages): Message | undefined => messages[messages.length - 1],
);

/** Only user messages */
export const selectUserMessages = createMemoSelector(
  (state: AppState) => state.messages,
  (messages): Message[] => messages.filter((m) => m.role === "user"),
);

/** Only gordon/assistant messages */
export const selectGordonMessages = createMemoSelector(
  (state: AppState) => state.messages,
  (messages): Message[] =>
    messages.filter((m) => m.role === "gordon" || m.role === "assistant"),
);

// ============================================================================
// 4. Streaming
// ============================================================================

/** Whether the agent is currently streaming a response */
export function selectIsStreaming(state: AppState): boolean {
  return state.isStreaming;
}

/** Current stream buffer content */
export function selectStreamBuffer(state: AppState): string {
  return state.streamBuffer;
}

/** Live extended-thinking text for the current turn */
export function selectActiveThinking(state: AppState): string {
  return state.activeThinking;
}

/** Live tool calls for the current turn */
export function selectActiveToolCalls(state: AppState) {
  return state.activeToolCalls;
}

/** Whether there is active output being generated */
export function selectHasActiveOutput(state: AppState): boolean {
  return state.isStreaming && state.streamBuffer.length > 0;
}

// ============================================================================
// 5. Agents / Handoffs
// ============================================================================

/** Active agent chains */
export function selectActiveAgents(state: AppState): AgentChain[] {
  return state.activeAgents;
}

/** Whether multi-agent (swarm) mode is active */
export function selectSwarmMode(state: AppState): boolean {
  return state.swarmMode;
}

/** Handoff history for the current turn */
export function selectHandoffHistory(state: AppState): HandoffEvent[] {
  return state.handoffHistory;
}

/** Number of agent handoffs in current turn */
export function selectHandoffCount(state: AppState): number {
  return state.handoffHistory.length;
}

/** Name of the currently active agent (last in chain) */
export const selectCurrentAgentName = createMemoSelector(
  (state: AppState) => state.activeAgents,
  (agents): string | null => {
    const running = agents.filter((a) => a.status === "running");
    return running.length > 0 ? running[running.length - 1]!.agentName : null;
  },
);

// ============================================================================
// 6. Approvals
// ============================================================================

/** Pending approval requests */
export function selectPendingApprovals(state: AppState): ApprovalRequest[] {
  return state.pendingApprovals;
}

/** Whether there are any pending approvals */
export function selectHasPendingApprovals(state: AppState): boolean {
  return state.pendingApprovals.length > 0;
}

/** Number of pending approvals */
export function selectPendingApprovalCount(state: AppState): number {
  return state.pendingApprovals.length;
}

// ============================================================================
// 7. Session
// ============================================================================

/** Current session ID */
export function selectSessionId(state: AppState): string | null {
  return state.sessionId;
}

/** Current thread ID */
export function selectThreadId(state: AppState): string | null {
  return state.threadId;
}

/** Whether this session was resumed from a previous one */
export function selectIsResumedSession(state: AppState): boolean {
  return state.isResumedSession;
}

// ============================================================================
// 8. Cost / Tokens
// ============================================================================

/** Total token count for the session */
export function selectTokenCount(state: AppState): number {
  return state.tokenCount;
}

/** Cumulative cost estimate */
export function selectCost(state: AppState): number {
  return state.cost;
}

// ============================================================================
// 9. Background Tasks
// ============================================================================

/** All background tasks */
export function selectBackgroundTasks(state: AppState): BackgroundTask[] {
  return state.backgroundTasks;
}

/** Number of active (non-completed) background tasks */
export const selectActiveBackgroundTaskCount = createMemoSelector(
  (state: AppState) => state.backgroundTasks,
  (tasks): number =>
    tasks.filter((t) => t.status !== "completed" && t.status !== "failed").length,
);

// ============================================================================
// 10. Notifications
// ============================================================================

/** All notifications */
export function selectNotifications(state: AppState): TuiNotification[] {
  return state.notifications;
}

/** Active (non-dismissed) notifications */
export const selectActiveNotifications = createMemoSelector(
  (state: AppState) => state.notifications,
  (notifications): TuiNotification[] =>
    notifications.filter((n) => !n.dismissed),
);

/** Count of active notifications */
export const selectActiveNotificationCount = createMemoSelector(
  (state: AppState) => state.notifications,
  (notifications): number =>
    notifications.filter((n) => !n.dismissed).length,
);

// ============================================================================
// 11. Autonomous Loop
// ============================================================================

/** Whether the autonomous trading loop is active */
export function selectAutonomousActive(state: AppState): boolean {
  return state.autonomousActive;
}

/** Number of strategies running in the autonomous loop */
export function selectAutonomousStrategyCount(state: AppState): number {
  return state.autonomousStrategyCount;
}

// ============================================================================
// 12. UI Panels
// ============================================================================

/** Whether the command palette is open */
export function selectShowPalette(state: AppState): boolean {
  return state.showPalette;
}

/** Whether the setup wizard is open */
export function selectShowSetup(state: AppState): boolean {
  return state.showSetup;
}

/** Whether the first-trade tour is open */
export function selectShowFirstTradeTour(state: AppState): boolean {
  return state.showFirstTradeTour;
}

/** Whether inline help is shown */
export function selectShowHelp(state: AppState): boolean {
  return state.showHelp;
}

/** Whether reset confirmation is open */
export function selectShowResetConfirm(state: AppState): boolean {
  return state.showResetConfirm;
}

/** Whether Ctrl+C was recently pressed (for double-press exit) */
export function selectCtrlCPressed(state: AppState): boolean {
  return state.ctrlCPressed;
}

/** Active workspace name */
export function selectActiveWorkspace(state: AppState): string | null {
  return state.activeWorkspace;
}

export function selectModeBanner(state: AppState): ModeBannerState | null {
  return state.modeBanner;
}

export function selectKillSwitchStatus(state: AppState) {
  return state.killSwitches;
}

export function selectActiveOverlayView(state: AppState): OverlayViewId | null {
  return state.activeOverlayView;
}

export function selectPager(state: AppState): PagerContent | null {
  return state.pager;
}

export function selectRadarFocus(state: AppState): RadarFocus | null {
  return state.radarFocus;
}

export function selectOpenDialogs(state: AppState): OpenDialog[] {
  return state.openDialogs;
}

export function selectAnyDialogOpen(state: AppState): boolean {
  return state.openDialogs.length > 0;
}

export function selectTopDialog(state: AppState): OpenDialog | null {
  return state.openDialogs[state.openDialogs.length - 1] ?? null;
}

export function selectDialogPayload<T>(state: AppState, id: DialogId): T | undefined {
  return state.openDialogs.find((dialog) => dialog.id === id)?.payload as T | undefined;
}

// ============================================================================
// 13. Composite / derived selectors
// ============================================================================

/** Whether any modal overlay is active (palette, setup, help) */
export function selectHasActiveOverlay(state: AppState): boolean {
  return state.showPalette || state.showSetup || state.showHelp || state.showResetConfirm || state.pager !== null || state.activeOverlayView !== null;
}

/** Summary object for the footer/status bar */
export const selectFooterSummary = createMemoSelector(
  (state: AppState) => state,
  (state) => ({
    permissionMode: state.permissionMode,
    isStreaming: state.isStreaming,
    tokenCount: state.tokenCount,
    cost: state.cost,
    pendingApprovals: state.pendingApprovals.length,
    backgroundTasks: state.backgroundTasks.filter(
      (t) => t.status !== "completed" && t.status !== "failed",
    ).length,
    autonomousActive: state.autonomousActive,
    autonomousStrategyCount: state.autonomousStrategyCount,
    activeWorkspace: state.activeWorkspace,
  }),
);

/** Whether the app is in a "busy" state (streaming or has pending approvals) */
export function selectIsBusy(state: AppState): boolean {
  return state.isStreaming || state.pendingApprovals.length > 0;
}

import React, { useCallback, useEffect } from "react";
import { Box, Text, Spacer, useInput, useApp } from "ink";

// ── Providers ──
import { StatsProvider } from "./state/StatsProvider.js";
import { NotificationsProvider } from "./state/NotificationsProvider.js";
import {
  AppStateProvider,
  useAppState,
  useDispatch,
  useAppStore,
} from "./state/AppStateProvider.js";

// ── Components ──
import { GordonHeader } from "./components/GordonHeader.js";
import { type Message, type MessageVariant } from "./components/MessageBubble.js";
import { StreamingText } from "./components/StreamingText.js";
import { AgentProgress } from "./components/AgentProgress.js";
import { SwarmTree } from "./components/SwarmTree.js";
import { ApprovalDialog } from "./components/ApprovalDialog.js";
import { WorkerBadge } from "./components/WorkerBadge.js";
import { InlineHelp } from "./components/InlineHelp.js";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette.js";
import { BootScreen } from "./components/BootScreen.js";
import { SetupWizard } from "./components/SetupWizard.js";
import { HandoffArrow } from "./components/HandoffArrow.js";
import { PromptInput } from "./components/PromptInput.js";
import { VirtualMessageList } from "./components/VirtualMessageList.js";
import { CostDisplay } from "./components/CostDisplay.js";

// ── Hooks ──
import { useDoublePress } from "./hooks/useDoublePress.js";
import { useElapsedTime } from "./hooks/useElapsedTime.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useMergedCommands } from "./hooks/useMergedCommands.js";

// ── Bridge ──
import { initializeRuntime, handleInput, handleApprovalDecision } from "./bridge/runtime.js";

// ============================================================================
// Gordon App — Claude Code for Vibe Trading
//
// Conversation-first. No borders on messages. No panels. No dashboard.
// Inline tables, charts, approvals, agent progress — all in the conversation.
//
// Provider tree: StatsProvider > NotificationsProvider > AppStateProvider
// State: useAppState(selector) + useDispatch() from AppStateProvider
// ============================================================================

// ── Height constants (terminal lines) ──
const HEADER_HEIGHT = 6;
const INPUT_HEIGHT = 2;
const FOOTER_HEIGHT = 1;
const CHROME_HEIGHT = HEADER_HEIGHT + INPUT_HEIGHT + FOOTER_HEIGHT;

/**
 * AppInner — The core UI, mounted inside the provider tree.
 * Reads all state via useAppState selectors and dispatches via useDispatch.
 */
function AppInner() {
  const dispatch = useDispatch();
  const { getState } = useAppStore();
  const { exit } = useApp();

  // ── Selectors (fine-grained subscriptions) ──
  const bootPhase = useAppState((s) => s.bootPhase);
  const runtimeReady = useAppState((s) => s.runtimeReady);
  const showSetup = useAppState((s) => s.showSetup);
  const showPalette = useAppState((s) => s.showPalette);
  const showHelp = useAppState((s) => s.showHelp);
  const permissionMode = useAppState((s) => s.permissionMode);
  const messages = useAppState((s) => s.messages);
  const isStreaming = useAppState((s) => s.isStreaming);
  const streamBuffer = useAppState((s) => s.streamBuffer);
  const activeAgents = useAppState((s) => s.activeAgents);
  const swarmMode = useAppState((s) => s.swarmMode);
  const handoffHistory = useAppState((s) => s.handoffHistory);
  const pendingApprovals = useAppState((s) => s.pendingApprovals);
  const sessionId = useAppState((s) => s.sessionId);
  const threadId = useAppState((s) => s.threadId);
  const isResumedSession = useAppState((s) => s.isResumedSession);
  const tokenCount = useAppState((s) => s.tokenCount);
  const autonomousActive = useAppState((s) => s.autonomousActive);
  const autonomousStrategyCount = useAppState((s) => s.autonomousStrategyCount);

  // ── Custom hooks ──
  const { rows } = useTerminalSize();
  const ctrlC = useDoublePress(2000);
  const { formatted: elapsedFormatted } = useElapsedTime(isStreaming);
  const paletteItems = useMergedCommands();

  // ── Derived ──
  const activeAgentCount = activeAgents.filter((c) => c.status === "running").length;
  const activeAgentName = activeAgents.length === 1 ? (activeAgents[0]?.agentName ?? null) : null;
  const viewportHeight = Math.max(rows - CHROME_HEIGHT, 6);

  // ── StateUpdater adapter ──
  // The runtime bridge still uses `setState(fn)` — this adapter runs
  // the updater against a live snapshot from the store, diffs the
  // result, and dispatches granular actions so the reducer stays the
  // single source of truth. Using getState() avoids stale closures.
  const stateUpdater = useCallback(
    (fn: (prev: any) => any) => {
      const prev = getState();
      const next = fn(prev);
      if (!next || next === prev) return;

      // Diff and dispatch granular actions
      if (next.messages !== prev.messages) {
        dispatch({ type: "SET_MESSAGES", messages: next.messages });
      }
      if (next.isStreaming !== prev.isStreaming) {
        dispatch(next.isStreaming ? { type: "START_STREAMING" } : { type: "STOP_STREAMING" });
      }
      if (next.streamBuffer !== prev.streamBuffer) {
        dispatch({ type: "SET_STREAM_BUFFER", buffer: next.streamBuffer });
      }
      if (next.activeAgents !== prev.activeAgents) {
        dispatch({ type: "SET_ACTIVE_AGENTS", agents: next.activeAgents });
      }
      if (next.swarmMode !== prev.swarmMode) {
        dispatch({ type: "SET_SWARM_MODE", enabled: next.swarmMode });
      }
      if (next.handoffHistory !== prev.handoffHistory) {
        dispatch({ type: "SET_HANDOFF_HISTORY", history: next.handoffHistory });
      }
      if (next.pendingApprovals !== prev.pendingApprovals) {
        dispatch({ type: "SET_PENDING_APPROVALS", approvals: next.pendingApprovals });
      }
      if (next.sessionId !== prev.sessionId || next.threadId !== prev.threadId) {
        dispatch({ type: "SET_SESSION", sessionId: next.sessionId, threadId: next.threadId });
      }
      if (next.isResumedSession !== prev.isResumedSession) {
        dispatch({ type: "SET_RESUMED_SESSION", isResumed: next.isResumedSession });
      }
      if (next.permissionMode !== prev.permissionMode) {
        dispatch({ type: "SET_PERMISSION_MODE", mode: next.permissionMode });
      }
      if (next.runtimeReady !== prev.runtimeReady) {
        dispatch({ type: "SET_RUNTIME_READY", ready: next.runtimeReady });
      }
      if (next.bootPhase !== prev.bootPhase) {
        dispatch({ type: "SET_BOOT_PHASE", phase: next.bootPhase });
      }
      if (next.showSetup !== prev.showSetup) {
        dispatch({ type: "SET_SHOW_SETUP", show: next.showSetup });
      }
      if (next.showPalette !== prev.showPalette) {
        dispatch({ type: "SET_SHOW_PALETTE", show: next.showPalette });
      }
      if (next.showHelp !== prev.showHelp) {
        dispatch({ type: "SET_SHOW_HELP", show: next.showHelp });
      }
      if (next.backgroundTasks !== prev.backgroundTasks) {
        dispatch({ type: "SET_BACKGROUND_TASKS", tasks: next.backgroundTasks });
      }
      if (next.autonomousActive !== prev.autonomousActive) {
        dispatch({
          type: "SET_AUTONOMOUS_ACTIVE",
          active: next.autonomousActive,
          strategyCount: next.autonomousStrategyCount,
        });
      }
      if (next.activeWorkspace !== prev.activeWorkspace) {
        dispatch({ type: "SET_ACTIVE_WORKSPACE", workspace: next.activeWorkspace });
      }
    },
    [dispatch, getState],
  );

  // ── Initialize runtime AFTER boot animation completes ──
  useEffect(() => {
    if (bootPhase !== "ready") return; // Wait for boot animation to finish
    if (runtimeReady) return; // Already initialized

    initializeRuntime(stateUpdater)
      .then(() => {
        dispatch({ type: "SET_RUNTIME_READY", ready: true });
      })
      .catch((err) => {
        dispatch({ type: "SET_RUNTIME_READY", ready: true });
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            id: "init-error",
            role: "system" as const,
            variant: "error" as MessageVariant,
            content: `Runtime init error: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date().toISOString(),
          },
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootPhase]);

  // ── Ctrl+C double-press exit ──
  useEffect(() => {
    if (ctrlC.isDoublePressed) {
      exit();
    }
  }, [ctrlC.isDoublePressed, exit]);

  // ── Global keybindings ──
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      ctrlC.onPress();
      return;
    }
    if (key.ctrl && input === "p") {
      dispatch({ type: "TOGGLE_PALETTE" });
      return;
    }
    // ? help disabled — conflicts with TextInput. Use /help or Ctrl+P instead.
  });

  // ── Handlers ──
  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isStreaming) return;

      dispatch({ type: "SET_SHOW_HELP", show: false });

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: "ADD_MESSAGE", message: userMsg });
      handleInput(trimmed, stateUpdater);
    },
    [isStreaming, dispatch, stateUpdater],
  );

  const handlePaletteSelect = useCallback(
    (item: PaletteItem) => {
      dispatch({ type: "SET_SHOW_PALETTE", show: false });
      handleSubmit(item.label);
    },
    [dispatch, handleSubmit],
  );

  const handleApproval = useCallback(
    (decision: "always" | "once" | "deny", id: string) => {
      handleApprovalDecision(decision, id, stateUpdater);
    },
    [stateUpdater],
  );

  // ── Boot screen: Gekko ASCII art + "Press Enter to start" ──
  if (bootPhase === "boot") {
    return (
      <BootScreen
        onReady={() => dispatch({ type: "SET_BOOT_PHASE", phase: "ready" })}
      />
    );
  }

  // ── Setup wizard ──
  if (showSetup) {
    return (
      <SetupWizard
        onComplete={() => {
          dispatch({ type: "SET_SHOW_SETUP", show: false });
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              id: `setup-${Date.now()}`,
              role: "system",
              content: "Setup complete. Try /scan to see what's moving.",
              timestamp: new Date().toISOString(),
            },
          });
        }}
        onSkip={() => dispatch({ type: "SET_SHOW_SETUP", show: false })}
      />
    );
  }

  // ── Placeholder text for PromptInput ──
  const placeholder = isStreaming
    ? `\u25CF Gordon is thinking... ${elapsedFormatted}`
    : ctrlC.isPending
      ? "Press Ctrl+C again to exit"
      : !runtimeReady
        ? "Initializing..."
        : pendingApprovals.length > 0
          ? `${pendingApprovals.length} approval(s) pending \u2014 approve <id> or deny <id>`
          : "";

  return (
    <Box flexDirection="column">
      {/* ── Header ── */}
      <GordonHeader
        permissionMode={permissionMode}
        sessionId={sessionId}
        threadId={threadId}
        isResumedSession={isResumedSession}
        resumeMessageCount={isResumedSession ? messages.length : undefined}
        toolCount={5}
      />

      {/* ── Conversation — only renders when there's content ── */}
      <Box flexDirection="column" paddingX={1}>
        {messages.length > 0 && (
          <VirtualMessageList
            messages={messages}
            viewportHeight={viewportHeight}
            scrollEnabled={!showPalette && !isStreaming}
          />
        )}

        {/* Pending approvals (inline) */}
        {pendingApprovals.map((a) => (
          <ApprovalDialog key={a.id} approval={a} onDecision={handleApproval} />
        ))}

        {/* Handoff arrows */}
        {isStreaming && handoffHistory.length > 0 && (
          <HandoffArrow
            from={handoffHistory[handoffHistory.length - 1]!.from}
            to={handoffHistory[handoffHistory.length - 1]!.to}
          />
        )}

        {/* Agent progress (parallel chains) or swarm tree */}
        {isStreaming && activeAgents.length > 0 && (
          swarmMode ? (
            <SwarmTree
              agents={activeAgents.map((c) => ({
                id: c.id,
                name: c.agentName,
                symbol: c.symbol,
                status:
                  c.status === "running"
                    ? ("running" as const)
                    : c.status === "done"
                      ? ("done" as const)
                      : ("error" as const),
                duration: c.duration,
              }))}
            />
          ) : (
            <AgentProgress
              chains={activeAgents}
              handoffs={handoffHistory}
              tokenCount={tokenCount}
            />
          )
        )}

        {/* Streaming text with cursor */}
        {isStreaming && (
          <Box flexDirection="column" marginTop={1}>
            <Box>
              <Text bold color="cyanBright">GORDON</Text>
              {activeAgentName && (
                <>
                  <Text dimColor> {"\u00b7"} </Text>
                  <WorkerBadge agent={activeAgentName} showBullet={false} />
                </>
              )}
              <Text dimColor> {elapsedFormatted}</Text>
            </Box>
            {streamBuffer ? (
              <Box paddingLeft={2}>
                <StreamingText content={streamBuffer} isStreaming={true} />
              </Box>
            ) : (
              <Text color="cyanBright">  {"\u25CF"} thinking...</Text>
            )}
          </Box>
        )}

        {/* Inline help */}
        {showHelp && !isStreaming && <InlineHelp />}

        {/* Ctrl+C pending warning */}
        {ctrlC.isPending && (
          <Box marginTop={1}>
            <Text color="red" bold>
              {permissionMode === "auto"
                ? "\u26A0 Auto mode. Pending operations will continue. Press Ctrl+C again to exit."
                : "Press Ctrl+C again to exit."}
            </Text>
          </Box>
        )}
      </Box>

      {/* ── Command palette overlay ── */}
      {showPalette && (
        <CommandPalette
          items={paletteItems}
          onSelect={handlePaletteSelect}
          onClose={() => dispatch({ type: "SET_SHOW_PALETTE", show: false })}
        />
      )}

      {/* ── Input area with border (like Claude Code) ── */}
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexDirection="column"
      >
        <PromptInput
          onSubmit={handleSubmit}
          placeholder={placeholder}
          permissionMode={permissionMode}
          activeAgentCount={activeAgentCount}
          activeAgentName={activeAgentName}
          isStreaming={isStreaming}
          autonomousActive={autonomousActive}
          autonomousStrategyCount={autonomousStrategyCount}
        />
        <Box justifyContent="flex-end">
          <CostDisplay />
        </Box>
      </Box>
    </Box>
  );
}

// ============================================================================
// App — Public export wrapped in provider tree
//
// StatsProvider  > NotificationsProvider > AppStateProvider > AppInner
// ============================================================================

export function App() {
  return (
    <StatsProvider>
      <NotificationsProvider>
        <AppStateProvider>
          <AppInner />
        </AppStateProvider>
      </NotificationsProvider>
    </StatsProvider>
  );
}

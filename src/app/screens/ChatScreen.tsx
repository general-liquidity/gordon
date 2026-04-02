import React from "react";
import { Box, Text, useStdout } from "ink";
import { ChatInput } from "../ChatInput.tsx";
import { ChatView, type ChatMessage } from "../ChatView.tsx";
import { QuickStartMenu, type MenuOption } from "../QuickStartMenu.tsx";
import { ShortcutsHint } from "../components/ShortcutsOverlay.tsx";
import { WorkspaceRail } from "../components/WorkspaceRail.tsx";
import { DeskRail } from "../components/desk/DeskRail.tsx";
import RuntimeInspector from "../components/RuntimeInspector.tsx";
import { WorkspaceBoard } from "./WorkspaceBoard.tsx";
import { COLORS } from "../theme.ts";
import { getQuickActionItems, type QuickActionContext } from "../commandUx.ts";
import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";
import type { WorkspaceId, WorkspaceMemoryState } from "../state/AppStore.ts";
import type { TaskTreeState } from "../taskTree.ts";
import type { GordonConfig } from "../../types/index.ts";
import type { WorkspaceBoardViewModel } from "../workspaceViewModels.ts";

interface ChatScreenProps {
  visibleMessages: ChatMessage[];
  hiddenBefore: number;
  hiddenAfter: number;
  visibleLimit: number;
  isPinnedBottom: boolean;
  workspace: WorkspaceId;
  workspaceMemory: WorkspaceMemoryState;
  isStreaming: boolean;
  activeStreamingTimestamp: string | null;
  activityStatus: string | null;
  activeToolCall: string | null;
  showStartupHint: boolean;
  showChatBanner: boolean;
  startupBannerMode: GordonConfig["startupBannerMode"];
  allMessagesCount: number;
  quickActionsOverlayOpen: boolean;
  onMenuSelect: (option: MenuOption) => void;
  onTypeToChat: (seed: string) => void;
  mode: "SAFE" | "ARMED";
  setupComplete: boolean;
  hasExchange: boolean;
  hasBroker: boolean;
  hasWalletRails: boolean;
  hasMcpServers: boolean;
  queuedPreview?: string;
  queuedCount: number;
  taskTree: TaskTreeState | null;
  backgroundTaskTree: TaskTreeState | null;
  runtimeInspector: RuntimeInspectorViewModel | null;
  workspaceViewModel: WorkspaceBoardViewModel | null;
  selectedWorkspaceCardIndex?: number;
  isLoading: boolean;
  chatInputPlaceholder: string;
  quickActionContext: QuickActionContext;
  hasConversationMomentum: boolean;
  onSubmit: (value: string) => Promise<void>;
  onWorkspaceShortcut: (digit: string) => void;
  onOpenQuickActions: () => void;
  onTypingStateChange: (typing: boolean) => void;
  onDraftChange: (value: string) => void;
  busy: boolean;
  seedValue: string;
  seedNonce: number;
  onCancel: () => void;
  canCancel: boolean;
}

function DeskFocusStrip(props: {
  mode: "SAFE" | "ARMED";
  busy: boolean;
  hasConversationMomentum: boolean;
  quickActionContext: QuickActionContext;
  runtimeInspector: RuntimeInspectorViewModel | null;
}): React.ReactElement {
  const suggestedPaths = getQuickActionItems(props.quickActionContext).slice(0, 4);
  const stateTokens = [
    props.mode,
    `approvals ${props.runtimeInspector?.pendingApprovalCount ?? 0}`,
    `background ${props.runtimeInspector?.backgroundTaskCount ?? 0}`,
    `bridge ${props.runtimeInspector?.activeBridgeSessions ?? 0}`,
  ];

  return (
    <Box marginTop={1} marginBottom={1}>
      <DeskRail
        title="Live Desk"
        subtitle={props.busy ? "Routing the active request." : "Reason, route, and approve from the transcript."}
        tone="analysis"
      >
        <Box flexWrap="wrap">
          {stateTokens.map((token, index) => (
            <Text
              key={`${token}-${index}`}
              color={index === 0
                ? props.mode === "ARMED" ? COLORS.RISK : COLORS.MONEY
                : COLORS.DIM}
              bold={index === 0}
            >
              {index > 0 ? " · " : ""}{token}
            </Text>
          ))}
        </Box>
        {(props.runtimeInspector?.pendingApprovalCount ?? 0) > 0 && (
          <Box marginTop={1} flexWrap="wrap">
            <Text color={COLORS.DIM}>
              Approval:
            </Text>
            <Text color={COLORS.WHITE}>
              {" "}Shift+A stage approve · Shift+D stage deny
            </Text>
          </Box>
        )}
        {!props.hasConversationMomentum && suggestedPaths.length > 0 && (
          <Box marginTop={1} flexWrap="wrap">
            <Text color={COLORS.DIM}>
              Flows:
            </Text>
            <Text color={COLORS.WHITE}>
              {" "}{suggestedPaths.map((item) => item.command).join(" · ")}
            </Text>
          </Box>
        )}
      </DeskRail>
    </Box>
  );
}

function useFrozenWhenDetached<T>(value: T, isPinnedBottom: boolean): T {
  const lastLiveValueRef = React.useRef(value);
  if (isPinnedBottom) {
    lastLiveValueRef.current = value;
  }
  return isPinnedBottom ? value : lastLiveValueRef.current;
}

export function ChatScreen(props: ChatScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const widescreen = (stdout?.columns ?? 0) >= 170;
  const columns = stdout?.columns ?? 80;
  const runStatusTone = props.isStreaming
    ? COLORS.MONEY
    : props.isLoading
      ? COLORS.AMBER
      : props.queuedCount > 0
        ? COLORS.ACCENT
        : COLORS.DIM;
  const runStatusLabel = props.isStreaming
    ? "LIVE"
    : props.isLoading
      ? "BOOT"
      : props.queuedCount > 0
        ? "QUEUE"
        : "IDLE";
  const runStatusText = props.activityStatus
    ?? (props.queuedCount > 0
      ? "Queued follow-up ready."
      : props.isLoading
        ? "Preparing the desk."
        : "Desk clear.");
  const footerText = props.busy
    ? (columns >= 110 ? "PgUp/PgDn/Home/End transcript · /help" : "/help")
    : columns >= 130
      ? "Ctrl+K actions · [ ] or 1-5 workspaces · PgUp/PgDn/Home/End transcript · /menu actions · /help commands"
      : columns >= 100
        ? "Ctrl+K actions · [ ] or 1-5 workspaces · PgUp/PgDn transcript · /help"
        : "Ctrl+K · [ ] or 1-5 · /help";
  const runtimeInspectorForRender = useFrozenWhenDetached(props.runtimeInspector, props.isPinnedBottom);
  const workspaceViewModelForRender = useFrozenWhenDetached(props.workspaceViewModel, props.isPinnedBottom);
  const visibleMessagesForRender = useFrozenWhenDetached(props.visibleMessages, props.isPinnedBottom);
  const hiddenBeforeForRender = useFrozenWhenDetached(props.hiddenBefore, props.isPinnedBottom);
  const visibleLimitForRender = useFrozenWhenDetached(props.visibleLimit, props.isPinnedBottom);
  const isStreamingForRender = useFrozenWhenDetached(props.isStreaming, props.isPinnedBottom);
  const activeStreamingTimestampForRender = useFrozenWhenDetached(props.activeStreamingTimestamp, props.isPinnedBottom);
  const runStatusLabelForRender = useFrozenWhenDetached(runStatusLabel, props.isPinnedBottom);
  const runStatusTextForRender = useFrozenWhenDetached(runStatusText, props.isPinnedBottom);
  const activityStatusForRender = useFrozenWhenDetached(props.activityStatus, props.isPinnedBottom);
  const activeToolCallForRender = useFrozenWhenDetached(props.activeToolCall, props.isPinnedBottom);
  const showRuntimeRail = Boolean(
    runtimeInspectorForRender?.hasContent
    || props.backgroundTaskTree,
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {props.showStartupHint && props.allMessagesCount === 0 && !props.showChatBanner && (
        <ShortcutsHint duration={5000} visible={props.showStartupHint} />
      )}

      <Box flexDirection={widescreen ? "row" : "column"} flexGrow={1}>
        <Box flexDirection="column" flexGrow={1}>
          <WorkspaceRail
            workspace={props.workspace}
            mode={props.mode}
            queuedCount={props.queuedCount}
            workspaceMemory={props.workspaceMemory}
          />

          {props.workspace === "desk" && (
            <DeskFocusStrip
              mode={props.mode}
              busy={props.busy}
              hasConversationMomentum={props.hasConversationMomentum}
              quickActionContext={props.quickActionContext}
              runtimeInspector={runtimeInspectorForRender}
            />
          )}

          {props.workspace !== "desk" && (
            workspaceViewModelForRender && (
              <WorkspaceBoard
                model={workspaceViewModelForRender}
                selectedCardIndex={props.selectedWorkspaceCardIndex}
              />
            )
          )}

          <ChatView
            messages={visibleMessagesForRender}
            hiddenBefore={hiddenBeforeForRender}
            hiddenAfter={props.hiddenAfter}
            visibleLimit={visibleLimitForRender}
            isPinnedBottom={props.isPinnedBottom}
            isStreaming={isStreamingForRender}
            activeStreamingTimestamp={activeStreamingTimestampForRender}
            activityStatus={activityStatusForRender}
            activeToolCall={activeToolCallForRender}
          />

          <Box marginX={1} marginBottom={1}>
            <Box paddingX={1}>
              <Text color={runStatusTone} bold={runStatusLabelForRender !== "IDLE"}>
                {runStatusLabelForRender}
              </Text>
              <Text color={COLORS.DIM}>
                {" "}{runStatusTextForRender}
              </Text>
            </Box>
          </Box>
        </Box>

        {props.workspace === "desk" && (showRuntimeRail || (props.backgroundTaskTree && !props.busy)) && (
          <Box
            flexDirection="column"
            width={widescreen ? 36 : undefined}
            marginLeft={widescreen ? 1 : 0}
            marginTop={widescreen ? 0 : 1}
          >
            {showRuntimeRail && (
              <RuntimeInspector inspector={runtimeInspectorForRender} />
            )}
          </Box>
        )}
      </Box>

      {props.quickActionsOverlayOpen && (
        <QuickStartMenu
          onSelect={props.onMenuSelect}
          onTypeToChat={props.onTypeToChat}
          mode={props.mode}
          setupComplete={props.setupComplete}
          hasExchange={props.hasExchange}
          hasBroker={props.hasBroker}
          hasWalletRails={props.hasWalletRails}
          hasMcpServers={props.hasMcpServers}
          variant="overlay"
        />
      )}

        <ChatInput
        onSubmit={props.onSubmit}
        onWorkspaceShortcut={props.onWorkspaceShortcut}
        onOpenQuickActions={props.onOpenQuickActions}
        onTypingStateChange={props.onTypingStateChange}
        onDraftChange={props.onDraftChange}
        disabled={props.quickActionsOverlayOpen}
        busy={props.busy}
        queueDepth={props.queuedCount}
        placeholder={props.chatInputPlaceholder}
          emptyStateHint={
            props.allMessagesCount === 0
              ? props.workspace === "market"
                ? "Scan the tape or focus one symbol."
                : props.workspace === "plan"
                  ? "Build or review one ticket."
                : props.workspace === "lab"
                  ? "Generate, compare, or validate a strategy."
                  : props.workspace === "monitor"
                    ? "Pull the book, positions, or runtime health."
                    : "Ask Gordon to scan, analyze, plan, or review a market."
              : null
          }
        seedValue={props.seedValue}
        seedNonce={props.seedNonce}
        quickActionContext={props.quickActionContext}
        hasConversationMomentum={props.hasConversationMomentum}
      />

      <Box paddingX={2} paddingY={0}>
        <Text color={COLORS.DIM}>
          {footerText}
        </Text>
      </Box>
    </Box>
  );
}

export default ChatScreen;

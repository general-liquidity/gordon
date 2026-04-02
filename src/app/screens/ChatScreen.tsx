import React from "react";
import { Box, Text, useStdout } from "ink";
import { ChatInput } from "../ChatInput.tsx";
import { ChatView, type ChatMessage } from "../ChatView.tsx";
import { ShortcutsHint } from "../components/ShortcutsOverlay.tsx";
import { CommandPaletteOverlay, type CommandPaletteItem } from "../components/overlays/CommandPaletteOverlay.tsx";
import { SymbolJumpOverlay } from "../components/overlays/SymbolJumpOverlay.tsx";
import { ReviewDeskOverlay } from "../components/overlays/ReviewDeskOverlay.tsx";
import { WorkspaceRail } from "../components/WorkspaceRail.tsx";
import { DeskRail } from "../components/desk/DeskRail.tsx";
import RuntimeInspector from "../components/RuntimeInspector.tsx";
import { MarketWorkspace } from "./MarketWorkspace.tsx";
import { PlanWorkspace } from "./PlanWorkspace.tsx";
import { LabWorkspace } from "./LabWorkspace.tsx";
import { MonitorWorkspace } from "./MonitorWorkspace.tsx";
import { COLORS } from "../theme.ts";
import { getQuickActionItems, type QuickActionContext } from "../commandUx.ts";
import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";
import type { WorkspaceId, WorkspaceMemoryState } from "../state/AppStore.ts";
import type { TaskTreeState } from "../taskTree.ts";
import type { GordonConfig } from "../../types/index.ts";
import type { WorkspaceSurfaceViewModel, PlanWorkspaceApprovalModel, PlanWorkspaceTicketModel } from "../workspaceSurfaces.ts";
import type { OverlayKind } from "../overlayState.ts";

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
  overlayKind: OverlayKind;
  mode: "SAFE" | "ARMED";
  queuedPreview?: string;
  queuedCount: number;
  taskTree: TaskTreeState | null;
  backgroundTaskTree: TaskTreeState | null;
  runtimeInspector: RuntimeInspectorViewModel | null;
  workspaceSurfaceModel: WorkspaceSurfaceViewModel | null;
  selectedWorkspaceCardIndex?: number;
  isLoading: boolean;
  chatInputPlaceholder: string;
  quickActionContext: QuickActionContext;
  hasConversationMomentum: boolean;
  onSubmit: (value: string) => Promise<void>;
  onWorkspaceShortcut: (digit: string) => void;
  onOpenQuickActions: () => void;
  onStageOverlayCommand: (command: string) => void;
  onJumpSymbol: (symbol: string) => void;
  onTypingStateChange: (typing: boolean) => void;
  onDraftChange: (value: string) => void;
  busy: boolean;
  seedValue: string;
  seedNonce: number;
  onCancel: () => void;
  canCancel: boolean;
  commandPaletteItems: CommandPaletteItem[];
  symbolJumpSymbols: string[];
  reviewDeskTicket: PlanWorkspaceTicketModel | null;
  reviewDeskApprovals: PlanWorkspaceApprovalModel | null;
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
        subtitle={props.busy ? "Active route open." : "Reason, route, approve from the transcript."}
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
              {" "}Shift+A approve · Shift+D deny
            </Text>
          </Box>
        )}
        {!props.hasConversationMomentum && suggestedPaths.length > 0 && (
          <Box marginTop={1} flexWrap="wrap">
            <Text color={COLORS.DIM}>
              Start:
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
      ? "Queued route ready."
      : props.isLoading
        ? "Preparing the desk."
        : "Desk clear.");
  const footerText = props.busy
    ? (columns >= 110 ? "Enter queue · Esc stop · PgUp/PgDn/Home/End · /help" : "Enter queue · Esc stop · /help")
    : columns >= 130
      ? "Ctrl+K palette · Ctrl+J symbol · Ctrl+R review · [ ] or 1-5 workspace · PgUp/PgDn/Home/End · /help"
      : columns >= 100
        ? "Ctrl+K palette · Ctrl+J symbol · Ctrl+R review · [ ] or 1-5 · /help"
        : "Ctrl+K · Ctrl+J · Ctrl+R · /help";
  const runtimeInspectorForRender = useFrozenWhenDetached(props.runtimeInspector, props.isPinnedBottom);
  const workspaceSurfaceModelForRender = useFrozenWhenDetached(props.workspaceSurfaceModel, props.isPinnedBottom);
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
            workspaceSurfaceModelForRender && (
              workspaceSurfaceModelForRender.workspace === "market" ? (
                <MarketWorkspace
                  model={workspaceSurfaceModelForRender}
                  selectedSectionIndex={props.selectedWorkspaceCardIndex}
                />
              ) : workspaceSurfaceModelForRender.workspace === "plan" ? (
                <PlanWorkspace
                  model={workspaceSurfaceModelForRender}
                  selectedSectionIndex={props.selectedWorkspaceCardIndex}
                />
              ) : workspaceSurfaceModelForRender.workspace === "lab" ? (
                <LabWorkspace
                  model={workspaceSurfaceModelForRender}
                  selectedSectionIndex={props.selectedWorkspaceCardIndex}
                />
              ) : workspaceSurfaceModelForRender.workspace === "monitor" ? (
                <MonitorWorkspace
                  model={workspaceSurfaceModelForRender}
                  selectedSectionIndex={props.selectedWorkspaceCardIndex}
                />
              ) : null
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

      {props.overlayKind === "quick-actions" && (
        <CommandPaletteOverlay
          items={props.commandPaletteItems}
          onSelect={props.onStageOverlayCommand}
        />
      )}

      {props.overlayKind === "symbol-jump" && (
        <SymbolJumpOverlay
          symbols={props.symbolJumpSymbols}
          onSelect={props.onJumpSymbol}
        />
      )}

      {props.overlayKind === "review-desk" && (
        <ReviewDeskOverlay
          ticket={props.reviewDeskTicket}
          approvals={props.reviewDeskApprovals}
          onStage={props.onStageOverlayCommand}
        />
      )}

        <ChatInput
        onSubmit={props.onSubmit}
        onWorkspaceShortcut={props.onWorkspaceShortcut}
        onOpenQuickActions={props.onOpenQuickActions}
        onTypingStateChange={props.onTypingStateChange}
        onDraftChange={props.onDraftChange}
        disabled={props.overlayKind !== "none"}
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

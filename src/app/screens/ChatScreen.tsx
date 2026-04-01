import React from "react";
import { Box, Text, useStdout } from "ink";
import { ChatInput } from "../ChatInput.tsx";
import { ChatView, type ChatMessage } from "../ChatView.tsx";
import { QuickStartMenu, type MenuOption } from "../QuickStartMenu.tsx";
import { ShortcutsHint } from "../components/ShortcutsOverlay.tsx";
import RuntimeInspector from "../components/RuntimeInspector.tsx";
import { COLORS } from "../theme.ts";
import type { QuickActionContext } from "../commandUx.ts";
import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";
import type { TaskTreeState } from "../taskTree.ts";
import type { GordonConfig } from "../../types/index.ts";

interface ChatScreenProps {
  visibleMessages: ChatMessage[];
  hiddenBefore: number;
  hiddenAfter: number;
  visibleLimit: number;
  isPinnedBottom: boolean;
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
  isLoading: boolean;
  chatInputPlaceholder: string;
  quickActionContext: QuickActionContext;
  hasConversationMomentum: boolean;
  onSubmit: (value: string) => Promise<void>;
  onOpenQuickActions: () => void;
  onTypingStateChange: (typing: boolean) => void;
  busy: boolean;
  seedValue: string;
  seedNonce: number;
  onCancel: () => void;
  canCancel: boolean;
}

export function ChatScreen(props: ChatScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const widescreen = (stdout?.columns ?? 0) >= 170;
  const columns = stdout?.columns ?? 80;
  const runStatusTone = props.isStreaming
    ? COLORS.MONEY
    : props.queuedCount > 0
      ? COLORS.AMBER
      : COLORS.ACCENT;
  const runStatusLabel = props.isStreaming
    ? "LIVE"
    : props.isLoading
      ? "BOOT"
      : "QUEUE";
  const runStatusText = props.activityStatus
    ?? (props.queuedCount > 0
      ? `Queued follow-ups: ${props.queuedCount}`
      : "The desk is routing the current request.");
  const showRuntimeRail = Boolean(
    props.runtimeInspector
    && (
      !props.busy
      || props.runtimeInspector.pendingApprovalCount > 0
      || props.runtimeInspector.backgroundTaskCount > 0
      || props.runtimeInspector.activeBridgeSessions > 0
    ),
  );
  const footerText = props.busy
    ? (columns >= 110 ? "Enter queues follow-up · Esc stops current run · /help" : "Enter queues · Esc stops")
    : columns >= 130
      ? "Ctrl+K actions · PgUp/PgDn/Home/End transcript · /menu actions · /help commands"
      : columns >= 100
        ? "Ctrl+K actions · PgUp/PgDn transcript · /help"
        : "Ctrl+K · Pg keys · /help";

  return (
    <Box flexDirection="column" flexGrow={1}>
      {props.showStartupHint && props.allMessagesCount === 0 && !props.showChatBanner && (
        <ShortcutsHint duration={5000} visible={props.showStartupHint} />
      )}

      <Box flexDirection={widescreen ? "row" : "column"} flexGrow={1}>
        <Box flexDirection="column" flexGrow={1}>
          <ChatView
            messages={props.visibleMessages}
            hiddenBefore={props.hiddenBefore}
            hiddenAfter={props.hiddenAfter}
            visibleLimit={props.visibleLimit}
            isPinnedBottom={props.isPinnedBottom}
            isStreaming={props.isStreaming}
            activeStreamingTimestamp={props.activeStreamingTimestamp}
            activityStatus={props.activityStatus}
            activeToolCall={props.activeToolCall}
          />

          {(props.isLoading || props.isStreaming || props.queuedCount > 0) && (
            <Box marginX={1} marginBottom={1}>
              <Box paddingX={1}>
                <Text color={runStatusTone} bold>
                  {runStatusLabel}
                </Text>
                <Text color={COLORS.DIM}>
                  {" "}{runStatusText}
                </Text>
                {props.queuedCount > 0 && props.queuedPreview && (
                  <Text color={COLORS.DIM}>
                    {" "}· next {props.queuedPreview}
                    {props.queuedCount > 1 ? ` (+${props.queuedCount - 1})` : ""}
                  </Text>
                )}
              </Box>
            </Box>
          )}
        </Box>

        {(showRuntimeRail || (props.backgroundTaskTree && !props.busy)) && (
          <Box
            flexDirection="column"
            width={widescreen ? 36 : undefined}
            marginLeft={widescreen ? 1 : 0}
            marginTop={widescreen ? 0 : 1}
          >
            {showRuntimeRail && (
              <RuntimeInspector inspector={props.runtimeInspector} />
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
        onOpenQuickActions={props.onOpenQuickActions}
        onTypingStateChange={props.onTypingStateChange}
        disabled={props.quickActionsOverlayOpen}
        busy={props.busy}
        queueDepth={props.queuedCount}
        placeholder={props.chatInputPlaceholder}
        emptyStateHint={
          props.allMessagesCount === 0
            ? "Ask Gordon to scan, analyze, plan, or review a market."
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

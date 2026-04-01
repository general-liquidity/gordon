import React from "react";
import { Box, Text } from "ink";
import { ChatInput } from "../ChatInput.tsx";
import { ChatView, type ChatMessage } from "../ChatView.tsx";
import { WelcomeBanner } from "../WelcomeBanner.tsx";
import { QuickStartMenu, type MenuOption } from "../QuickStartMenu.tsx";
import { TaskTree } from "../components/TaskTree.tsx";
import { ShortcutsHint } from "../components/ShortcutsOverlay.tsx";
import { ProgressIndicator, StreamingProgress } from "../components/ProgressIndicator.tsx";
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
  return (
    <Box flexDirection="column" flexGrow={1}>
      {props.showStartupHint && props.allMessagesCount === 0 && !props.showChatBanner && (
        <ShortcutsHint duration={5000} visible={props.showStartupHint} />
      )}

      {props.showChatBanner && (
        <WelcomeBanner mode={props.startupBannerMode} context="chat" />
      )}

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

      {(props.isLoading || props.isStreaming || props.queuedCount > 0) && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={COLORS.ACCENT_DIM}
          marginX={2}
          marginBottom={1}
          paddingX={1}
        >
          <Text color={COLORS.WHITE}>
            {props.isStreaming
              ? "Run active"
              : props.isLoading
                ? "Run starting"
                : "Queue ready"}
            {props.activityStatus ? `: ${props.activityStatus}` : ""}
          </Text>
          <Text color={COLORS.DIM}>
            Esc stops the active streamed response when possible. Enter queues a follow-up. Use /steer {"<message>"} to redirect the next run.
          </Text>
          {props.taskTree && <TaskTree tree={props.taskTree} />}
          {props.queuedCount > 0 && props.queuedPreview && (
            <Text color={COLORS.HIGHLIGHT}>
              Next queued: {props.queuedPreview}
              {props.queuedCount > 1 ? ` (+${props.queuedCount - 1} more)` : ""}
            </Text>
          )}
        </Box>
      )}

      {props.backgroundTaskTree && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={COLORS.TAN_DIM}
          marginX={2}
          marginBottom={1}
          paddingX={1}
        >
          <Text color={COLORS.DIM}>
            Daemon-owned work continues outside the active chat run.
          </Text>
          <TaskTree tree={props.backgroundTaskTree} title="Background Tasks" staticCompleted={false} />
        </Box>
      )}

      <RuntimeInspector inspector={props.runtimeInspector} />

      {props.isLoading && (
        <ProgressIndicator
          label={props.activityStatus || "Gordon is thinking..."}
          status="Routing request and preparing the response..."
          onCancel={props.onCancel}
          cancellable={props.canCancel}
        />
      )}

      {props.isStreaming && (
        <StreamingProgress
          operation={props.activityStatus || "Streaming response..."}
          currentTool={props.activeToolCall}
          isStreaming={props.isStreaming}
          onCancel={props.onCancel}
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
      />

      <Box paddingX={2} paddingY={0}>
        <Text color={COLORS.DIM}>
          Ctrl+K: actions | PgUp/PgDn/Home/End: transcript | ESC: stop agent response | /menu: actions | /help: commands
        </Text>
      </Box>
    </Box>
  );
}

export default ChatScreen;

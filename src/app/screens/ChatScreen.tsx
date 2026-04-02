import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import { ChatInput } from "../ChatInput.tsx";
import { ChatView, type ChatMessage } from "../ChatView.tsx";
import type { CockpitModel, PlanCockpitModel } from "../cockpitModels.ts";
import { WorkspaceRail } from "../components/WorkspaceRail.tsx";
import { ProgressIndicator } from "../components/ProgressIndicator.tsx";
import { CommandDeck, type CommandDeckItem } from "../components/overlays/CommandDeck.tsx";
import { ReviewDeck } from "../components/overlays/ReviewDeck.tsx";
import { SymbolJumpDeck } from "../components/overlays/SymbolJumpDeck.tsx";
import { DeskPanel } from "../components/desk/DeskPanel.tsx";
import { DeskRuntimeStrip } from "../components/desk/DeskRuntimeStrip.tsx";
import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";
import type { WorkspaceId, WorkspaceMemoryState } from "../state/AppStore.ts";
import type { TaskTreeState } from "../taskTree.ts";
import { COLORS } from "../theme.ts";
import { LabWorkspace } from "./LabWorkspace.tsx";
import { MarketWorkspace } from "./MarketWorkspace.tsx";
import { MonitorWorkspace } from "./MonitorWorkspace.tsx";
import { PlanWorkspace } from "./PlanWorkspace.tsx";

export interface ChatScreenProps {
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
  startupBannerMode: string;
  allMessagesCount: number;
  overlayKind: "none" | "quick-actions" | "shortcuts" | "symbol-jump" | "review-desk";
  mode: "SAFE" | "ARMED";
  queuedPreview?: string;
  queuedCount: number;
  taskTree: TaskTreeState | null;
  backgroundTaskTree: TaskTreeState | null;
  runtimeInspector: RuntimeInspectorViewModel | null;
  cockpitModel: CockpitModel | null;
  selectedCockpitSectionIndex: number;
  isLoading: boolean;
  chatInputPlaceholder: string;
  quickActionContext: unknown;
  hasConversationMomentum: boolean;
  onSubmit: (value: string) => void | Promise<void>;
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
  commandPaletteItems: CommandDeckItem[];
  symbolJumpSymbols: string[];
  reviewDeskModel: PlanCockpitModel | null;
}

function renderWorkspace(model: CockpitModel): React.ReactElement {
  switch (model.workspace) {
    case "market":
      return <MarketWorkspace model={model} />;
    case "plan":
      return <PlanWorkspace model={model} />;
    case "lab":
      return <LabWorkspace model={model} />;
    case "monitor":
      return <MonitorWorkspace model={model} />;
    default:
      return <></>;
  }
}

export const ChatScreen: React.FC<ChatScreenProps> = (props) => {
  const [overlayIndex, setOverlayIndex] = useState(0);

  useEffect(() => {
    setOverlayIndex(0);
  }, [props.overlayKind]);

  useInput((input, key) => {
    if (props.overlayKind === "quick-actions") {
      if (key.upArrow) {
        setOverlayIndex((current) => (current - 1 + props.commandPaletteItems.length) % Math.max(1, props.commandPaletteItems.length));
      } else if (key.downArrow) {
        setOverlayIndex((current) => (current + 1) % Math.max(1, props.commandPaletteItems.length));
      } else if (key.return) {
        const item = props.commandPaletteItems[overlayIndex] ?? props.commandPaletteItems[0];
        if (item) {
          props.onStageOverlayCommand(item.command);
        }
      }
      return;
    }

    if (props.overlayKind === "symbol-jump") {
      if (key.upArrow) {
        setOverlayIndex((current) => (current - 1 + props.symbolJumpSymbols.length) % Math.max(1, props.symbolJumpSymbols.length));
      } else if (key.downArrow) {
        setOverlayIndex((current) => (current + 1) % Math.max(1, props.symbolJumpSymbols.length));
      } else if (key.return) {
        const symbol = props.symbolJumpSymbols[overlayIndex] ?? props.symbolJumpSymbols[0];
        if (symbol) {
          props.onJumpSymbol(symbol);
        }
      }
    }

    if (props.overlayKind === "review-desk" && key.return && props.reviewDeskModel?.sections[0]?.actions[0]) {
      props.onStageOverlayCommand(props.reviewDeskModel.sections[0].actions[0]!);
    }

    if (props.overlayKind === "none" && key.ctrl && input.toLowerCase() === "k") {
      props.onOpenQuickActions();
    }
  });

  const overlay = useMemo(() => {
    switch (props.overlayKind) {
      case "quick-actions":
        return <CommandDeck items={props.commandPaletteItems} selectedIndex={overlayIndex} />;
      case "symbol-jump":
        return <SymbolJumpDeck symbols={props.symbolJumpSymbols} selectedIndex={overlayIndex} />;
      case "review-desk":
        return <ReviewDeck plan={props.reviewDeskModel} />;
      default:
        return null;
    }
  }, [overlayIndex, props.commandPaletteItems, props.overlayKind, props.reviewDeskModel, props.symbolJumpSymbols]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <WorkspaceRail
        workspace={props.workspace}
        mode={props.mode}
        queuedCount={props.queuedCount}
        runtimeInspector={props.runtimeInspector}
        activityStatus={props.activityStatus ?? props.activeToolCall}
      />

      {overlay ? <Box marginBottom={1}>{overlay}</Box> : null}

      {props.workspace !== "desk" && props.cockpitModel ? (
        <Box marginBottom={1} flexDirection="column">
          <Text color={COLORS.BRASS} bold>
            {props.cockpitModel.title}
          </Text>
          <Text color={COLORS.DIM}>{props.cockpitModel.subtitle}</Text>
          <Text color={COLORS.DIM}>
            {props.cockpitModel.sections.map((section, index) => (
              `${index === props.selectedCockpitSectionIndex ? ">" : " "} ${section.label}`
            )).join("   ")}
          </Text>
          <Box marginTop={1}>
            {renderWorkspace(props.cockpitModel)}
          </Box>
        </Box>
      ) : null}

      {props.workspace === "desk" ? <DeskRuntimeStrip inspector={props.runtimeInspector} /> : null}

      {(props.taskTree || props.backgroundTaskTree || props.queuedPreview) ? (
        <DeskPanel eyebrow="Flow" title="Live routing queue" subtitle="Foreground, background, and follow-up flow stay visible here." tone="analysis" compact>
          {props.taskTree ? <Text color={COLORS.WHITE}>Foreground task active</Text> : null}
          {props.backgroundTaskTree ? <Text color={COLORS.DIM}>Background task tree active</Text> : null}
          {props.queuedPreview ? <Text color={COLORS.DIM}>Next · {props.queuedPreview}</Text> : null}
        </DeskPanel>
      ) : null}

      {props.isLoading && !props.isStreaming ? (
        <ProgressIndicator label="Routing request" status="Preparing the next terminal action..." />
      ) : null}

      {props.showStartupHint ? (
        <Text color={COLORS.DIM}>Use natural language, slash commands, or workspace routing keys to operate Gordon.</Text>
      ) : null}

      <Box flexGrow={1} flexDirection="column">
        <DeskPanel
          eyebrow={props.workspace === "desk" ? "Desk" : "Transcript"}
          title={props.workspace === "desk" ? "Live transcript" : "Conversation log"}
          subtitle={props.busy ? "Live routing active." : "Stable desk transcript."}
          tone={props.workspace === "desk" ? "brand" : "muted"}
        >
          <ChatView
            messages={props.visibleMessages}
            hiddenBefore={props.hiddenBefore}
            hiddenAfter={props.hiddenAfter}
            isPinnedBottom={props.isPinnedBottom}
            activeStreamingTimestamp={props.activeStreamingTimestamp}
          />
        </DeskPanel>
      </Box>

      <ChatInput
        placeholder={props.isLoading || props.isStreaming ? "Waiting for response..." : props.chatInputPlaceholder}
        busy={props.busy}
        canCancel={props.canCancel}
        seedValue={props.seedValue}
        seedNonce={props.seedNonce}
        disabled={props.overlayKind !== "none"}
        onSubmit={props.onSubmit}
        onCancel={props.onCancel}
        onDraftChange={props.onDraftChange}
        onTypingStateChange={props.onTypingStateChange}
        onWorkspaceShortcut={props.onWorkspaceShortcut}
      />
    </Box>
  );
};

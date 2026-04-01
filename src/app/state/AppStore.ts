import { EventEmitter } from "node:events";
import type { ConfigLayers } from "../../infra/storage/config.ts";
import type { SessionInfo } from "../../infra/storage/session.ts";
import type { Mode } from "../../types/index.ts";
import type { ScanExportData, AnalysisExportData, BacktestExportData } from "../commands/export.ts";
import { normalizeChatMessage, type ChatMessage } from "../ChatView.tsx";
import type { ChainStatusInfo, ThreadStatusInfo } from "../StatusBar.tsx";
import type { OverlayState } from "../overlayState.ts";
import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";
import type { SetupWizardMode, SetupWizardSection } from "../setup-flow.ts";
import type { TaskTreeState } from "../taskTree.ts";

export type AppView =
  | "loading"
  | "onboarding"
  | "quickstart"
  | "setup"
  | "doctor"
  | "model"
  | "welcome"
  | "menu"
  | "chat";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export type QueuedSubmissionKind = "follow-up" | "steer";

export interface QueuedSubmission {
  id: string;
  kind: QueuedSubmissionKind;
  value: string;
  preview: string;
}

export interface AppState {
  view: AppView;
  mode: Mode;
  portfolioValue: number | undefined;
  availableCash: number;
  connectionStatus: "connected" | "disconnected" | "connecting";
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingMessageTimestamp: string | null;
  activeToolCall: string | null;
  activityStatus: string | null;
  taskTree: TaskTreeState | null;
  backgroundTaskTree: TaskTreeState | null;
  conversationHistory: ConversationMessage[];
  btcPrice: number | undefined;
  overlay: OverlayState;
  queuedSubmissions: QueuedSubmission[];
  showStartupHint: boolean;
  transcriptBottomOffset: number;
  isUserTyping: boolean;
  chatInputSeed: string;
  chatInputSeedNonce: number;
  setupMode: SetupWizardMode;
  setupSection: SetupWizardSection | null;
  session: SessionInfo | null;
  threadStatusInfo: ThreadStatusInfo | null;
  chainStatus: ChainStatusInfo | null;
  configLayers: ConfigLayers | null;
  runtimeInspector: RuntimeInspectorViewModel | null;
}

export interface LastResults {
  scan?: ScanExportData;
  analysis?: AnalysisExportData;
  backtest?: BacktestExportData;
  portfolio?: Record<string, unknown>;
  technicalAnalysis?: Record<string, unknown>;
  regime?: Record<string, unknown>;
  toolResults?: Record<string, Record<string, unknown>>;
}

export interface AppStateStore {
  getState(): AppState;
  setState(updater: (previous: AppState) => AppState): AppState;
  patchState(patch: Partial<AppState>): AppState;
  updateMessages(updater: (messages: ChatMessage[]) => ChatMessage[]): AppState;
  appendMessages(messages: ChatMessage[]): AppState;
  replaceMessages(messages: ChatMessage[]): AppState;
  setView(view: AppView): AppState;
  setRuntimeInspector(runtimeInspector: RuntimeInspectorViewModel | null): AppState;
  subscribe(listener: () => void): () => void;
}

export function createInitialAppState(input: {
  setupMode: SetupWizardMode;
  setupSection: SetupWizardSection | null;
  overlay: OverlayState;
}): AppState {
  return {
    view: "loading",
    mode: "SAFE",
    portfolioValue: undefined,
    availableCash: 0,
    connectionStatus: "disconnected",
    messages: [],
    isLoading: false,
    isStreaming: false,
    streamingMessageTimestamp: null,
    activeToolCall: null,
    activityStatus: null,
    taskTree: null,
    backgroundTaskTree: null,
    conversationHistory: [],
    btcPrice: undefined,
    overlay: input.overlay,
    queuedSubmissions: [],
    showStartupHint: true,
    transcriptBottomOffset: 0,
    isUserTyping: false,
    chatInputSeed: "",
    chatInputSeedNonce: 0,
    setupMode: input.setupMode,
    setupSection: input.setupSection,
    session: null,
    threadStatusInfo: null,
    chainStatus: null,
    configLayers: null,
    runtimeInspector: null,
  };
}

export function createAppStore(initialState: AppState): AppStateStore {
  const emitter = new EventEmitter();
  let state = initialState;

  const setState = (updater: (previous: AppState) => AppState): AppState => {
    const nextState = updater(state);
    if (Object.is(nextState, state)) {
      return state;
    }
    state = nextState;
    emitter.emit("change");
    return state;
  };

  const normalizeMessages = (messages: ChatMessage[]): ChatMessage[] =>
    messages.map((message) => normalizeChatMessage(message));

  return {
    getState(): AppState {
      return state;
    },
    setState,
    patchState(patch: Partial<AppState>): AppState {
      return setState((previous) => ({
        ...previous,
        ...patch,
      }));
    },
    updateMessages(updater: (messages: ChatMessage[]) => ChatMessage[]): AppState {
      return setState((previous) => ({
        ...previous,
        messages: normalizeMessages(updater(previous.messages)),
      }));
    },
    appendMessages(messages: ChatMessage[]): AppState {
      if (messages.length === 0) {
        return state;
      }
      return setState((previous) => ({
        ...previous,
        messages: [...previous.messages, ...normalizeMessages(messages)],
      }));
    },
    replaceMessages(messages: ChatMessage[]): AppState {
      return setState((previous) => ({
        ...previous,
        messages: normalizeMessages([...messages]),
      }));
    },
    setView(view: AppView): AppState {
      return setState((previous) => ({
        ...previous,
        view,
      }));
    },
    setRuntimeInspector(runtimeInspector: RuntimeInspectorViewModel | null): AppState {
      return setState((previous) => ({
        ...previous,
        runtimeInspector,
      }));
    },
    subscribe(listener: () => void): () => void {
      emitter.on("change", listener);
      return () => {
        emitter.off("change", listener);
      };
    },
  };
}

export function parseQueuedSubmission(value: string): {
  kind: QueuedSubmissionKind;
  submitValue: string;
  preview: string;
} | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const steeringMatch = trimmed.match(/^\/steer\s+(.+)$/isu);
  if (steeringMatch) {
    const submitValue = steeringMatch[1]?.trim();
    if (!submitValue) {
      return null;
    }
    return {
      kind: "steer",
      submitValue,
      preview: submitValue,
    };
  }

  return {
    kind: "follow-up",
    submitValue: trimmed,
    preview: trimmed,
  };
}

export function getMaxTranscriptBottomOffset(
  state: Pick<AppState, "messages" | "isStreaming" | "taskTree" | "backgroundTaskTree">,
  visibleLimit: number,
): number {
  return Math.max(0, state.messages.length - visibleLimit);
}

export function clampTranscriptBottomOffset(
  state: Pick<AppState, "messages" | "isStreaming" | "taskTree" | "backgroundTaskTree">,
  visibleLimit: number,
  requestedOffset: number,
): number {
  return Math.max(0, Math.min(requestedOffset, getMaxTranscriptBottomOffset(state, visibleLimit)));
}

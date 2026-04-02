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

export type WorkspaceId =
  | "desk"
  | "market"
  | "plan"
  | "lab"
  | "monitor";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PortfolioHoldingSummary {
  asset: string;
  amount: number;
  usdtValue: number;
  wallet?: string;
  note?: string;
}

export interface PortfolioWorkspaceSnapshot {
  message: string;
  totalValue: number;
  availableCash: number;
  holdings: PortfolioHoldingSummary[];
  executionTime?: number;
}

export interface PositionWorkspaceRow {
  symbol: string;
  status: string;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  minutesOpen: number;
}

export interface PositionsWorkspaceSnapshot {
  message: string;
  count: number;
  totalUnrealized: number;
  positions: PositionWorkspaceRow[];
  alerts: string[];
}

export interface OrderWorkspaceRow {
  symbol: string;
  side: string;
  type: string;
  status: string;
  quantity: number | string;
  price: number | string;
  executedQty: number | string;
}

export interface OrdersWorkspaceSnapshot {
  message: string;
  count: number;
  symbolFilter?: string;
  orders: OrderWorkspaceRow[];
}

export interface WorkflowWorkspaceStepSummary {
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  message?: string;
  duration?: number;
}

export interface WorkflowWorkspaceSnapshot {
  workflow: string;
  success: boolean;
  summary: string;
  steps: WorkflowWorkspaceStepSummary[];
}

export interface WorkspaceMemoryState {
  market: {
    focusSymbol?: string;
    focusWorkflow?: string;
  };
  plan: {
    selectedPlanId?: string;
    focusSymbol?: string;
  };
  lab: {
    selectedStrategyId?: string;
    selectedSource?: "built-in" | "generated" | "playbook" | "systematic";
  };
  monitor: {
    focusSection?: "book" | "positions" | "runtime";
    focusSymbol?: string;
  };
}

export interface WorkspaceInteractionState {
  market: {
    selectedCardIndex: number;
  };
  plan: {
    selectedCardIndex: number;
  };
  lab: {
    selectedCardIndex: number;
  };
  monitor: {
    selectedCardIndex: number;
  };
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
  workspace: WorkspaceId;
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
  chatDraft: string;
  chatInputSeed: string;
  chatInputSeedNonce: number;
  setupMode: SetupWizardMode;
  setupSection: SetupWizardSection | null;
  session: SessionInfo | null;
  threadStatusInfo: ThreadStatusInfo | null;
  chainStatus: ChainStatusInfo | null;
  configLayers: ConfigLayers | null;
  runtimeInspector: RuntimeInspectorViewModel | null;
  workspaceMemory: WorkspaceMemoryState;
  workspaceInteraction: WorkspaceInteractionState;
}

export interface LastResults {
  scan?: ScanExportData;
  analysis?: AnalysisExportData;
  backtest?: BacktestExportData;
  portfolio?: Record<string, unknown>;
  technicalAnalysis?: Record<string, unknown>;
  regime?: Record<string, unknown>;
  portfolioSummary?: PortfolioWorkspaceSnapshot;
  positionsSummary?: PositionsWorkspaceSnapshot;
  ordersSummary?: OrdersWorkspaceSnapshot;
  workflowSummary?: WorkflowWorkspaceSnapshot;
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
  setWorkspace(workspace: WorkspaceId): AppState;
  setRuntimeInspector(runtimeInspector: RuntimeInspectorViewModel | null): AppState;
  updateWorkspaceMemory<K extends keyof WorkspaceMemoryState>(
    workspace: K,
    patch: Partial<WorkspaceMemoryState[K]>,
  ): AppState;
  setWorkspaceSelection<K extends keyof WorkspaceInteractionState>(
    workspace: K,
    selectedCardIndex: number,
  ): AppState;
  subscribe(listener: () => void): () => void;
}

export function createInitialAppState(input: {
  setupMode: SetupWizardMode;
  setupSection: SetupWizardSection | null;
  overlay: OverlayState;
}): AppState {
  return {
    view: "loading",
    workspace: "desk",
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
    chatDraft: "",
    chatInputSeed: "",
    chatInputSeedNonce: 0,
    setupMode: input.setupMode,
    setupSection: input.setupSection,
    session: null,
    threadStatusInfo: null,
    chainStatus: null,
    configLayers: null,
    runtimeInspector: null,
    workspaceMemory: {
      market: {},
      plan: {},
      lab: {},
      monitor: {},
    },
    workspaceInteraction: {
      market: { selectedCardIndex: 0 },
      plan: { selectedCardIndex: 0 },
      lab: { selectedCardIndex: 0 },
      monitor: { selectedCardIndex: 0 },
    },
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
    setWorkspace(workspace: WorkspaceId): AppState {
      return setState((previous) => ({
        ...previous,
        workspace,
      }));
    },
    setRuntimeInspector(runtimeInspector: RuntimeInspectorViewModel | null): AppState {
      return setState((previous) => ({
        ...previous,
        runtimeInspector,
      }));
    },
    updateWorkspaceMemory<K extends keyof WorkspaceMemoryState>(
      workspace: K,
      patch: Partial<WorkspaceMemoryState[K]>,
    ): AppState {
      return setState((previous) => ({
        ...previous,
        workspaceMemory: {
          ...previous.workspaceMemory,
          [workspace]: {
            ...previous.workspaceMemory[workspace],
            ...patch,
          },
        },
      }));
    },
    setWorkspaceSelection<K extends keyof WorkspaceInteractionState>(
      workspace: K,
      selectedCardIndex: number,
    ): AppState {
      return setState((previous) => ({
        ...previous,
        workspaceInteraction: {
          ...previous.workspaceInteraction,
          [workspace]: {
            selectedCardIndex: Math.max(0, selectedCardIndex),
          },
        },
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

import type { RuntimeInspectorViewModel } from "./presenters/RuntimePresenter.ts";
import type {
  LastResults,
  WorkspaceMemoryState,
  WorkspaceId,
} from "./state/AppStore.ts";
import type { DeskTone } from "./components/desk/DeskPanel.tsx";
import type { Plan } from "../types/plan.ts";

export interface WorkspaceRowViewModel {
  label: string;
  value: string;
  detail?: string;
  tone?: DeskTone;
}

export interface WorkspaceStrategyInventorySnapshot {
  builtInStrategyCount: number;
  builtInTier1Count: number;
  builtInTier2Count: number;
  builtInStrategies: Array<{
    id: string;
    name: string;
    riskLevel: string;
    timeframes: string[];
  }>;
  generatedStrategies: Array<{
    id: string;
    name: string;
    riskLevel?: string;
    timeframes?: string[];
    backtestReturn?: number;
    backtestSharpe?: number;
  }>;
  playbookCount: number;
  playbooks: Array<{
    id: string;
    name: string;
    riskLevel: string;
    timeframes: string[];
  }>;
  systematicProfileCount: number;
  systematicLiveEligibleCount: number;
  systematicProfiles: Array<{
    strategyId: string;
    strategyName: string;
    status: string;
    validationScore: number;
    marketFamily: string;
    liveEligible: boolean;
    capitalWeight: number;
  }>;
  researchExperimentCount: number;
  researchExperiments: Array<{
    experimentId: string;
    strategyId: string;
    strategyName: string;
    status: string;
  }>;
  diversificationScore?: number;
  concentrationRisk?: string;
}

export interface WorkspaceViewInput {
  workspace: Exclude<WorkspaceId, "desk">;
  mode: "SAFE" | "ARMED";
  hasExchange: boolean;
  hasBroker: boolean;
  hasWalletRails: boolean;
  hasMcpServers: boolean;
  runtimeInspector: RuntimeInspectorViewModel | null;
  queuedCount: number;
  lastResults: LastResults;
  plans: Plan[];
  workspaceMemory: WorkspaceMemoryState;
  strategyInventory: WorkspaceStrategyInventorySnapshot;
  planReview: {
    portfolioValue: number;
    availableCash: number;
    maxAllocationPerTrade: number;
    cashReservePercent: number;
  };
}

export type WorkspaceBoardRowViewModel = WorkspaceRowViewModel;
export type WorkspaceBoardViewInput = WorkspaceViewInput;

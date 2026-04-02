import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { GORDON_DIR } from "../infra/storage/paths.ts";
import type {
  LastResults,
  WorkspaceId,
  WorkspaceInteractionState,
  WorkspaceMemoryState,
} from "./state/AppStore.ts";

const WORKSPACE_SHELL_STATE_VERSION = 2;

export interface PersistedWorkspaceShellState {
  version: number;
  savedAt: string;
  workspace: WorkspaceId;
  workspaceMemory: WorkspaceMemoryState;
  workspaceInteraction: WorkspaceInteractionState;
  lastResults: Pick<
    LastResults,
    | "scan"
    | "analysis"
    | "backtest"
    | "regime"
    | "portfolioSummary"
    | "positionsSummary"
    | "ordersSummary"
    | "workflowSummary"
  >;
}

interface WorkspaceShellStateFileOptions {
  filePath?: string;
}

function getWorkspaceShellStatePath(options: WorkspaceShellStateFileOptions = {}): string {
  return options.filePath ?? join(GORDON_DIR, "workspace-shell-state.json");
}

function defaultWorkspaceMemory(): WorkspaceMemoryState {
  return {
    market: {},
    plan: {},
    lab: {},
    monitor: {},
  };
}

function defaultWorkspaceInteraction(): WorkspaceInteractionState {
  return {
    market: { selectedCardIndex: 0 },
    plan: { selectedCardIndex: 0 },
    lab: { selectedCardIndex: 0 },
    monitor: { selectedCardIndex: 0 },
  };
}

function isWorkspaceId(value: unknown): value is WorkspaceId {
  return value === "desk"
    || value === "market"
    || value === "plan"
    || value === "lab"
    || value === "monitor";
}

function normalizeWorkspaceMemory(value: unknown): WorkspaceMemoryState {
  const fallback = defaultWorkspaceMemory();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const input = value as Record<string, unknown>;
  return {
    market: typeof input.market === "object" && input.market !== null
      ? {
          focusSymbol: typeof (input.market as Record<string, unknown>).focusSymbol === "string"
            ? (input.market as Record<string, unknown>).focusSymbol as string
            : undefined,
          focusWorkflow: typeof (input.market as Record<string, unknown>).focusWorkflow === "string"
            ? (input.market as Record<string, unknown>).focusWorkflow as string
            : undefined,
        }
      : fallback.market,
    plan: typeof input.plan === "object" && input.plan !== null
      ? {
          selectedPlanId: typeof (input.plan as Record<string, unknown>).selectedPlanId === "string"
            ? (input.plan as Record<string, unknown>).selectedPlanId as string
            : undefined,
          focusSymbol: typeof (input.plan as Record<string, unknown>).focusSymbol === "string"
            ? (input.plan as Record<string, unknown>).focusSymbol as string
            : undefined,
        }
      : fallback.plan,
    lab: typeof input.lab === "object" && input.lab !== null
      ? {
          selectedStrategyId: typeof (input.lab as Record<string, unknown>).selectedStrategyId === "string"
            ? (input.lab as Record<string, unknown>).selectedStrategyId as string
            : undefined,
          selectedSource: typeof (input.lab as Record<string, unknown>).selectedSource === "string"
            ? (input.lab as Record<string, unknown>).selectedSource as WorkspaceMemoryState["lab"]["selectedSource"]
            : undefined,
        }
      : fallback.lab,
    monitor: typeof input.monitor === "object" && input.monitor !== null
      ? {
          focusSection: typeof (input.monitor as Record<string, unknown>).focusSection === "string"
            ? (input.monitor as Record<string, unknown>).focusSection as WorkspaceMemoryState["monitor"]["focusSection"]
            : undefined,
          focusSymbol: typeof (input.monitor as Record<string, unknown>).focusSymbol === "string"
            ? (input.monitor as Record<string, unknown>).focusSymbol as string
            : undefined,
        }
      : fallback.monitor,
  };
}

function normalizeWorkspaceInteraction(value: unknown): WorkspaceInteractionState {
  const fallback = defaultWorkspaceInteraction();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const input = value as Record<string, unknown>;
  const normalizeSelectedCardIndex = (workspace: keyof WorkspaceInteractionState): number => {
    const candidate = input[workspace];
    if (!candidate || typeof candidate !== "object") {
      return 0;
    }
    const selectedCardIndex = (candidate as Record<string, unknown>).selectedCardIndex;
    return typeof selectedCardIndex === "number" && Number.isFinite(selectedCardIndex)
      ? Math.max(0, Math.floor(selectedCardIndex))
      : 0;
  };

  return {
    market: { selectedCardIndex: normalizeSelectedCardIndex("market") },
    plan: { selectedCardIndex: normalizeSelectedCardIndex("plan") },
    lab: { selectedCardIndex: normalizeSelectedCardIndex("lab") },
    monitor: { selectedCardIndex: normalizeSelectedCardIndex("monitor") },
  };
}

export async function loadWorkspaceShellState(
  options: WorkspaceShellStateFileOptions = {},
): Promise<PersistedWorkspaceShellState | null> {
  const filePath = getWorkspaceShellStatePath(options);
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  try {
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    const workspace = isWorkspaceId(parsed.workspace) ? parsed.workspace : "desk";
    const lastResults = parsed.lastResults && typeof parsed.lastResults === "object"
      ? parsed.lastResults as PersistedWorkspaceShellState["lastResults"]
      : {};

    return {
      version: typeof parsed.version === "number" ? parsed.version : WORKSPACE_SHELL_STATE_VERSION,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
      workspace,
      workspaceMemory: normalizeWorkspaceMemory(parsed.workspaceMemory),
      workspaceInteraction: normalizeWorkspaceInteraction(parsed.workspaceInteraction),
      lastResults,
    };
  } catch {
    return null;
  }
}

export async function saveWorkspaceShellState(
  snapshot: Omit<PersistedWorkspaceShellState, "version" | "savedAt">,
  options: WorkspaceShellStateFileOptions = {},
): Promise<void> {
  const filePath = getWorkspaceShellStatePath(options);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify({
    version: WORKSPACE_SHELL_STATE_VERSION,
    savedAt: new Date().toISOString(),
    ...snapshot,
  }, null, 2));
}

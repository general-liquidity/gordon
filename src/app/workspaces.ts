import type { WorkspaceId } from "./state/AppStore.ts";

export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  shortLabel: string;
  description: string;
  command: string;
  cue: string;
}

export const WORKSPACES: WorkspaceDefinition[] = [
  {
    id: "desk",
    label: "Desk",
    shortLabel: "Desk",
    description: "Reason, delegate, and operate from the live trading desk.",
    command: "/desk",
    cue: "Conversation, approvals, and live routing.",
  },
  {
    id: "market",
    label: "Market",
    shortLabel: "Market",
    description: "Turn the tape into a shortlist.",
    command: "/market",
    cue: "Scan movers, regime, and symbol context.",
  },
  {
    id: "plan",
    label: "Plan",
    shortLabel: "Plan",
    description: "Review tickets before action.",
    command: "/plans",
    cue: "Trade thesis, sizing, invalidation, and approvals.",
  },
  {
    id: "lab",
    label: "Lab",
    shortLabel: "Lab",
    description: "Build, compare, and validate strategies.",
    command: "/lab",
    cue: "Strategies, playbooks, backtests, and systematic research.",
  },
  {
    id: "monitor",
    label: "Monitor",
    shortLabel: "Monitor",
    description: "Supervise capital, runtime, and live state.",
    command: "/monitor",
    cue: "Book, orders, health, runtime, and bridge activity.",
  },
];

const WORKSPACE_MAP = new Map<WorkspaceId, WorkspaceDefinition>(
  WORKSPACES.map((workspace) => [workspace.id, workspace]),
);

export function getWorkspaceDefinition(workspace: WorkspaceId): WorkspaceDefinition {
  return WORKSPACE_MAP.get(workspace) ?? WORKSPACES[0]!;
}

export function getWorkspaceIndex(workspace: WorkspaceId): number {
  const index = WORKSPACES.findIndex((entry) => entry.id === workspace);
  return index >= 0 ? index : 0;
}

export function getNextWorkspace(workspace: WorkspaceId): WorkspaceId {
  const index = getWorkspaceIndex(workspace);
  return WORKSPACES[(index + 1) % WORKSPACES.length]?.id ?? "desk";
}

export function getPreviousWorkspace(workspace: WorkspaceId): WorkspaceId {
  const index = getWorkspaceIndex(workspace);
  const nextIndex = (index - 1 + WORKSPACES.length) % WORKSPACES.length;
  return WORKSPACES[nextIndex]?.id ?? "desk";
}

export function getWorkspaceByShortcut(shortcut: string): WorkspaceId | null {
  const index = Number.parseInt(shortcut, 10);
  if (!Number.isFinite(index) || index < 1 || index > WORKSPACES.length) {
    return null;
  }

  return WORKSPACES[index - 1]?.id ?? null;
}

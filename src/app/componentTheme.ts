import type { WorkflowGroup } from "./commandUx.ts";
import type { TaskTreeNode, TaskTreeNodeStatus } from "./taskTree.ts";
import { COLORS } from "./theme.ts";

export function getWorkflowAccent(workflow?: WorkflowGroup): string {
  switch (workflow) {
    case "discover":
      return COLORS.DISCOVER;
    case "analyze":
      return COLORS.ANALYZE;
    case "trade":
      return COLORS.TRADE;
    case "run":
      return COLORS.RUN;
    case "accounts":
      return COLORS.RAILS;
    case "operate":
      return COLORS.OPERATE;
    default:
      return COLORS.HIGHLIGHT;
  }
}

export function getQuickActionTokens(workflow: WorkflowGroup | undefined, isSelected: boolean): {
  cue: string;
  label: string;
  command: string;
} {
  const accent = getWorkflowAccent(workflow);
  return {
    cue: isSelected ? accent : COLORS.DIM,
    label: isSelected ? COLORS.WHITE : COLORS.SECONDARY,
    command: accent,
  };
}

export function getAutocompleteTokens(workflow: WorkflowGroup, isSelected: boolean): {
  accent: string;
  label: string;
  description: string;
  prompt: string;
} {
  const accent = getWorkflowAccent(workflow);
  return {
    accent: isSelected ? accent : COLORS.ACCENT_DIM,
    label: isSelected ? COLORS.WHITE : COLORS.WHITE,
    description: isSelected ? COLORS.WHITE : COLORS.DIM,
    prompt: isSelected ? COLORS.HIGHLIGHT : COLORS.DIM,
  };
}

export function getTaskTreeTokens(node: Pick<TaskTreeNode, "kind" | "meta">, status: TaskTreeNodeStatus, isActiveLeaf: boolean): {
  status: string;
  label: string;
  detail: string;
} {
  let statusColor: string = COLORS.DIM;
  switch (status) {
    case "running":
      statusColor = COLORS.HIGHLIGHT;
      break;
    case "completed":
      statusColor = COLORS.SUCCESS;
      break;
    case "failed":
      statusColor = COLORS.ERROR;
      break;
    case "cancelled":
      statusColor = COLORS.WARNING;
      break;
    case "blocked":
      statusColor = COLORS.ERROR;
      break;
    case "queued":
      statusColor = COLORS.DISCOVER;
      break;
  }

  let label: string = COLORS.WHITE;
  if (node.kind === "request") {
    label = COLORS.ACCENT;
  } else if (node.kind === "family") {
    const workflow = node.meta?.workflow as WorkflowGroup | undefined;
    label = getWorkflowAccent(workflow);
  } else if (node.kind === "queue") {
    label = COLORS.OPERATE;
  }

  if (isActiveLeaf) {
    label = COLORS.WHITE;
  }

  return {
    status: statusColor,
    label,
    detail: COLORS.DIM,
  };
}

export function getAlertAccent(variant: "info" | "warning" | "error" | "success"): string {
  switch (variant) {
    case "info":
      return COLORS.DISCOVER;
    case "warning":
      return COLORS.WARNING;
    case "error":
      return COLORS.ERROR;
    case "success":
    default:
      return COLORS.SUCCESS;
  }
}

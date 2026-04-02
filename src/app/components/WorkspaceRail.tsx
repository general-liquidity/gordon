import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";
import type { WorkspaceId, WorkspaceMemoryState } from "../state/AppStore.ts";
import { getWorkspaceDefinition, WORKSPACES } from "../workspaces.ts";
import { DeskRail } from "./desk/DeskRail.tsx";

interface WorkspaceRailProps {
  workspace: WorkspaceId;
  mode: "SAFE" | "ARMED";
  queuedCount: number;
  workspaceMemory: WorkspaceMemoryState;
}

function describeWorkspaceFocus(
  workspace: WorkspaceId,
  workspaceMemory: WorkspaceMemoryState,
): string | null {
  if (workspace === "market") {
    return workspaceMemory.market.focusSymbol
      ? `focus ${workspaceMemory.market.focusSymbol}`
      : workspaceMemory.market.focusWorkflow
        ? `workflow ${workspaceMemory.market.focusWorkflow}`
        : null;
  }

  if (workspace === "plan") {
    if (workspaceMemory.plan.focusSymbol && workspaceMemory.plan.selectedPlanId) {
      return `${workspaceMemory.plan.focusSymbol} · ${workspaceMemory.plan.selectedPlanId}`;
    }
    return workspaceMemory.plan.focusSymbol ?? workspaceMemory.plan.selectedPlanId ?? null;
  }

  if (workspace === "lab") {
    if (workspaceMemory.lab.selectedStrategyId && workspaceMemory.lab.selectedSource) {
      return `${workspaceMemory.lab.selectedStrategyId} · ${workspaceMemory.lab.selectedSource}`;
    }
    return workspaceMemory.lab.selectedStrategyId ?? workspaceMemory.lab.selectedSource ?? null;
  }

  if (workspace === "monitor") {
    if (workspaceMemory.monitor.focusSection && workspaceMemory.monitor.focusSymbol) {
      return `${workspaceMemory.monitor.focusSection} · ${workspaceMemory.monitor.focusSymbol}`;
    }
    return workspaceMemory.monitor.focusSection ?? workspaceMemory.monitor.focusSymbol ?? null;
  }

  return null;
}

export function WorkspaceRail({
  workspace,
  mode,
  queuedCount,
  workspaceMemory,
}: WorkspaceRailProps): React.ReactElement {
  const activeWorkspace = getWorkspaceDefinition(workspace);
  const focusText = describeWorkspaceFocus(workspace, workspaceMemory);
  const stateTokens = [
    mode,
    focusText ? `focus ${focusText}` : null,
    queuedCount > 0 ? `queue ${queuedCount}` : "queue clear",
  ].filter(Boolean) as string[];

  return (
    <DeskRail
      title="Gordon"
      subtitle={`${activeWorkspace.label} mandate · ${activeWorkspace.cue}`}
      tone="brand"
    >
      <Box flexWrap="wrap">
        {WORKSPACES.map((item, index) => {
          const isActive = item.id === workspace;
          return (
            <Box key={item.id} marginRight={2}>
              <Text color={isActive ? COLORS.WHITE : COLORS.DIM} bold={isActive}>
                {isActive ? `${index + 1} ${item.label}` : `${index + 1} ${item.label}`}
              </Text>
              {index < WORKSPACES.length - 1 && (
                <Text color={COLORS.BRASS_DIM}>  </Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1} flexWrap="wrap">
        {stateTokens.map((token, index) => (
          <Text
            key={`${token}-${index}`}
            color={index === 0
              ? mode === "ARMED" ? COLORS.RISK : COLORS.MONEY
              : COLORS.DIM}
            bold={index === 0}
          >
            {index > 0 ? " · " : ""}{token}
          </Text>
        ))}
        <Text color={COLORS.DIM}>
          {" "}· [ ] cycle · 1-5 switch
        </Text>
      </Box>
    </DeskRail>
  );
}

export default WorkspaceRail;

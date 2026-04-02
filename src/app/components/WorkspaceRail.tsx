import React from "react";
import { Box, Text } from "ink";

import type { RuntimeInspectorViewModel } from "../presenters/RuntimePresenter.ts";
import type { WorkspaceId } from "../state/AppStore.ts";
import { COLORS } from "../theme.ts";
import { WORKSPACES } from "../workspaces.ts";

export const WorkspaceRail: React.FC<{
  workspace: WorkspaceId;
  mode: "SAFE" | "ARMED";
  queuedCount: number;
  runtimeInspector: RuntimeInspectorViewModel | null;
  activityStatus?: string | null;
}> = ({ workspace, mode, queuedCount, runtimeInspector, activityStatus }) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={COLORS.BRASS} bold>
        GORDON DESK
        <Text color={COLORS.DIM}>  {WORKSPACES.find((entry) => entry.id === workspace)?.label.toUpperCase() ?? "DESK"}</Text>
        <Text color={mode === "ARMED" ? COLORS.RISK : COLORS.MONEY}>  {mode}</Text>
      </Text>
      <Box>
        {WORKSPACES.map((entry, index) => (
          <Text key={entry.id} color={entry.id === workspace ? COLORS.BRASS : COLORS.DIM}>
            {index + 1} {entry.label}
            <Text color={COLORS.DIM}>   </Text>
          </Text>
        ))}
      </Box>
      <Text color={COLORS.WHITE}>
        {activityStatus ?? WORKSPACES.find((entry) => entry.id === workspace)?.cue ?? "Live routing."}
      </Text>
      <Text color={COLORS.DIM}>
        queue {queuedCount}
        {"  "}
        approvals {runtimeInspector?.pendingApprovalCount ?? 0}
        {"  "}
        background {runtimeInspector?.backgroundTaskCount ?? 0}
        {"  "}
        bridge {runtimeInspector?.activeBridgeSessions ?? 0}
        {"  "}
        [ ] cycle
      </Text>
    </Box>
  );
};


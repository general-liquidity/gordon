import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";
import type { PlanWorkspaceApprovalModel } from "../../workspaceSurfaces.ts";

interface ApprovalDrawerProps {
  approval: PlanWorkspaceApprovalModel;
}

export function ApprovalDrawer({ approval }: ApprovalDrawerProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap">
        <Text color={COLORS.DIM}>Mode</Text>
        <Text color={approval.mode === "ARMED" ? COLORS.RISK : COLORS.MONEY}> {approval.mode}</Text>
        <Text color={COLORS.DIM}>  Route</Text>
        <Text color={approval.route.includes("online") ? COLORS.ORANGE : COLORS.RISK}> {approval.route}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {approval.rows.length === 0 ? (
          <>
            <Text color={COLORS.WHITE}>No approvals in lane.</Text>
            <Text color={COLORS.DIM}>Explicit sign-off appears here before routed execution.</Text>
          </>
        ) : (
          approval.rows.map((row) => (
            <Box key={row.id} flexDirection="column" marginBottom={1}>
              <Box flexWrap="wrap">
                <Text color={COLORS.BRASS} bold>{row.id}</Text>
                <Text color={COLORS.DIM}> · </Text>
                <Text color={COLORS.WHITE}>{row.tool}</Text>
              </Box>
              <Text color={COLORS.WHITE}>{row.summary}</Text>
              <Text color={COLORS.DIM}>{row.detail}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

export default ApprovalDrawer;

import React from "react";
import { Box, Text } from "ink";
import SurfaceFrame from "../workspace/SurfaceFrame.tsx";
import TicketSheet from "../workspace/TicketSheet.tsx";
import ApprovalDrawer from "../workspace/ApprovalDrawer.tsx";
import { FocusSelect } from "../PromptPrimitives.tsx";
import type { PlanWorkspaceApprovalModel, PlanWorkspaceTicketModel } from "../../workspaceSurfaces.ts";
import { COLORS } from "../../theme.ts";

interface ReviewDeskOverlayProps {
  ticket: PlanWorkspaceTicketModel | null;
  approvals: PlanWorkspaceApprovalModel | null;
  onStage: (command: string) => void;
}

export function ReviewDeskOverlay({
  ticket,
  approvals,
  onStage,
}: ReviewDeskOverlayProps): React.ReactElement {
  const actionHints = [
    ticket?.actions?.[0],
    approvals?.actions?.[0],
    ticket?.actions?.[1],
  ].filter(Boolean) as string[];

  return (
    <Box marginX={1} marginY={1} flexDirection="column">
      <SurfaceFrame
        eyebrow="Review Desk"
        title="Ticket and approval review"
        subtitle="Final review before you route back into the live desk."
        tone="warning"
        actions={actionHints}
        selected
      >
        <Box flexDirection="row">
          <Box width="60%" paddingRight={1}>
            <SurfaceFrame
              eyebrow="Ticket"
              title={ticket?.title ?? "No active ticket"}
              subtitle={ticket?.subtitle ?? "Create a plan to review thesis, sizing, and invalidation."}
              tone={ticket?.tone ?? "warning"}
            >
              {ticket ? (
                <TicketSheet ticket={ticket} />
              ) : (
                <Text color={COLORS.DIM}>No active ticket on the desk.</Text>
              )}
            </SurfaceFrame>
          </Box>
          <Box width="40%">
            <SurfaceFrame
              eyebrow="Approvals"
              title={approvals?.title ?? "Approval lane clear"}
              subtitle={approvals?.subtitle ?? "Blocking approvals will surface here."}
              tone={approvals?.tone ?? "success"}
            >
              {approvals ? (
                <ApprovalDrawer approval={approvals} />
              ) : (
                <Text color={COLORS.DIM}>No approval surface available.</Text>
              )}
            </SurfaceFrame>
          </Box>
        </Box>

        {actionHints.length > 0 && (
          <Box marginTop={1}>
            <FocusSelect
              title="Review actions"
              hint="Enter stages the selected review command."
              options={actionHints.map((command) => ({
                label: command,
                value: command,
              }))}
              onChange={onStage}
            />
          </Box>
        )}
      </SurfaceFrame>
    </Box>
  );
}

export default ReviewDeskOverlay;

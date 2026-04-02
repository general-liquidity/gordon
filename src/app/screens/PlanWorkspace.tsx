import React from "react";
import { Box } from "ink";
import SurfaceFrame from "../components/workspace/SurfaceFrame.tsx";
import TicketSheet from "../components/workspace/TicketSheet.tsx";
import ApprovalDrawer from "../components/workspace/ApprovalDrawer.tsx";
import DetailPane from "../components/workspace/DetailPane.tsx";
import DataTable from "../components/workspace/DataTable.tsx";
import type { PlanWorkspaceSurfaceModel } from "../workspaceSurfaces.ts";

interface PlanWorkspaceProps {
  model: PlanWorkspaceSurfaceModel;
  selectedSectionIndex?: number;
}

export function PlanWorkspace({
  model,
  selectedSectionIndex = 0,
}: PlanWorkspaceProps): React.ReactElement {
  const ticketSelected = selectedSectionIndex === 0;
  const approvalSelected = selectedSectionIndex === 1;
  const riskSelected = selectedSectionIndex === 2;
  const bookSelected = selectedSectionIndex === 3;

  return (
    <Box flexDirection="column" marginX={1} marginBottom={1}>
      <SurfaceFrame
        eyebrow="Plan Mandate"
        title={model.title}
        subtitle={model.subtitle}
        tone="brand"
      />

      <Box marginTop={1} flexDirection="row">
        <Box flexDirection="column" width="64%" paddingRight={1}>
          <SurfaceFrame
            eyebrow="Ticket Sheet"
            title={model.ticket.title}
            subtitle={model.ticket.subtitle}
            tone={model.ticket.tone}
            selected={ticketSelected}
            actions={model.ticket.actions}
          >
            <TicketSheet ticket={model.ticket} />
          </SurfaceFrame>

          <Box marginTop={1}>
            <SurfaceFrame
              eyebrow="Risk Ladder"
              title={model.risk.title}
              subtitle={model.risk.subtitle}
              tone={model.risk.tone}
              selected={riskSelected}
              actions={model.risk.actions}
            >
              <DetailPane rows={model.risk.rows} />
            </SurfaceFrame>
          </Box>
        </Box>

        <Box flexDirection="column" width="36%">
          <SurfaceFrame
            eyebrow="Approval Drawer"
            title={model.approvals.title}
            subtitle={model.approvals.subtitle}
            tone={model.approvals.tone}
            selected={approvalSelected}
            actions={model.approvals.actions}
          >
            <ApprovalDrawer approval={model.approvals} />
          </SurfaceFrame>

          <Box marginTop={1}>
            <SurfaceFrame
              eyebrow="Plan Book"
              title={model.book.title}
              subtitle={model.book.subtitle}
              tone={model.book.tone}
              selected={bookSelected}
              actions={model.book.actions}
            >
              <DataTable
                columns={[
                  { key: "symbol", label: "Symbol" },
                  { key: "status", label: "Status" },
                  { key: "strategy", label: "Strategy" },
                  { key: "allocation", label: "Alloc", align: "right" },
                  { key: "entry", label: "Entry", align: "right" },
                ]}
                rows={model.book.rows.map((row) => ({
                  id: row.planId,
                  tone: row.tone,
                  values: {
                    symbol: row.symbol,
                    status: row.status,
                    strategy: row.strategy,
                    allocation: row.allocation,
                    entry: row.entry,
                  },
                }))}
                emptyTitle="No stored tickets yet"
                emptyDetail="Create a plan and Gordon will keep it here for review and execution."
              />
            </SurfaceFrame>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default PlanWorkspace;

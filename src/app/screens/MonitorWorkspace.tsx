import React from "react";
import { Box } from "ink";
import SurfaceFrame from "../components/workspace/SurfaceFrame.tsx";
import DataTable from "../components/workspace/DataTable.tsx";
import DetailPane from "../components/workspace/DetailPane.tsx";
import type { MonitorWorkspaceSurfaceModel } from "../workspaceSurfaces.ts";

interface MonitorWorkspaceProps {
  model: MonitorWorkspaceSurfaceModel;
  selectedSectionIndex?: number;
}

export function MonitorWorkspace({
  model,
  selectedSectionIndex = 0,
}: MonitorWorkspaceProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginX={1} marginBottom={1}>
      <SurfaceFrame
        eyebrow="Monitor Mandate"
        title={model.title}
        subtitle={model.subtitle}
        tone="brand"
      />

      <Box marginTop={1} flexDirection="row">
        <Box flexDirection="column" width="58%" paddingRight={1}>
          <SurfaceFrame
            eyebrow="Book"
            title={model.book.title}
            subtitle={model.book.subtitle}
            tone={model.book.tone}
            selected={selectedSectionIndex === 0}
            actions={model.book.actions}
          >
            <DataTable
              columns={[
                { key: "symbol", label: "Asset" },
                { key: "quantity", label: "Qty", align: "right" },
                { key: "value", label: "Value", align: "right" },
                { key: "venue", label: "Venue" },
              ]}
              rows={model.book.rows.map((row) => ({
                id: row.symbol,
                tone: row.tone,
                values: {
                  symbol: row.symbol,
                  quantity: row.quantity,
                  value: row.value,
                  venue: row.venue,
                },
              }))}
              emptyTitle="No recent book snapshot"
              emptyDetail="Run /portfolio to pull the latest holdings and cash state."
            />
          </SurfaceFrame>

          <Box marginTop={1}>
            <SurfaceFrame
              eyebrow="Blotter"
              title={model.blotter.title}
              subtitle={model.blotter.subtitle}
              tone={model.blotter.tone}
              selected={selectedSectionIndex === 2}
              actions={model.blotter.actions}
            >
              <DataTable
                columns={[
                  { key: "lane", label: "Lane" },
                  { key: "symbol", label: "Symbol" },
                  { key: "status", label: "Status" },
                  { key: "exposure", label: "Exposure" },
                  { key: "note", label: "Note" },
                ]}
                rows={model.blotter.rows.map((row, index) => ({
                  id: `${row.lane}-${row.symbol}-${index}`,
                  tone: row.tone,
                  values: {
                    lane: row.lane,
                    symbol: row.symbol,
                    status: row.status,
                    exposure: row.exposure,
                    note: row.note,
                  },
                }))}
                emptyTitle="No recent position or order snapshot"
                emptyDetail="Run /positions and /orders to warm the blotter."
              />
            </SurfaceFrame>
          </Box>
        </Box>

        <Box flexDirection="column" width="42%">
          <SurfaceFrame
            eyebrow="Runtime Rail"
            title={model.runtime.title}
            subtitle={model.runtime.subtitle}
            tone={model.runtime.tone}
            selected={selectedSectionIndex === 1}
            actions={model.runtime.actions}
          >
            <DetailPane rows={model.runtime.rows} />
          </SurfaceFrame>

          <Box marginTop={1}>
            <SurfaceFrame
              eyebrow="Alert Feed"
              title={model.alerts.title}
              subtitle={model.alerts.subtitle}
              tone={model.alerts.tone}
              selected={selectedSectionIndex === 3}
              actions={model.alerts.actions}
            >
              <DataTable
                columns={[
                  { key: "heading", label: "Lane" },
                  { key: "status", label: "Status" },
                  { key: "note", label: "Note" },
                ]}
                rows={model.alerts.rows.map((row, index) => ({
                  id: `${row.heading}-${index}`,
                  tone: row.tone,
                  values: {
                    heading: row.heading,
                    status: row.status,
                    note: row.note,
                  },
                }))}
                emptyTitle="No live alerts"
                emptyDetail="Health and monitor-cycle issues will appear here before they become surprises."
              />
            </SurfaceFrame>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default MonitorWorkspace;

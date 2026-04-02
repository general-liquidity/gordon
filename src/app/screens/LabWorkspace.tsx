import React from "react";
import { Box } from "ink";
import SurfaceFrame from "../components/workspace/SurfaceFrame.tsx";
import DataTable from "../components/workspace/DataTable.tsx";
import DetailPane from "../components/workspace/DetailPane.tsx";
import type { LabWorkspaceSurfaceModel } from "../workspaceSurfaces.ts";

interface LabWorkspaceProps {
  model: LabWorkspaceSurfaceModel;
  selectedSectionIndex?: number;
}

export function LabWorkspace({
  model,
  selectedSectionIndex = 0,
}: LabWorkspaceProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginX={1} marginBottom={1}>
      <SurfaceFrame
        eyebrow="Lab Mandate"
        title={model.title}
        subtitle={model.subtitle}
        tone="brand"
      />

      <Box marginTop={1} flexDirection="row">
        <Box flexDirection="column" width="64%" paddingRight={1}>
          <SurfaceFrame
            eyebrow="Bench Focus"
            title={model.bench.title}
            subtitle={model.bench.subtitle}
            tone={model.bench.tone}
            selected={selectedSectionIndex === 0}
            actions={model.bench.actions}
          >
            <DataTable
              columns={[
                { key: "name", label: "Strategy" },
                { key: "source", label: "Source" },
                { key: "risk", label: "Risk" },
                { key: "signal", label: "Signal" },
              ]}
              rows={model.bench.rows.map((row) => ({
                id: row.id,
                tone: row.tone,
                active: row.id === model.bench.activeId,
                values: {
                  name: row.name,
                  source: row.source,
                  risk: row.risk,
                  signal: row.signal,
                },
              }))}
              emptyTitle={model.bench.emptyTitle}
              emptyDetail={model.bench.emptyDetail}
            />
          </SurfaceFrame>

          <Box marginTop={1}>
            <SurfaceFrame
              eyebrow="Validation Lane"
              title={model.validation.title}
              subtitle={model.validation.subtitle}
              tone={model.validation.tone}
              selected={selectedSectionIndex === 1}
              actions={model.validation.actions}
            >
              <DetailPane rows={model.validation.rows} notes={model.validation.notes} />
            </SurfaceFrame>
          </Box>
        </Box>

        <Box flexDirection="column" width="36%">
          <SurfaceFrame
            eyebrow="Systematic Slate"
            title={model.systematic.title}
            subtitle={model.systematic.subtitle}
            tone={model.systematic.tone}
            selected={selectedSectionIndex === 2}
            actions={model.systematic.actions}
          >
            <DetailPane rows={model.systematic.rows} notes={model.systematic.notes} />
          </SurfaceFrame>

          <Box marginTop={1}>
            <SurfaceFrame
              eyebrow="Registry Shelf"
              title={model.registry.title}
              subtitle={model.registry.subtitle}
              tone={model.registry.tone}
              selected={selectedSectionIndex === 3}
              actions={model.registry.actions}
            >
              <DataTable
                columns={[
                  { key: "name", label: "Name" },
                  { key: "kind", label: "Kind" },
                  { key: "risk", label: "Risk" },
                  { key: "frame", label: "Frames" },
                ]}
                rows={model.registry.rows.map((row) => ({
                  id: row.id,
                  tone: row.tone,
                  values: {
                    name: row.name,
                    kind: row.kind,
                    risk: row.risk,
                    frame: row.frame,
                  },
                }))}
                emptyTitle="No registry inventory loaded"
                emptyDetail="Hydrate built-in strategies and playbooks to turn the shelf on."
              />
            </SurfaceFrame>
          </Box>

          <Box marginTop={1}>
            <SurfaceFrame
              eyebrow="Research Queue"
              title={model.queue.title}
              subtitle={model.queue.subtitle}
              tone={model.queue.tone}
              selected={selectedSectionIndex === 4}
              actions={model.queue.actions}
            >
              <DataTable
                columns={[
                  { key: "name", label: "Strategy" },
                  { key: "status", label: "Status" },
                  { key: "source", label: "Source" },
                ]}
                rows={model.queue.rows.map((row, index) => ({
                  id: `${row.reference}-${index}`,
                  tone: row.tone,
                  values: {
                    name: row.name,
                    status: row.status,
                    source: row.source,
                  },
                }))}
                emptyTitle="No research queue yet"
                emptyDetail="Run evolutionary or validation loops to populate the queue."
              />
            </SurfaceFrame>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default LabWorkspace;

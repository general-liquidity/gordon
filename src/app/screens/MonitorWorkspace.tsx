import React from "react";
import { Box } from "ink";

import type { MonitorCockpitModel } from "../cockpitModels.ts";
import { CockpitLines } from "../components/cockpit/CockpitLines.tsx";
import { CockpitTable } from "../components/cockpit/CockpitTable.tsx";

export const MonitorWorkspace: React.FC<{
  model: MonitorCockpitModel;
}> = ({ model }) => (
  <Box gap={1}>
    <Box flexGrow={1} flexDirection="column">
      <CockpitTable
        eyebrow="Book"
        title="Capital book"
        subtitle="Holdings and capital stay pinned in the left book."
        headers={model.book.headers}
        rows={model.book.rows}
        tone="brand"
      />
      <CockpitTable
        eyebrow="Blotter"
        title="Positions and orders"
        subtitle="One blotter for active exposure, queued orders, and execution state."
        headers={model.blotter.headers}
        rows={model.blotter.rows}
        tone="operate"
      />
    </Box>
    <Box width={48} flexDirection="column">
      <CockpitLines
        eyebrow="Runtime"
        title={model.runtime.title}
        subtitle={model.runtime.subtitle}
        lines={model.runtime.lines}
        tone="info"
      />
      <CockpitLines
        eyebrow="Alerts"
        title={model.alerts.title}
        subtitle={model.alerts.subtitle}
        lines={model.alerts.lines}
        tone="warning"
      />
    </Box>
  </Box>
);

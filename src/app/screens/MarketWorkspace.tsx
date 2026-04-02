import React from "react";
import { Box } from "ink";

import type { MarketCockpitModel } from "../cockpitModels.ts";
import { CockpitLines } from "../components/cockpit/CockpitLines.tsx";
import { CockpitTable } from "../components/cockpit/CockpitTable.tsx";

export const MarketWorkspace: React.FC<{
  model: MarketCockpitModel;
}> = ({ model }) => (
  <Box gap={1}>
    <Box flexGrow={1}>
      <CockpitTable
        eyebrow="Tape"
        title="Shortlist matrix"
        subtitle="Rank the tape, then choose one symbol to elevate."
        headers={model.shortlist.headers}
        rows={model.shortlist.rows}
        activeKey={model.shortlist.activeKey}
        emptyTitle={model.shortlist.emptyTitle}
        emptyDetail={model.shortlist.emptyDetail}
        tone="brand"
      />
    </Box>
    <Box width={44} flexDirection="column">
      <CockpitLines
        eyebrow="Dossier"
        title={model.dossier.title}
        subtitle={model.dossier.subtitle}
        lines={model.dossier.lines}
        tone="analysis"
      />
      <CockpitLines
        eyebrow="Context"
        title={model.context.title}
        subtitle={model.context.subtitle}
        lines={model.context.lines}
        tone="info"
      />
    </Box>
  </Box>
);

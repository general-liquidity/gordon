import React from "react";
import { Box } from "ink";

import type { LabCockpitModel } from "../cockpitModels.ts";
import { CockpitLines } from "../components/cockpit/CockpitLines.tsx";
import { CockpitTable } from "../components/cockpit/CockpitTable.tsx";
import { MarkdownPane } from "../components/cockpit/MarkdownPane.tsx";

export const LabWorkspace: React.FC<{
  model: LabCockpitModel;
}> = ({ model }) => (
  <Box gap={1}>
    <Box flexGrow={1} flexDirection="column">
      <CockpitTable
        eyebrow="Bench"
        title="Strategy bench"
        subtitle="Rank built-in and generated strategies in one persistent bench."
        headers={model.bench.headers}
        rows={model.bench.rows}
        activeKey={model.bench.activeKey}
        emptyTitle={model.bench.emptyTitle}
        emptyDetail={model.bench.emptyDetail}
        tone="brand"
      />
      <CockpitLines
        eyebrow="Validation"
        title={model.validation.title}
        subtitle={model.validation.subtitle}
        lines={model.validation.lines}
        tone="success"
      />
    </Box>
    <Box width={48} flexDirection="column">
      <CockpitLines
        eyebrow="Systematic"
        title={model.systematic.title}
        subtitle={model.systematic.subtitle}
        lines={model.systematic.lines}
        tone="info"
      />
      <MarkdownPane
        eyebrow="Protocol"
        title="Runbook"
        subtitle="The lab keeps one live protocol for what to promote."
        markdown={model.protocolMarkdown}
        tone="analysis"
      />
      <CockpitTable
        eyebrow="Queue"
        title="Research queue"
        subtitle="Tracked research experiments and follow-on validation work."
        headers={model.queue.headers}
        rows={model.queue.rows}
        tone="warning"
      />
    </Box>
  </Box>
);

import React from "react";
import { Box, Text } from "ink";

import type { PlanCockpitModel } from "../cockpitModels.ts";
import { CockpitLines } from "../components/cockpit/CockpitLines.tsx";
import { CockpitTable } from "../components/cockpit/CockpitTable.tsx";
import { COLORS } from "../theme.ts";
import { TicketCard } from "../components/desk/TicketCard.tsx";
import { DeskPanel, getDeskToneColor } from "../components/desk/DeskPanel.tsx";

export const PlanWorkspace: React.FC<{
  model: PlanCockpitModel;
}> = ({ model }) => (
  <Box gap={1}>
    <Box flexGrow={1} flexDirection="column">
      <TicketCard eyebrow="Ticket" title={model.ticket.title} subtitle={model.ticket.subtitle} tone="brand">
        {model.ticket.emptyTitle ? (
          <>
            <Text color={COLORS.WHITE}>{model.ticket.emptyTitle}</Text>
            <Text color={COLORS.DIM}>{model.ticket.emptyDetail}</Text>
          </>
        ) : (
          <>
            <Text color={COLORS.BRASS}>{model.ticket.status}</Text>
            {model.ticket.thesis ? <Text color={COLORS.WHITE}>{model.ticket.thesis}</Text> : null}
            {model.ticket.metrics.map((metric) => (
              <Text key={metric.label} color={getDeskToneColor(metric.tone ?? "neutral")}>
                {metric.label}
                <Text color={COLORS.DIM}> · {metric.value}</Text>
              </Text>
            ))}
            {model.ticket.ladder.map((line) => (
              <Text key={line} color={COLORS.DIM}>{line}</Text>
            ))}
          </>
        )}
      </TicketCard>
      <CockpitLines
        eyebrow="Risk"
        title={model.risk.title}
        subtitle={model.risk.subtitle}
        lines={model.risk.lines}
        tone="warning"
      />
    </Box>
    <Box width={44} flexDirection="column">
      <DeskPanel eyebrow="Approval" title={model.approvals.title} subtitle={model.approvals.subtitle} tone="warning">
        <Text color={COLORS.WHITE}>mode <Text color={COLORS.DIM}>{model.approvals.mode}</Text></Text>
        <Text color={COLORS.WHITE}>route <Text color={COLORS.DIM}>{model.approvals.route}</Text></Text>
        {model.approvals.rows.length > 0 ? model.approvals.rows.map((row) => (
          <Text key={row.id} color={getDeskToneColor(row.tone ?? "warning")}>
            {row.id}
            <Text color={COLORS.DIM}> · {row.tool} · {row.summary}</Text>
          </Text>
        )) : <Text color={COLORS.DIM}>No blocking approvals</Text>}
      </DeskPanel>
      <CockpitTable
        eyebrow="Book"
        title={model.book.title}
        subtitle={model.book.subtitle}
        headers={model.book.headers}
        rows={model.book.rows}
        tone="analysis"
      />
    </Box>
  </Box>
);

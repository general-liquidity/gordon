import React from "react";
import { Text } from "ink";

import type { PlanCockpitModel } from "../../cockpitModels.ts";
import { COLORS } from "../../theme.ts";
import { DeskPanel, getDeskToneColor } from "../desk/DeskPanel.tsx";

export const ReviewDeck: React.FC<{
  plan: PlanCockpitModel | null;
}> = ({ plan }) => (
  <DeskPanel eyebrow="Review Desk" title="Ticket and approval desk" subtitle="Fast review of the active plan and approval lane." tone="warning">
    {plan ? (
      <>
        <Text color={COLORS.BRASS}>{plan.ticket.title}</Text>
        <Text color={COLORS.DIM}>{plan.ticket.subtitle}</Text>
        {plan.ticket.metrics.slice(0, 4).map((metric) => (
          <Text key={metric.label} color={getDeskToneColor(metric.tone ?? "neutral")}>
            {metric.label}
            <Text color={COLORS.DIM}> · {metric.value}</Text>
          </Text>
        ))}
        {plan.approvals.rows.length > 0 ? plan.approvals.rows.map((row) => (
          <Text key={row.id} color={getDeskToneColor(row.tone ?? "warning")}>
            {row.id}
            <Text color={COLORS.DIM}> · {row.tool} · {row.summary}</Text>
          </Text>
        )) : <Text color={COLORS.DIM}>No blocking approvals</Text>}
      </>
    ) : (
      <Text color={COLORS.DIM}>No active plan in review.</Text>
    )}
  </DeskPanel>
);

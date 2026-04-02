import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";
import type { PlanWorkspaceTicketModel } from "../../workspaceSurfaces.ts";

interface TicketSheetProps {
  ticket: PlanWorkspaceTicketModel;
}

function metricToneColor(tone?: PlanWorkspaceTicketModel["metrics"][number]["tone"]): string {
  switch (tone) {
    case "success":
      return COLORS.MONEY;
    case "danger":
      return COLORS.RISK;
    case "warning":
      return COLORS.AMBER;
    case "analysis":
      return COLORS.VIOLET;
    case "info":
      return COLORS.ICE;
    case "operate":
      return COLORS.ORANGE;
    case "brand":
      return COLORS.BRASS;
    default:
      return COLORS.WHITE;
  }
}

export function TicketSheet({ ticket }: TicketSheetProps): React.ReactElement {
  if (ticket.emptyTitle) {
    return (
      <Box flexDirection="column">
        <Text color={COLORS.WHITE}>{ticket.emptyTitle}</Text>
        {ticket.emptyDetail && (
          <Text color={COLORS.DIM}>{ticket.emptyDetail}</Text>
        )}
      </Box>
    );
  }

  const leftMetrics = ticket.metrics.filter((_, index) => index % 2 === 0);
  const rightMetrics = ticket.metrics.filter((_, index) => index % 2 === 1);

  return (
    <Box flexDirection="column">
      <Box flexWrap="wrap">
        <Text color={COLORS.BRASS} bold>STATUS</Text>
        <Text color={COLORS.WHITE}> {ticket.statusLabel}</Text>
      </Box>

      <Box marginTop={1}>
        <Box flexDirection="column" width="50%">
          {leftMetrics.map((metric) => (
            <Box key={metric.label} flexDirection="column" marginBottom={1}>
              <Text color={COLORS.DIM}>{metric.label}</Text>
              <Text color={metricToneColor(metric.tone)} bold>{metric.value}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" width="50%">
          {rightMetrics.map((metric) => (
            <Box key={metric.label} flexDirection="column" marginBottom={1}>
              <Text color={COLORS.DIM}>{metric.label}</Text>
              <Text color={metricToneColor(metric.tone)} bold>{metric.value}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {ticket.ladder.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.BRASS} bold>EXECUTION LADDER</Text>
          {ticket.ladder.map((item, index) => (
            <Text key={`${item}-${index}`} color={index === 0 ? COLORS.AMBER : COLORS.WHITE}>
              {item}
            </Text>
          ))}
        </Box>
      )}

      {ticket.thesis && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.BRASS} bold>THESIS</Text>
          <Text color={COLORS.WHITE}>{ticket.thesis}</Text>
        </Box>
      )}
    </Box>
  );
}

export default TicketSheet;

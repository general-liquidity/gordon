import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";
import type { WorkspaceBoardRowViewModel } from "../../workspaceTypes.ts";

interface DetailPaneProps {
  rows: WorkspaceBoardRowViewModel[];
  notes?: string[];
}

function toneColor(tone?: WorkspaceBoardRowViewModel["tone"]): string {
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

export function DetailPane({ rows, notes }: DetailPaneProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={`${row.label}-${row.value}`} flexDirection="column" marginBottom={1}>
          <Box>
            <Box width={14}>
              <Text color={COLORS.DIM}>{row.label}</Text>
            </Box>
            <Text color={toneColor(row.tone)} bold={row.tone === "success" || row.tone === "danger"}>
              {row.value}
            </Text>
          </Box>
          {row.detail && (
            <Box marginLeft={14}>
              <Text color={COLORS.DIM}>{row.detail}</Text>
            </Box>
          )}
        </Box>
      ))}

      {notes && notes.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {notes.map((note, index) => (
            <Text key={`${note}-${index}`} color={COLORS.DIM}>
              {index === 0 ? "Thesis " : "Note   "}{note}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default DetailPane;

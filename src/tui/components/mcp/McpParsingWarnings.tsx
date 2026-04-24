import React from "react";
import { Box, Text } from "../../ink-custom";

// ============================================================================
// McpParsingWarnings — Yellow inline warnings for MCP schema parse errors
//
// One line per warning. Returns null when warnings is empty.
// ============================================================================

interface Warning {
  serverName: string;
  message: string;
  field?: string;
}

interface Props {
  warnings: Warning[];
}

export function McpParsingWarnings({ warnings }: Props) {
  if (warnings.length === 0) return null;

  return (
    <Box flexDirection="column">
      {warnings.map((w, i) => (
        <Box key={i}>
          <Text color="yellow">⚠ </Text>
          <Text color="yellow" bold>
            {w.serverName}
          </Text>
          <Text color="yellow">: {w.message}</Text>
          {w.field && (
            <Text color="yellow" dimColor>
              {" — field: "}{w.field}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

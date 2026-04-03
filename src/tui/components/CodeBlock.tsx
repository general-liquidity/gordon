import React from "react";
import { Box, Text } from "ink";

/**
 * CodeBlock -- Code display with language label and dimmed border
 * Phase 15: Renders fenced code blocks with syntax context
 */

interface Props {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: Props) {
  const lines = code.split("\n");
  // Remove trailing empty line if present
  if (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }

  return (
    <Box flexDirection="column" marginY={0} paddingLeft={2}>
      {/* Top border with language label */}
      <Box>
        <Text dimColor>
          {"\u250C"}{"\u2500"}{language ? ` ${language} ` : ""}{"\u2500".repeat(Math.max(1, 30 - (language?.length ?? 0)))}
        </Text>
      </Box>

      {/* Code lines */}
      {lines.map((line, i) => (
        <Box key={i}>
          <Text dimColor>{"\u2502"} </Text>
          <Text dimColor>{line}</Text>
        </Box>
      ))}

      {/* Bottom border */}
      <Box>
        <Text dimColor>{"\u2514"}{"\u2500".repeat(32)}</Text>
      </Box>
    </Box>
  );
}

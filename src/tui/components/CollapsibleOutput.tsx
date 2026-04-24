import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// CollapsibleOutput — Truncate large outputs with expansion
//
// Shows first N lines by default.
// "... +42 more lines (Ctrl+E to expand)"
// Full content on expansion.
// ============================================================================

interface Props {
  content: string;
  maxLines?: number;
  label?: string;
}

export function CollapsibleOutput({ content, maxLines = 10, label }: Props) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n");
  const needsCollapse = lines.length > maxLines;

  useInput((input, key) => {
    if (key.ctrl && input === "e" && needsCollapse) {
      setExpanded((v) => !v);
    }
  });

  if (!needsCollapse || expanded) {
    return (
      <Box flexDirection="column">
        {label && <Text bold dimColor>{label}</Text>}
        {lines.map((line, i) => (
          <Text key={i}>  {line}</Text>
        ))}
        {expanded && needsCollapse && (
          <Text dimColor>  (Ctrl+E to collapse)</Text>
        )}
      </Box>
    );
  }

  const visible = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  return (
    <Box flexDirection="column">
      {label && <Text bold dimColor>{label}</Text>}
      {visible.map((line, i) => (
        <Text key={i}>  {line}</Text>
      ))}
      <Text dimColor>  ... +{remaining} more lines (Ctrl+E to expand)</Text>
    </Box>
  );
}

import React from "react";
import { Box, Text } from "../ink-custom";

// ============================================================================
// KeybindingWarnings — Display keybinding conflict warnings
//
// Renders one line per conflict:
//   ⚠ Key conflict: [Ctrl+X] bound to both "clearInput" and "toggleExport"
//
// Yellow color. Returns null when conflicts array is empty.
// ============================================================================

interface Conflict {
  action1: string;
  action2: string;
  key: string;
}

interface Props {
  conflicts: Conflict[];
}

export function KeybindingWarnings({ conflicts }: Props) {
  if (conflicts.length === 0) return null;

  return (
    <Box flexDirection="column">
      {conflicts.map((conflict, i) => (
        <Text key={i} color="yellow">
          {"⚠ Key conflict: "}
          <Text color="yellow" bold>
            [{conflict.key}]
          </Text>
          {` bound to both "${conflict.action1}" and "${conflict.action2}"`}
        </Text>
      ))}
    </Box>
  );
}

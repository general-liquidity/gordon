import { Box, Text } from "../ink-custom";
import type { KeybindingConflict } from "../keybindings/keybindings.ts";

// ============================================================================
// KeybindingWarnings — Display keybinding conflict warnings
//
// Renders one line per conflict:
//   ⚠ Key conflict: [Ctrl+X] bound to both "clearInput" and "toggleExport"
//
// Yellow color. Returns null when conflicts array is empty.
// ============================================================================

interface Props {
  conflicts: KeybindingConflict[];
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
          {` → "${conflict.winner}" wins over ${conflict.actions
            .slice(1)
            .map((action) => `"${action}"`)
            .join(", ")}`}
        </Text>
      ))}
    </Box>
  );
}

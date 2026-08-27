/**
 * InvalidConfigDialog — Modal dialog shown when Gordon's configuration
 * contains validation errors that prevent startup or operation.
 *
 * Displays each error as a bullet, with a footer pointing to /doctor.
 * Enter or Escape closes the dialog.
 */

import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

interface Props {
  errors: string[];
  onClose: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function InvalidConfigDialog({ errors, onClose }: Props) {
  useInput((_, key) => {
    if (key.return || key.escape) {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
      {/* Title */}
      <Box justifyContent="center">
        <Text bold color="red">
          {"✗ INVALID CONFIGURATION"}
        </Text>
      </Box>
      <Text> </Text>

      {/* Error list */}
      <Box flexDirection="column" paddingLeft={1}>
        {errors.map((err, i) => (
          <Text key={i} color="red">
            {"•"} {err}
          </Text>
        ))}
      </Box>

      {/* Footer */}
      <Text> </Text>
      <Text dimColor>{"[Enter] Close · Check /doctor for details"}</Text>
    </Box>
  );
}

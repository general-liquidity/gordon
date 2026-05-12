/**
 * InvalidSettingsDialog — Modal dialog shown when Gordon's settings
 * contain validation errors (non-fatal; settings may fall back to defaults).
 *
 * Same structure as InvalidConfigDialog but with yellow styling to
 * signal a warning rather than a hard error.
 *
 * Enter or Escape closes the dialog.
 */

import React from "react";
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

export function InvalidSettingsDialog({ errors, onClose }: Props) {
  useInput((_, key) => {
    if (key.return || key.escape) {
      onClose();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      {/* Title */}
      <Box justifyContent="center">
        <Text bold color="yellow">{"⚠ INVALID SETTINGS"}</Text>
      </Box>
      <Text> </Text>

      {/* Error list */}
      <Box flexDirection="column" paddingLeft={1}>
        {errors.map((err, i) => (
          <Text key={i} color="yellow">
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

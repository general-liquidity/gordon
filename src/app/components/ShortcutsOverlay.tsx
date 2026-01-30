/**
 * Keyboard Shortcuts Overlay Component
 * Displays available keyboard shortcuts when user presses ? or types /shortcuts
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";

interface ShortcutsOverlayProps {
  onClose: () => void;
}

interface ShortcutRowProps {
  keys: string;
  description: string;
}

function ShortcutRow({ keys, description }: ShortcutRowProps): React.ReactElement {
  return (
    <Box>
      <Box width={14}>
        <Text color={COLORS.HIGHLIGHT}>{keys}</Text>
      </Box>
      <Text color={COLORS.WHITE}>{description}</Text>
    </Box>
  );
}

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={COLORS.ACCENT}
      paddingX={2}
      paddingY={1}
      marginX={1}
      marginY={1}
    >
      <Text bold color={COLORS.WHITE}>
        Keyboard Shortcuts
      </Text>
      <Text> </Text>

      <Box flexDirection="column">
        <ShortcutRow keys="Enter" description="Send message" />
        <ShortcutRow keys="Tab" description="Autocomplete command" />
        <ShortcutRow keys="Up / Down" description="Navigate suggestions" />
        <ShortcutRow keys="Escape" description="Dismiss overlay / Back to menu" />
        <ShortcutRow keys="Ctrl+L" description="Clear screen" />
        <ShortcutRow keys="Ctrl+C" description="Exit Gordon" />
        <ShortcutRow keys="?" description="Show this help" />
      </Box>

      <Text> </Text>
      <Text color={COLORS.DIM}>Press Escape or ? to close</Text>
    </Box>
  );
}

export default ShortcutsOverlay;

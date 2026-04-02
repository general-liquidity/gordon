/**
 * Keyboard Shortcuts Overlay Component
 * Displays available keyboard shortcuts when user presses ? or types /shortcuts
 * Also provides a startup hint that fades after 5 seconds
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";

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
    <Box marginX={1} marginY={1}>
      <DeskPanel
        eyebrow="Desk Keys"
        title="Keyboard Shortcuts"
        subtitle="Operator controls for the active shell"
        tone="brand"
      >
        <Box flexDirection="column">
          <ShortcutRow keys="Enter" description="Send message" />
          <ShortcutRow keys="Tab" description="Autocomplete command" />
          <ShortcutRow keys="Up / Down" description="Navigate suggestions" />
          <ShortcutRow keys="Ctrl+K" description="Open command palette" />
          <ShortcutRow keys="Ctrl+J" description="Promote one symbol into focus" />
          <ShortcutRow keys="Ctrl+R" description="Open review desk" />
          <ShortcutRow keys="Escape" description="Dismiss overlays or stop the active run" />
          <ShortcutRow keys="Ctrl+L" description="Clear screen" />
          <ShortcutRow keys="Ctrl+C" description="Exit Gordon" />
          <ShortcutRow keys="?" description="Show this help" />
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>Press Escape or ? to close</Text>
        </Box>
      </DeskPanel>
    </Box>
  );
}

/**
 * Startup hint component that shows "Press ? for help" and fades after 5 seconds
 */
interface ShortcutsHintProps {
  /** Duration in milliseconds before the hint fades (default: 5000) */
  duration?: number;
  /** Whether to show the hint */
  visible?: boolean;
}

export function ShortcutsHint({
  duration = 5000,
  visible = true
}: ShortcutsHintProps): React.ReactElement | null {
  const [isVisible, setIsVisible] = useState(visible);
  const [opacity, setOpacity] = useState<"bright" | "dim" | "hidden">("bright");

  useEffect(() => {
    if (!visible) {
      setIsVisible(false);
      return;
    }

    // Start fading after (duration - 1000)ms
    const fadeTimer = setTimeout(() => {
      setOpacity("dim");
    }, duration - 1000);

    // Hide completely after duration
    const hideTimer = setTimeout(() => {
      setOpacity("hidden");
      // Small delay before removing from DOM
      setTimeout(() => setIsVisible(false), 200);
    }, duration);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [visible, duration]);

  if (!isVisible || opacity === "hidden") {
    return null;
  }

  const textColor = opacity === "bright" ? COLORS.ACCENT : COLORS.DIM;
  const highlightColor = opacity === "bright" ? COLORS.HIGHLIGHT : COLORS.MUTED;

  return (
    <Box paddingX={2} marginTop={1}>
      <Text color={textColor}>
        Keys{" "}
      </Text>
      <Text color={highlightColor} bold>
        ?
      </Text>
      <Text color={textColor}>
        {" "}help ·{" "}
      </Text>
      <Text color={highlightColor} bold>
        Ctrl+K
      </Text>
      <Text color={textColor}>
        {" "} palette ·{" "}
      </Text>
      <Text color={highlightColor} bold>
        Ctrl+J
      </Text>
      <Text color={textColor}>
        {" "} symbol ·{" "}
      </Text>
      <Text color={highlightColor} bold>/help</Text>
      <Text color={textColor}> commands</Text>
    </Box>
  );
}

/**
 * Hook to manage shortcuts hint visibility
 */
export function useShortcutsHint(initialVisible: boolean = true): {
  showHint: boolean;
  dismissHint: () => void;
  resetHint: () => void;
} {
  const [showHint, setShowHint] = useState(initialVisible);

  return {
    showHint,
    dismissHint: () => setShowHint(false),
    resetHint: () => setShowHint(true),
  };
}

export default ShortcutsOverlay;

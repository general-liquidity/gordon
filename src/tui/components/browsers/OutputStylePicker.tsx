/**
 * OutputStylePicker — Select the verbosity/style of Gordon's responses.
 *
 * Four styles: compact, standard, verbose, trading.
 * Uses GordonSelect for consistent branded styling.
 * Escape closes without saving.
 */

import React from "react";
import { Box, Text } from "../../ink-custom";
import { useRoutedInput, FOCUS_PRIORITY } from "../../input/InputRouterContext.tsx";
import { GordonSelect } from "../../design-system/GordonSelect.js";

// ============================================================================
// Types
// ============================================================================

export type OutputStyle = "compact" | "standard" | "verbose" | "trading";

interface Props {
  current: OutputStyle;
  onChange: (style: OutputStyle) => void;
  onClose: () => void;
}

// ============================================================================
// Option definitions
// ============================================================================

const STYLE_OPTIONS: Array<{
  value: OutputStyle;
  label: string;
  description: string;
}> = [
  {
    value: "compact",
    label: "Compact",
    description: "Minimal output, just results",
  },
  {
    value: "standard",
    label: "Standard",
    description: "Balanced detail (default)",
  },
  {
    value: "verbose",
    label: "Verbose",
    description: "Full reasoning and steps",
  },
  {
    value: "trading",
    label: "Trading",
    description: "Trading-specific: prices, P&L, positions emphasized",
  },
];

const SELECT_OPTIONS = STYLE_OPTIONS.map((o) => ({
  value: o.value,
  label: `${o.label} — ${o.description}`,
}));

// ============================================================================
// Component
// ============================================================================

export function OutputStylePicker({ current, onChange, onClose }: Props) {
  useRoutedInput((_, key) => {
    if (key.escape) onClose();
  }, { id: "outputStylePicker", priority: FOCUS_PRIORITY.DIALOG });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="center">
        <Text bold color="cyan">OUTPUT STYLE</Text>
      </Box>
      <Text> </Text>

      <Text dimColor>
        Current: <Text color="cyan">{current}</Text>
      </Text>
      <Text> </Text>

      <GordonSelect
        options={SELECT_OPTIONS}
        onChange={(value) => {
          onChange(value as OutputStyle);
          onClose();
        }}
      />

      <Text> </Text>
      <Text dimColor>{"↑↓"} navigate {"·"} Enter select {"·"} Esc close</Text>
    </Box>
  );
}

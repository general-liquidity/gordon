import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// ListItem — Selectable list item with pointer, check, and description
//
// ▸ Active item          (focused, cyanBright pointer)
// ✓ Selected item        (selected, green check)
//   Normal item
//   Disabled item         (dimColor)
//     Optional description
// ============================================================================

interface Props {
  label: string;
  selected?: boolean;
  focused?: boolean;
  disabled?: boolean;
  description?: string;
}

export function ListItem({ label, selected = false, focused = false, disabled = false, description }: Props) {
  const pointer = focused ? "\u25B8 " : "  ";
  const check = selected ? "\u2713 " : "";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? "cyanBright" : undefined} dimColor={disabled}>
          {pointer}
        </Text>
        {selected ? <Text color="green">{check}</Text> : null}
        <Text dimColor={disabled} bold={focused && !disabled}>
          {label}
        </Text>
      </Box>
      {description ? (
        <Box paddingLeft={4}>
          <Text dimColor>{description}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

import React from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// SearchBox — Search input with / prefix and block cursor
//
// / search query here█
//
// Controlled input via useInput. Backspace deletes, Escape cancels,
// Enter submits. Shows placeholder when empty.
// ============================================================================

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
}

export function SearchBox({ value, onChange, placeholder = "Search...", onSubmit, onCancel }: Props) {
  useInput((input, key) => {
    if (key.escape && onCancel) {
      onCancel();
    } else if (key.return && onSubmit) {
      onSubmit(value);
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      onChange(value + input);
    }
  });

  return (
    <Box>
      <Text dimColor>/ </Text>
      <Text color="cyanBright">{value}</Text>
      <Text color="cyanBright">{"\u2588"}</Text>
      {!value && <Text dimColor>{placeholder}</Text>}
    </Box>
  );
}

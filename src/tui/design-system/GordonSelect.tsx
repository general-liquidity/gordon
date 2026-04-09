import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// GordonSelect — Branded select menu matching Gordon's cyan theme
//
// Replaces @inkjs/ui Select (which uses default blue) with Gordon's
// cyanBright focus color. Consistent with the rest of the product.
// ============================================================================

interface Option {
  label: string;
  value: string;
}

interface Props {
  options: Option[];
  onChange: (value: string) => void;
  focusColor?: string;
}

export function GordonSelect({ options, onChange, focusColor = "cyanBright" }: Props) {
  const [focusIdx, setFocusIdx] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setFocusIdx((i) => (i > 0 ? i - 1 : options.length - 1));
    } else if (key.downArrow) {
      setFocusIdx((i) => (i < options.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      const selected = options[focusIdx];
      if (selected) onChange(selected.value);
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((opt, i) => {
        const isFocused = i === focusIdx;
        return (
          <Box key={opt.value}>
            <Text color={isFocused ? focusColor : undefined}>
              {isFocused ? "\u25B8 " : "  "}
            </Text>
            <Text color={isFocused ? focusColor : undefined} bold={isFocused}>
              {opt.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

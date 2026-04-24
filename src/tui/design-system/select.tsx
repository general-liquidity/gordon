import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// Select — Composable keyboard-navigable list with scroll
//
// Focused item:   ▸ Label   (focusColor, bold)
// Unfocused item:   Label   (dimColor)
// Disabled item:    Label   (dimColor, italic via dim)
//
// Arrow up/down to navigate, Enter or Space to select.
// Scrolls when options exceed maxVisible.
// ============================================================================

export interface SelectOption<T = string> {
  label: string;
  value: T;
  description?: string;
  disabled?: boolean;
}

interface SelectProps<T = string> {
  options: SelectOption<T>[];
  value?: T;
  onChange: (value: T, option: SelectOption<T>) => void;
  maxVisible?: number;
  focusColor?: string;
}

export function Select<T = string>({
  options,
  value,
  onChange,
  maxVisible = 8,
  focusColor = "cyanBright",
}: SelectProps<T>) {
  const initialIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [focusIdx, setFocusIdx] = useState(initialIndex < 0 ? 0 : initialIndex);

  const moveFocus = (direction: 1 | -1) => {
    setFocusIdx((prev) => {
      let next = prev + direction;
      // Skip disabled options
      while (next >= 0 && next < options.length && options[next]?.disabled) {
        next += direction;
      }
      if (next < 0 || next >= options.length) return prev;
      return next;
    });
  };

  useInput((input, key) => {
    if (key.upArrow) {
      moveFocus(-1);
    } else if (key.downArrow) {
      moveFocus(1);
    } else if (key.return || input === " ") {
      const opt = options[focusIdx];
      if (opt && !opt.disabled) {
        onChange(opt.value, opt);
      }
    }
  });

  // Windowing: keep focused item visible
  const visible = Math.min(maxVisible, options.length);
  const startIdx = Math.max(
    0,
    Math.min(focusIdx - Math.floor(visible / 2), options.length - visible),
  );
  const window = options.slice(startIdx, startIdx + visible);

  return (
    <Box flexDirection="column">
      {window.map((opt, i) => {
        const actualIdx = startIdx + i;
        const isFocused = actualIdx === focusIdx;
        return (
          <Box key={String(opt.value)}>
            <Text color={isFocused ? focusColor : undefined}>
              {isFocused ? "▸ " : "  "}
            </Text>
            <Text
              color={isFocused ? focusColor : undefined}
              bold={isFocused}
              dimColor={!isFocused || opt.disabled}
            >
              {opt.label}
            </Text>
            {opt.description ? (
              <Text dimColor> — {opt.description}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

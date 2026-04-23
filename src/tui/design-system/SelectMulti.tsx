import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// SelectMulti — Multi-select list with checkbox toggles
//
// [x] Selected item    (cyanBright when focused)
// [ ] Unselected item  (dimColor when unfocused)
//
// Space toggles selection on focused item.
// Enter confirms and calls onChange with current selection.
// Arrow up/down to navigate. Shows count at top.
// ============================================================================

interface SelectMultiOption<T = string> {
  label: string;
  value: T;
  description?: string;
}

interface SelectMultiProps<T = string> {
  options: Array<SelectMultiOption<T>>;
  selected: T[];
  onChange: (selected: T[]) => void;
  maxVisible?: number;
  placeholder?: string;
}

export function SelectMulti<T = string>({
  options,
  selected,
  onChange,
  maxVisible = 8,
  placeholder = "No items selected",
}: SelectMultiProps<T>) {
  const [focusIdx, setFocusIdx] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setFocusIdx((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.downArrow) {
      setFocusIdx((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (input === " ") {
      const opt = options[focusIdx];
      if (!opt) return;
      const isSelected = selected.includes(opt.value);
      const next = isSelected
        ? selected.filter((v) => v !== opt.value)
        : [...selected, opt.value];
      onChange(next);
    } else if (key.return) {
      onChange(selected);
    }
  });

  // Windowing
  const visible = Math.min(maxVisible, options.length);
  const startIdx = Math.max(
    0,
    Math.min(focusIdx - Math.floor(visible / 2), options.length - visible),
  );
  const window = options.slice(startIdx, startIdx + visible);

  const count = selected.length;

  return (
    <Box flexDirection="column">
      {/* Count header */}
      <Box marginBottom={1}>
        {count === 0 ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <Text color="cyanBright">{count} selected</Text>
        )}
      </Box>

      {/* Option list */}
      {window.map((opt, i) => {
        const actualIdx = startIdx + i;
        const isFocused = actualIdx === focusIdx;
        const isSelected = selected.includes(opt.value);

        return (
          <Box key={String(opt.value)}>
            <Text color={isFocused ? "cyanBright" : undefined}>
              {isFocused ? "▸ " : "  "}
            </Text>
            <Text
              color={isFocused ? "cyanBright" : undefined}
              bold={isFocused}
              dimColor={!isFocused}
            >
              {isSelected ? "[x]" : "[ ]"}
            </Text>
            <Text
              color={isFocused ? "cyanBright" : undefined}
              bold={isFocused}
              dimColor={!isFocused}
            >
              {" "}{opt.label}
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

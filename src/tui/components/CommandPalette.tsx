import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// CommandPalette — Fuzzy search overlay (Ctrl+P)
//
// Keyboard: type to filter, arrow up/down, Enter to select, Escape to close.
// Uses raw useInput for character-by-character filtering (no TextInput widget).
// ============================================================================

export interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
}

interface Props {
  items: PaletteItem[];
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
}

export function CommandPalette({ items, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Fuzzy filter
  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 15);
    const lower = query.toLowerCase();
    return items
      .filter((item) =>
        item.label.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower) ||
        item.category?.toLowerCase().includes(lower)
      )
      .slice(0, 15);
  }, [items, query]);

  // All keyboard handling via useInput
  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const item = filtered[selectedIndex];
      if (item) onSelect(item);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setSelectedIndex(0);
      return;
    }
    // Printable characters
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSelectedIndex(0);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      paddingY={0}
      width={60}
    >
      {/* Search line */}
      <Box>
        <Text color="yellow">{"\u25B6"} </Text>
        <Text>{query || <Text dimColor>Search commands...</Text>}</Text>
        <Text color="yellow">{"\u2588"}</Text>
      </Box>

      {/* Results */}
      {filtered.map((item, i) => (
        <Box key={item.id} paddingX={1}>
          <Text color={i === selectedIndex ? "yellow" : undefined}>
            {i === selectedIndex ? "\u25B8 " : "  "}
          </Text>
          <Text bold={i === selectedIndex}>{item.label}</Text>
          {item.description && (
            <>
              <Text> </Text>
              <Text dimColor>{item.description}</Text>
            </>
          )}
        </Box>
      ))}

      {filtered.length === 0 && (
        <Box paddingX={1}>
          <Text dimColor>No results for "{query}"</Text>
        </Box>
      )}

      {/* Footer hints */}
      <Box>
        <Text dimColor>{"\u2191\u2193"} navigate {"\u00b7"} Enter select {"\u00b7"} Esc close</Text>
      </Box>
    </Box>
  );
}

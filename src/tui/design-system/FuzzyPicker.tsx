import { useState, useMemo, type ReactNode } from "react";
import { Box, Text, useInput, useStdout } from "../ink-custom";

// ============================================================================
// FuzzyPicker — Searchable list picker with preview pane
//
// ┌ Search: btc█                              ┐
// │ ▸ BTC/USDT — Bitcoin                      │
// │   ETH/BTC — Ethereum vs Bitcoin           │
// │   BTCDOM — Bitcoin Dominance              │
// │                          3 of 47 matches  │
// └───────────────────────────────────────────┘
//
// Arrow keys navigate, Enter selects, Escape closes.
// Optional preview pane to the right (wide terminals) or bottom.
// ============================================================================

export interface PickerItem {
  id: string;
  label: string;
  description?: string;
}

interface Props {
  items: PickerItem[];
  onSelect: (item: PickerItem) => void;
  onClose: () => void;
  onFocus?: (item: PickerItem) => void;
  previewRender?: (item: PickerItem) => ReactNode;
  direction?: "up" | "down";
  placeholder?: string;
  maxVisible?: number;
}

export function FuzzyPicker({
  items,
  onSelect,
  onClose,
  onFocus,
  previewRender,
  direction = "down",
  placeholder = "Search...",
  maxVisible = 10,
}: Props) {
  const { stdout } = useStdout();
  const termCols = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 24;
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return items;
    const lower = query.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) || item.description?.toLowerCase().includes(lower),
    );
  }, [items, query]);

  const visibleCount = Math.min(maxVisible, termRows - 6, filtered.length);
  const showPreviewRight = previewRender && termCols >= 140;

  useInput((input, key) => {
    if (key.escape) {
      onClose();
    } else if (key.return && filtered.length > 0) {
      onSelect(filtered[selectedIndex]!);
    } else if (key.upArrow || (key.ctrl && input === "p")) {
      setSelectedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : filtered.length - 1;
        if (onFocus && filtered[next]) onFocus(filtered[next]!);
        return next;
      });
    } else if (key.downArrow || (key.ctrl && input === "n")) {
      setSelectedIndex((prev) => {
        const next = prev < filtered.length - 1 ? prev + 1 : 0;
        if (onFocus && filtered[next]) onFocus(filtered[next]!);
        return next;
      });
    } else if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
    } else if (input && !key.ctrl && !key.meta) {
      setQuery((prev) => prev + input);
      setSelectedIndex(0);
    }
  });

  const _displayItems = direction === "up" ? [...filtered].reverse() : filtered;
  const startIdx = Math.max(0, selectedIndex - Math.floor(visibleCount / 2));
  const visible = filtered.slice(startIdx, startIdx + visibleCount);

  return (
    <Box flexDirection="column">
      {/* Search input */}
      <Box>
        <Text dimColor>/ </Text>
        <Text color="cyanBright">{query}</Text>
        <Text color="cyanBright">{"\u2588"}</Text>
        {!query && <Text dimColor>{placeholder}</Text>}
      </Box>

      <Box flexDirection={showPreviewRight ? "row" : "column"}>
        {/* Results list */}
        <Box flexDirection="column" flexGrow={1}>
          {visible.map((item, i) => {
            const actualIndex = startIdx + i;
            const isFocused = actualIndex === selectedIndex;
            return (
              <Box key={item.id}>
                <Text color={isFocused ? "cyanBright" : undefined}>
                  {isFocused ? "\u25B8 " : "  "}
                </Text>
                <Text bold={isFocused}>{item.label}</Text>
                {item.description ? <Text dimColor> \u2014 {item.description}</Text> : null}
              </Box>
            );
          })}
          {/* Match count */}
          <Box justifyContent="flex-end">
            <Text dimColor>
              {filtered.length} of {items.length} matches
            </Text>
          </Box>
        </Box>

        {/* Preview pane */}
        {showPreviewRight && filtered[selectedIndex] ? (
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            width={50}
            paddingX={1}
            marginLeft={1}
          >
            {previewRender!(filtered[selectedIndex]!)}
          </Box>
        ) : null}
      </Box>

      {/* Preview below on narrow terminals */}
      {!showPreviewRight && previewRender && filtered[selectedIndex] ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginTop={1}
        >
          {previewRender(filtered[selectedIndex]!)}
        </Box>
      ) : null}
    </Box>
  );
}

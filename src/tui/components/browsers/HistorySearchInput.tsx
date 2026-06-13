import React, { useState } from "react";
import { Box, Text } from "../../ink-custom";
import { useRoutedInput, FOCUS_PRIORITY } from "../../input/InputRouterContext.tsx";

// ============================================================================
// HistorySearchInput — Ctrl+R style history search overlay
//
// Shows a bordered dialog with:
//   - A text input for filtering
//   - Up to 10 matching history entries (case-insensitive substring)
//   - Arrow keys to move focus, Enter to pick, Esc to close
// ============================================================================

interface Props {
  history: string[];
  onSelect: (entry: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 10;

export function HistorySearchInput({ history, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);

  // Most-recent entries first
  const reversed = [...history].reverse();

  const matches = reversed.filter((entry) =>
    query === "" ? true : entry.toLowerCase().includes(query.toLowerCase())
  ).slice(0, MAX_RESULTS);

  useRoutedInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return) {
      const selected = matches[focusIdx];
      if (selected != null) {
        onSelect(selected);
      } else {
        onClose();
      }
      return;
    }

    if (key.upArrow) {
      setFocusIdx((i) => (i > 0 ? i - 1 : matches.length - 1));
      return;
    }

    if (key.downArrow) {
      setFocusIdx((i) => (i < matches.length - 1 ? i + 1 : 0));
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setFocusIdx(0);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setFocusIdx(0);
    }
  }, { id: "historySearchInput", priority: FOCUS_PRIORITY.DIALOG });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color="gray">
          HISTORY SEARCH
        </Text>
        <Text dimColor>  (Esc to close)</Text>
      </Box>

      {/* Search input line */}
      <Box marginBottom={1}>
        <Text color="cyanBright" bold>{">"} </Text>
        <Text>{query}</Text>
        <Text color="cyanBright">{"█"}</Text>
      </Box>

      {/* Results */}
      {matches.length === 0 ? (
        <Text dimColor>  No matches</Text>
      ) : (
        matches.map((entry, i) => {
          const isFocused = i === focusIdx;
          return (
            <Box key={`${entry}-${i}`}>
              <Text color={isFocused ? "rgb(52,238,176)" : undefined}>
                {isFocused ? "▸ " : "  "}
              </Text>
              <Text
                color={isFocused ? "rgb(52,238,176)" : undefined}
                bold={isFocused}
                wrap="truncate-end"
              >
                {entry}
              </Text>
            </Box>
          );
        })
      )}

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>
          {"↑↓"} navigate {"·"} Enter select {"·"} Esc cancel
        </Text>
      </Box>
    </Box>
  );
}

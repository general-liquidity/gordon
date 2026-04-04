import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// History Search Dialog — Ctrl+R reverse-i-search through past commands
// ============================================================================

interface Props {
  entries: Array<{ command: string; timestamp: number }>;
  onClose: () => void;
  onSelect: (command: string) => void;
}

function timeAgo(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

export function HistorySearchDialog({ entries, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return entries.slice(0, 20);
    const lower = query.toLowerCase();
    return entries.filter((e) => e.command.toLowerCase().includes(lower)).slice(0, 20);
  }, [entries, query]);

  useInput((input, key) => {
    if (key.escape) onClose();
    else if (key.return && filtered[selectedIndex]) onSelect(filtered[selectedIndex]!.command);
    else if (key.upArrow) setSelectedIndex((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelectedIndex((p) => Math.min(filtered.length - 1, p + 1));
    else if (key.backspace) { setQuery((p) => p.slice(0, -1)); setSelectedIndex(0); }
    else if (input && !key.ctrl && !key.meta) { setQuery((p) => p + input); setSelectedIndex(0); }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyanBright">HISTORY SEARCH</Text>
      <Box>
        <Text dimColor>bck-i-search: </Text>
        <Text color="cyanBright">{query}{"\u2588"}</Text>
      </Box>
      {filtered.map((entry, i) => (
        <Box key={i}>
          <Text color={i === selectedIndex ? "cyanBright" : undefined}>
            {i === selectedIndex ? "\u25B8 " : "  "}
          </Text>
          <Text dimColor>{timeAgo(entry.timestamp).padEnd(10)}</Text>
          <Text bold={i === selectedIndex}>{entry.command}</Text>
        </Box>
      ))}
      <Text dimColor>{filtered.length} matches {"\u00B7"} Enter to select {"\u00B7"} Esc to close</Text>
    </Box>
  );
}

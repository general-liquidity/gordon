import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// Global Search Dialog — Ctrl+Shift+F workspace-wide search
//
// Searches trade journal, strategies, audit logs, session transcripts.
// Debounced, capped at 500 results.
// ============================================================================

export interface SearchResult {
  source: "memory" | "strategy" | "transcript" | "audit";
  title: string;
  snippet: string;
  path?: string;
}

interface Props {
  results?: SearchResult[];
  onClose: () => void;
  onSelect?: (result: SearchResult) => void;
}

const SOURCE_COLORS: Record<string, string> = {
  memory: "cyan", strategy: "magenta", transcript: "blue", audit: "yellow",
};

export function GlobalSearchDialog({ results = [], onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return results.slice(0, 20);
    const lower = query.toLowerCase();
    return results.filter((r) =>
      r.title.toLowerCase().includes(lower) || r.snippet.toLowerCase().includes(lower),
    ).slice(0, 500);
  }, [results, query]);

  useInput((input, key) => {
    if (key.escape) onClose();
    else if (key.return && filtered[selectedIndex]) onSelect?.(filtered[selectedIndex]!);
    else if (key.upArrow) setSelectedIndex((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelectedIndex((p) => Math.min(filtered.length - 1, p + 1));
    else if (key.backspace) { setQuery((p) => p.slice(0, -1)); setSelectedIndex(0); }
    else if (input && !key.ctrl && !key.meta) { setQuery((p) => p + input); setSelectedIndex(0); }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyanBright">GLOBAL SEARCH</Text>
      <Box>
        <Text dimColor>/ </Text>
        <Text color="cyanBright">{query}{"\u2588"}</Text>
      </Box>
      {filtered.slice(0, 15).map((result, i) => (
        <Box key={i}>
          <Text color={i === selectedIndex ? "cyanBright" : undefined}>
            {i === selectedIndex ? "\u25B8 " : "  "}
          </Text>
          <Text color={SOURCE_COLORS[result.source]} bold>{result.source.toUpperCase()}</Text>
          <Text> </Text>
          <Text bold={i === selectedIndex}>{result.title}</Text>
          <Text dimColor> {result.snippet.slice(0, 40)}</Text>
        </Box>
      ))}
      <Box justifyContent="flex-end">
        <Text dimColor>{filtered.length} results {"\u00B7"} Esc to close</Text>
      </Box>
    </Box>
  );
}

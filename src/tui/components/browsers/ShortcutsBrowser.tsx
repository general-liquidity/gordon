import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { getResolvedBindings, type KeyBinding } from "../../keybindings/keybindings.js";

/**
 * ShortcutsBrowser — Searchable keybinding reference
 */

interface Props {
  onCancel: () => void;
}

export function ShortcutsBrowser({ onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const allBindings = getResolvedBindings();
  const filtered = query
    ? allBindings.filter((b) =>
        b.key.toLowerCase().includes(query.toLowerCase()) ||
        b.action.toLowerCase().includes(query.toLowerCase())
      )
    : allBindings;

  // Group by when
  const groups: Record<string, KeyBinding[]> = {};
  for (const b of filtered) {
    const group = b.when === "normalMode" ? "Vim Normal" : b.when === "insertMode" ? "Vim Insert" : "Global";
    (groups[group] ??= []).push(b);
  }

  useInput((input, key) => {
    if (key.escape) { if (query) { setQuery(""); setSelectedIdx(0); } else onCancel(); return; }
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    if (key.backspace) { setQuery((q) => q.slice(0, -1)); setSelectedIdx(0); return; }
    if (input && !key.ctrl && !key.meta) { setQuery((q) => q + input); setSelectedIdx(0); }
  });

  let globalIdx = 0;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">KEYBOARD SHORTCUTS</Text>
        <Text dimColor>  ({filtered.length} bindings)</Text>
      </Box>

      <Box>
        <Text color="cyanBright">{"\uD83D\uDD0D"} </Text>
        {query ? <Text>{query}<Text color="cyanBright">{"\u2588"}</Text></Text> : <Text dimColor>Type to search...</Text>}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {Object.entries(groups).map(([group, bindings]) => (
          <Box key={group} flexDirection="column" marginBottom={1}>
            <Text dimColor>{"  \u2500\u2500 "}{group.toLowerCase()}{" \u2500\u2500"}</Text>
            {bindings.map((b) => {
              const idx = globalIdx++;
              const isFocused = idx === selectedIdx;
              const keyDisplay = b.chord ? `${b.key} ${b.chord}` : b.key;
              return (
                <Box key={`${b.key}-${b.action}`}>
                  <Text color={isFocused ? "cyanBright" : undefined}>{isFocused ? " \u25B8" : "  "}</Text>
                  <Text color={isFocused ? "cyanBright" : "yellow"} bold={isFocused}> {keyDisplay.padEnd(22)}</Text>
                  <Text dimColor={!isFocused}>{b.action}</Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      <Text dimColor>Customize in ~/.gordon/keybindings.json</Text>
      <Box marginTop={1}>
        <Text dimColor>{"\u2191\u2193"} scroll {"\u00B7"} Esc {query ? "clear" : "close"}</Text>
      </Box>
    </Box>
  );
}

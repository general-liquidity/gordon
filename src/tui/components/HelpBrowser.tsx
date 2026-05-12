import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "../ink-custom";
import {
  SLASH_COMMANDS,
  type SlashCommand,
} from "../../app/slash/slashCommands.ts";

/**
 * HelpBrowser — Searchable command browser with categories
 *
 * Claude Code pattern: interactive help with search, filtering,
 * and ability to run commands directly from the browser.
 */

interface Props {
  onRunCommand: (command: string) => void;
  onCancel: () => void;
}

export function HelpBrowser({ onRunCommand, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const cmd of SLASH_COMMANDS) cats.add(cmd.category);
    return ["all", ...Array.from(cats)];
  }, []);

  const filtered = useMemo(() => {
    let cmds = [...SLASH_COMMANDS];
    if (selectedCategory && selectedCategory !== "all") {
      cmds = cmds.filter((c) => c.category === selectedCategory);
    }
    if (query) {
      const q = query.toLowerCase();
      cmds = cmds.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q) ||
        (c.aliases ?? []).some((a) => a.toLowerCase().includes(q))
      );
    }
    return cmds;
  }, [query, selectedCategory]);

  useInput((input, key) => {
    if (key.escape) {
      if (query) { setQuery(""); setSelectedIdx(0); }
      else if (selectedCategory) { setSelectedCategory(null); setSelectedIdx(0); }
      else onCancel();
      return;
    }
    if (key.return) {
      const cmd = filtered[selectedIdx];
      if (cmd) onRunCommand(`/${cmd.name}`);
      return;
    }
    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (key.tab) {
      // Cycle categories
      const idx = categories.indexOf(selectedCategory ?? "all");
      setSelectedCategory(categories[(idx + 1) % categories.length] ?? "all");
      setSelectedIdx(0);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setSelectedIdx(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSelectedIdx(0);
    }
  });

  const maxVisible = 15;
  const scrollStart = Math.max(0, selectedIdx - Math.floor(maxVisible / 2));
  const visible = filtered.slice(scrollStart, scrollStart + maxVisible);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">COMMANDS</Text>
        <Text dimColor>  ({filtered.length} of {SLASH_COMMANDS.length})</Text>
      </Box>

      {/* Search bar */}
      <Box>
        <Text color="cyanBright">{"\uD83D\uDD0D"} </Text>
        {query ? <Text>{query}<Text color="cyanBright">{"\u2588"}</Text></Text> : <Text dimColor>Type to search...</Text>}
      </Box>

      {/* Category tabs */}
      <Box marginTop={1}>
        {categories.map((cat) => (
          <Text key={cat} color={cat === (selectedCategory ?? "all") ? "cyanBright" : undefined} dimColor={cat !== (selectedCategory ?? "all")}>
            {" "}{cat}{" "}
          </Text>
        ))}
      </Box>

      {/* Command list */}
      <Box flexDirection="column" marginTop={1}>
        {visible.map((cmd, i) => {
          const globalIdx = scrollStart + i;
          const isFocused = globalIdx === selectedIdx;
          return (
            <Box key={cmd.name}>
              <Text color={isFocused ? "cyanBright" : undefined}>
                {isFocused ? " \u25B8" : "  "}
              </Text>
              <Text color={isFocused ? "cyanBright" : undefined} bold={isFocused}>
                {" /"}{cmd.name.padEnd(18)}
              </Text>
              <Text dimColor={!isFocused} wrap="truncate-end">
                {cmd.description ?? ""}
              </Text>
            </Box>
          );
        })}
      </Box>

      {filtered.length > maxVisible && (
        <Text dimColor> {scrollStart > 0 ? `${scrollStart} above` : ""} {scrollStart + maxVisible < filtered.length ? `${filtered.length - scrollStart - maxVisible} below` : ""}</Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>{"\u2191\u2193"} navigate {"\u00B7"} Tab category {"\u00B7"} Enter run {"\u00B7"} Esc {query ? "clear" : selectedCategory ? "all" : "close"}</Text>
      </Box>
    </Box>
  );
}

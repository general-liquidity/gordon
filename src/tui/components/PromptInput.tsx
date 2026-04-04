import React, { useState, useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { FooterHints } from "./FooterHints.js";
import { useSlashCommandTypeahead, type TypeaheadMatch } from "../hooks/useSlashCommandTypeahead.js";

// ============================================================================
// PromptInput — Claude Code-style input with full slash command browser
//
// Typing "/" instantly shows ALL commands grouped by workflow category.
// Arrow keys scroll the list, Tab completes, Enter selects. Escape clears.
// As you type after /, the list filters by prefix → alias → fuzzy match.
// ============================================================================

interface Props {
  onSubmit: (value: string) => void;
  placeholder?: string;
  permissionMode: "auto" | "ask" | "strict";
  activeAgentCount: number;
  activeAgentName: string | null;
  isStreaming: boolean;
  autonomousActive?: boolean;
  autonomousStrategyCount?: number;
}

export function PromptInput({
  onSubmit,
  placeholder = "",
  permissionMode,
  activeAgentCount,
  activeAgentName,
  isStreaming,
  autonomousActive = false,
  autonomousStrategyCount = 0,
}: Props) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const [value, setValue] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Show suggestions when value starts with "/" — allow one space for subcommand browsing
  const slashContent = value.startsWith("/") ? value.slice(1) : "";
  const spaceCount = (slashContent.match(/ /g) ?? []).length;
  const isSlashMode = value === "/" || (value.startsWith("/") && spaceCount <= 1);
  const slashQuery = isSlashMode ? slashContent : "";
  const suggestions = useSlashCommandTypeahead(slashQuery, {
    maxResults: 50,
    showAllOnEmpty: true,
  });
  const showSuggestions = isSlashMode && suggestions.length > 0;

  // Group by workflow for visual sections
  const grouped = useMemo(() => {
    if (!showSuggestions) return [];
    const groups: Array<{
      header: string;
      items: Array<TypeaheadMatch & { globalIdx: number }>;
    }> = [];
    let lastWorkflow = "";
    let globalIdx = 0;

    for (const cmd of suggestions) {
      if (cmd.workflow !== lastWorkflow) {
        groups.push({ header: cmd.workflow, items: [] });
        lastWorkflow = cmd.workflow;
      }
      groups[groups.length - 1]!.items.push({ ...cmd, globalIdx });
      globalIdx++;
    }
    return groups;
  }, [suggestions, showSuggestions]);

  // Max visible rows (leave room for input line + hints + scroll indicators)
  const maxVisible = Math.max(5, termRows - 6);

  // Scroll window centered on selected item
  const scrollStart = Math.max(0, selectedIdx - Math.floor(maxVisible / 2));

  useInput((input, key) => {
    // Enter → select command or submit text
    if (key.return) {
      if (showSuggestions && suggestions[selectedIdx]) {
        const cmd = suggestions[selectedIdx]!;
        onSubmit(`/${cmd.name}`);
        setValue("");
        setSelectedIdx(0);
      } else {
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setValue("");
          setSelectedIdx(0);
        }
      }
      return;
    }

    // Escape → clear input and close suggestions
    if (key.escape) {
      setValue("");
      setSelectedIdx(0);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      setSelectedIdx(0);
      return;
    }

    // Arrow keys for suggestion navigation (wraps around)
    if (showSuggestions) {
      if (key.upArrow) {
        setSelectedIdx((i) => (i > 0 ? i - 1 : suggestions.length - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIdx((i) => (i < suggestions.length - 1 ? i + 1 : 0));
        return;
      }
      if (key.tab) {
        const selected = suggestions[selectedIdx];
        if (selected) {
          setValue(`/${selected.name} `);
          setSelectedIdx(0);
        }
        return;
      }
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
      setValue((prev) => prev + input);
      setSelectedIdx(0);
    }
  });

  // Build flat row list with headers interleaved
  const allRows: Array<
    | { kind: "header"; text: string }
    | { kind: "item"; cmd: TypeaheadMatch; globalIdx: number }
  > = [];
  if (showSuggestions) {
    for (const group of grouped) {
      allRows.push({ kind: "header", text: group.header });
      for (const item of group.items) {
        allRows.push({ kind: "item", cmd: item, globalIdx: item.globalIdx });
      }
    }
  }

  // Apply scroll window to the flat row list
  // Find the row index of the selected item
  let selectedRowIdx = 0;
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i]!;
    if (row.kind === "item" && row.globalIdx === selectedIdx) {
      selectedRowIdx = i;
      break;
    }
  }
  const rowScrollStart = Math.max(0, selectedRowIdx - Math.floor(maxVisible / 2));
  const visibleSlice = allRows.slice(rowScrollStart, rowScrollStart + maxVisible);
  const hasMoreAbove = rowScrollStart > 0;
  const hasMoreBelow = rowScrollStart + maxVisible < allRows.length;

  const promptChar = isSlashMode ? "/" : "\u276F";

  return (
    <Box flexDirection="column">
      {/* Slash command browser above input */}
      {showSuggestions && (
        <Box flexDirection="column" paddingX={1}>
          {hasMoreAbove && (
            <Text dimColor>  {"\u25B2"} {rowScrollStart} more above</Text>
          )}

          {visibleSlice.map((row, i) => {
            if (row.kind === "header") {
              return (
                <Box key={`hdr-${row.text}-${i}`} marginTop={i > 0 ? 1 : 0}>
                  <Text dimColor bold>
                    {"  "}{row.text.toUpperCase()}
                  </Text>
                </Box>
              );
            }

            const { cmd, globalIdx } = row;
            const isFocused = globalIdx === selectedIdx;

            return (
              <Box key={cmd.name}>
                <Text color={isFocused ? "cyanBright" : undefined}>
                  {isFocused ? " \u25B8 " : "   "}
                </Text>
                <Text color={isFocused ? "cyanBright" : undefined} bold={isFocused}>
                  /{cmd.name}
                </Text>
                {cmd.aliases && cmd.aliases.length > 0 ? (
                  <Text dimColor> ({cmd.aliases.slice(0, 2).join(", ")})</Text>
                ) : null}
                <Text dimColor>{"  "}{(cmd.description ?? "").slice(0, 45)}</Text>
                {cmd.subcommandCount ? (
                  <Text dimColor italic> ({cmd.subcommandCount} subcommands)</Text>
                ) : null}
              </Box>
            );
          })}

          {hasMoreBelow && (
            <Text dimColor>  {"\u25BC"} {allRows.length - rowScrollStart - maxVisible} more below</Text>
          )}

          <Box marginTop={0}>
            <Text dimColor>
              {"  "}{"\u2191\u2193"} navigate {"\u00B7"} Tab complete {"\u00B7"} Enter select {"\u00B7"} Esc cancel
              {" \u00B7 "}{suggestions.length} commands
            </Text>
          </Box>
        </Box>
      )}

      {/* Input line */}
      <Box>
        <Text color="cyanBright" bold>{promptChar} </Text>
        <Box flexGrow={1}>
          {value ? (
            <Text>
              {isSlashMode ? (
                <Text color="cyanBright">{value.slice(1)}</Text>
              ) : (
                <Text>{value}</Text>
              )}
              <Text color="cyanBright">{"\u2588"}</Text>
            </Text>
          ) : (
            <Text dimColor>{placeholder}</Text>
          )}
        </Box>
        <FooterHints
          permissionMode={permissionMode}
          activeAgentCount={activeAgentCount}
          isStreaming={isStreaming}
          activeAgentName={activeAgentName}
          autonomousActive={autonomousActive}
          autonomousStrategyCount={autonomousStrategyCount}
        />
      </Box>
    </Box>
  );
}

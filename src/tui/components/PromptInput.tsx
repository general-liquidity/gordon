import React, { useState, useMemo, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { FooterHints } from "./FooterHints.js";
import { useSlashCommandTypeahead, type TypeaheadMatch } from "../hooks/useSlashCommandTypeahead.js";
import { useInputHistory } from "../hooks/useInputHistory.js";

// ============================================================================
// PromptInput — Claude Code-style compact slash command picker
//
// Typing "/" shows a compact list of commands like Claude Code does:
//   /command    Description text here
// No aliases clutter. Full descriptions visible. Tight rows.
// Arrow keys scroll, Tab completes, Enter selects.
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
  vimMode?: boolean;
  effortLevel?: "low" | "medium" | "high" | "auto";
  tokenBudgetRatio?: number;
}

// Fixed width for command name column — keeps descriptions aligned
const CMD_COL_WIDTH = 18;

export function PromptInput({
  onSubmit,
  placeholder = "",
  permissionMode,
  activeAgentCount,
  activeAgentName,
  isStreaming,
  autonomousActive = false,
  autonomousStrategyCount = 0,
  vimMode = false,
  effortLevel,
  tokenBudgetRatio,
}: Props) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const [value, setValue] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const history = useInputHistory();
  const stashedInputRef = useRef("");

  // Paste detection: rapid input within 10ms = paste
  const lastInputTimeRef = useRef(0);
  const pasteBufferRef = useRef("");

  // Show suggestions when value starts with "/" — allow one space for subcommand browsing
  const slashContent = value.startsWith("/") ? value.slice(1) : "";
  const spaceCount = (slashContent.match(/ /g) ?? []).length;
  const isSlashMode = value === "/" || (value.startsWith("/") && spaceCount <= 1);
  const slashQuery = isSlashMode ? slashContent : "";
  const suggestions = useSlashCommandTypeahead(slashQuery, {
    maxResults: 200,
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

  // Show as many suggestions as terminal allows (up to 60% of height).
  // User scrolls with arrow keys — all commands accessible.
  const maxVisible = Math.min(Math.max(10, Math.floor(termRows * 0.6)), 30);

  useInput((input, key) => {
    if (key.return) {
      if (showSuggestions && suggestions[selectedIdx]) {
        const cmd = suggestions[selectedIdx]!;
        history.push(`/${cmd.name}`);
        onSubmit(`/${cmd.name}`);
        setValue("");
        setCursorPos(0);
        setSelectedIdx(0);
      } else {
        const trimmed = value.trim();
        if (trimmed) {
          history.push(trimmed);
          onSubmit(trimmed);
          setValue("");
          setCursorPos(0);
          setSelectedIdx(0);
        }
      }
      return;
    }

    if (key.escape) {
      setValue("");
      setCursorPos(0);
      setSelectedIdx(0);
      history.reset();
      return;
    }

    // History navigation (up/down when not in slash mode)
    if (!showSuggestions && key.upArrow) {
      if (!history.current) stashedInputRef.current = value;
      const prev = history.goUp();
      if (prev != null) { setValue(prev); setCursorPos(prev.length); }
      return;
    }
    if (!showSuggestions && key.downArrow) {
      const next = history.goDown();
      if (next != null) { setValue(next); setCursorPos(next.length); }
      else { setValue(stashedInputRef.current); setCursorPos(stashedInputRef.current.length); }
      return;
    }

    // Cursor movement (left/right)
    if (key.leftArrow) {
      setCursorPos((p) => Math.max(0, p - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos((p) => Math.min(value.length, p + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setValue((prev) => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
        setCursorPos((p) => p - 1);
      }
      setSelectedIdx(0);
      return;
    }

    // Paste detection: rapid input within 5ms
    const now = Date.now();
    if (now - lastInputTimeRef.current < 5) {
      pasteBufferRef.current += input;
    } else {
      pasteBufferRef.current = input;
    }
    lastInputTimeRef.current = now;

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

    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
      // Insert at cursor position (not just append)
      setValue((prev) => prev.slice(0, cursorPos) + input + prev.slice(cursorPos));
      setCursorPos((p) => p + input.length);
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

  // Scroll window centered on selected item
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

  // Description width = terminal width - pointer(3) - "/" - cmd name - padding
  const descWidth = Math.max(20, termCols - 3 - 1 - CMD_COL_WIDTH - 4);

  const promptChar = isSlashMode ? "/" : "\u276F";

  return (
    <Box flexDirection="column">
      {/* Slash command picker above input — compact like Claude Code */}
      {showSuggestions && (
        <Box flexDirection="column">
          {hasMoreAbove && (
            <Text dimColor> {"\u25B2"} {rowScrollStart} more</Text>
          )}

          {visibleSlice.map((row, i) => {
            if (row.kind === "header") {
              return (
                <Box key={`hdr-${row.text}-${i}`} marginTop={i > 0 ? 1 : 0}>
                  <Text dimColor>
                    {"  ── "}{row.text.toLowerCase()}{" ──"}
                  </Text>
                </Box>
              );
            }

            const { cmd, globalIdx } = row;
            const isFocused = globalIdx === selectedIdx;
            const cmdName = `/${cmd.name}`;
            const padded = cmdName.padEnd(CMD_COL_WIDTH + 1);

            return (
              <Box key={cmd.name}>
                <Text color={isFocused ? "cyanBright" : undefined}>
                  {isFocused ? " \u25B8" : "  "}
                </Text>
                <Text color={isFocused ? "cyanBright" : undefined} bold={isFocused}>
                  {" "}{padded}
                </Text>
                <Text dimColor={!isFocused} color={isFocused ? "white" : undefined} wrap="truncate-end">
                  {(cmd.description ?? "").slice(0, descWidth)}
                </Text>
              </Box>
            );
          })}

          {hasMoreBelow && (
            <Text dimColor> {"\u25BC"} {allRows.length - rowScrollStart - maxVisible} more</Text>
          )}

          <Text dimColor>
            {" "}{"\u2191\u2193"} select {"\u00B7"} Tab complete {"\u00B7"} Enter run {"\u00B7"} Esc cancel
          </Text>
        </Box>
      )}

      {/* Input line */}
      <Box>
        <Text color="cyanBright" bold>{promptChar} </Text>
        <Box flexGrow={1}>
          {value ? (
            <Text>
              {isSlashMode ? (
                <>
                  <Text color="cyanBright">{value.slice(1, cursorPos)}</Text>
                  <Text color="cyanBright" inverse>{value[cursorPos] ?? " "}</Text>
                  <Text color="cyanBright">{value.slice(cursorPos + 1)}</Text>
                </>
              ) : (
                <>
                  <Text>{value.slice(0, cursorPos)}</Text>
                  <Text inverse>{value[cursorPos] ?? " "}</Text>
                  <Text>{value.slice(cursorPos + 1)}</Text>
                </>
              )}
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
          vimMode={vimMode}
          effortLevel={effortLevel}
          tokenBudgetRatio={tokenBudgetRatio}
        />
      </Box>
    </Box>
  );
}

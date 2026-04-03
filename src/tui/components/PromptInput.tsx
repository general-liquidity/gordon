import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { FooterHints } from "./FooterHints.js";
import { useSlashCommandTypeahead } from "../hooks/useSlashCommandTypeahead.js";

// ============================================================================
// PromptInput — Fully controlled input with slash suggestions
//
// Uses useInput for char-by-char handling (not ink-ui TextInput)
// so we can clear the value after submit.
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
  const [value, setValue] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const slashQuery = value.startsWith("/") ? value.slice(1) : "";
  const suggestions = useSlashCommandTypeahead(slashQuery);
  const showSuggestions = slashQuery.length > 0 && suggestions.length > 0;

  useInput((input, key) => {
    // Enter → submit
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue("");
        setSelectedIdx(0);
      }
      return;
    }

    // Escape → clear
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

    // Arrow keys for suggestions
    if (showSuggestions) {
      if (key.upArrow) {
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIdx((i) => Math.min(suggestions.length - 1, i + 1));
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

    // Regular characters
    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
      setValue((prev) => prev + input);
      setSelectedIdx(0);
    }
  });

  const promptChar = value.startsWith("/") ? "/" : "\u276F";

  return (
    <Box flexDirection="column">
      {/* Slash suggestions above input */}
      {showSuggestions && (
        <Box flexDirection="column" paddingX={2}>
          {suggestions.slice(0, 5).map((cmd, i) => (
            <Box key={cmd.name}>
              <Text color={i === selectedIdx ? "cyanBright" : undefined} bold={i === selectedIdx}>
                {i === selectedIdx ? "\u25B8 " : "  "}/{cmd.name}
              </Text>
              <Text dimColor>  {cmd.description?.slice(0, 50)}</Text>
            </Box>
          ))}
          <Text dimColor>  {"\u2191\u2193"} select {"\u00b7"} Tab complete {"\u00b7"} Enter submit</Text>
        </Box>
      )}

      {/* Input line */}
      <Box>
        <Text color="cyanBright" bold>{promptChar} </Text>
        <Box flexGrow={1}>
          {value ? (
            <Text>{value}<Text color="cyanBright">{"\u2588"}</Text></Text>
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

/**
 * Chat Input Component with Slash Command Support
 * Uses ink-ui TextInput with built-in features
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { COLORS } from "./theme.ts";
import { getSlashCommandSuggestions, SLASH_COMMANDS } from "./slashCommands.ts";
import { CommandAutocomplete } from "./components/CommandAutocomplete.tsx";

interface ChatInputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSubmit, disabled = false, placeholder }: ChatInputProps): React.ReactElement {
  // Local state - isolated from parent re-renders
  const [value, setValue] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  // Get suggestions based on current input
  const suggestions = useMemo(() => {
    if (!value.startsWith("/")) {
      return [];
    }
    return getSlashCommandSuggestions(value);
  }, [value]);

  // Build autocomplete suggestions for ink-ui TextInput
  const commandSuggestions = useMemo(() => {
    if (!value.startsWith("/")) return [];
    return SLASH_COMMANDS.map((cmd) => `/${cmd.name}`);
  }, [value]);

  // Show autocomplete when typing a command
  const shouldShowAutocomplete = showAutocomplete && suggestions.length > 0 && value.startsWith("/");

  const handleSubmit = useCallback((submitValue: string) => {
    if (!submitValue.trim()) return;
    onSubmit(submitValue.trim());
    setValue(""); // Clear after submit
    setShowAutocomplete(false);
    setAutocompleteIndex(0);
  }, [onSubmit]);

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue);
    // Show autocomplete when typing / at the start
    if (newValue.startsWith("/")) {
      setShowAutocomplete(true);
      setAutocompleteIndex(0);
    } else {
      setShowAutocomplete(false);
    }
  }, []);

  // Handle special keys for autocomplete navigation
  useInput((input, key) => {
    if (disabled) return;

    // Only handle autocomplete navigation when showing
    if (shouldShowAutocomplete) {
      if (key.upArrow) {
        setAutocompleteIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        return;
      }
      if (key.downArrow) {
        setAutocompleteIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        return;
      }
      // Tab to complete
      if (key.tab && suggestions[autocompleteIndex]) {
        const cmd = suggestions[autocompleteIndex];
        setValue(`/${cmd.name} `);
        setShowAutocomplete(false);
        return;
      }
      // Escape to cancel autocomplete
      if (key.escape) {
        setShowAutocomplete(false);
        return;
      }
    }
  }, { isActive: !disabled });

  return (
    <Box flexDirection="column">
      {/* Autocomplete dropdown */}
      {shouldShowAutocomplete && (
        <CommandAutocomplete
          suggestions={suggestions}
          selectedIndex={autocompleteIndex}
          inputValue={value}
        />
      )}

      {/* Input box */}
      <Box
        borderStyle="single"
        borderColor={disabled ? COLORS.DIM : COLORS.ACCENT_DIM}
        paddingX={1}
        marginX={1}
      >
        <Text color={disabled ? COLORS.DIM : COLORS.ACCENT}>
          {">"}{" "}
        </Text>
        <TextInput
          isDisabled={disabled}
          placeholder={placeholder || "Ask Gordon anything... (try /help)"}
          suggestions={commandSuggestions}
          onChange={handleChange}
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
}

export default ChatInput;

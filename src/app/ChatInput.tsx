/**
 * Chat Input Component with Slash Command Support
 * Uses ink-ui TextInput with built-in features
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { COLORS } from "./theme.ts";
import { getSlashCommandSuggestions } from "./slashCommands.ts";
import { CommandAutocomplete } from "./components/CommandAutocomplete.tsx";
import {
  QuickActions,
  getQuickActionCommand,
  getQuickActionsCount,
} from "./components/QuickActions.tsx";

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
  const [inputKey, setInputKey] = useState(0); // Key to force TextInput remount
  const [quickActionIndex, setQuickActionIndex] = useState(0);

  // Show quick actions when input is empty
  const showQuickActions = !disabled && value.trim() === "";

  // Get suggestions based on current input
  const suggestions = useMemo(() => {
    if (!value.startsWith("/")) {
      return [];
    }
    return getSlashCommandSuggestions(value);
  }, [value]);

  // Show autocomplete when typing a command
  const shouldShowAutocomplete = showAutocomplete && suggestions.length > 0 && value.startsWith("/");

  const handleSubmit = useCallback((submitValue: string) => {
    if (!submitValue.trim()) return;

    // If autocomplete is showing and user presses Enter, use the selected command
    let finalValue = submitValue.trim();
    if (showAutocomplete && suggestions.length > 0 && suggestions[autocompleteIndex]) {
      const selectedCmd = suggestions[autocompleteIndex];
      // Extract any args after the partial command (e.g., "/ana btc" -> "btc")
      const parts = submitValue.trim().split(/\s+/);
      const args = parts.slice(1).join(" ");
      finalValue = args ? `/${selectedCmd.name} ${args}` : `/${selectedCmd.name}`;
    }

    onSubmit(finalValue);
    setValue(""); // Clear local state
    setShowAutocomplete(false);
    setAutocompleteIndex(0);
    setInputKey((k) => k + 1); // Force TextInput remount to clear its internal state
  }, [onSubmit, showAutocomplete, suggestions, autocompleteIndex]);

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

  // Handle quick action selection
  const handleQuickActionSelect = useCallback((command: string) => {
    onSubmit(command);
    setValue("");
    setQuickActionIndex(0);
    setInputKey((k) => k + 1);
  }, [onSubmit]);

  // Handle special keys for autocomplete and quick action navigation
  useInput((input, key) => {
    if (disabled) return;

    // Handle quick actions when input is empty
    if (showQuickActions) {
      // Number keys 1-5 to select quick actions
      const numKey = parseInt(input, 10);
      if (numKey >= 1 && numKey <= getQuickActionsCount()) {
        const command = getQuickActionCommand(numKey - 1);
        if (command) {
          handleQuickActionSelect(command);
          return;
        }
      }

      // Left/right arrow to navigate quick actions
      if (key.leftArrow) {
        setQuickActionIndex((prev) =>
          prev > 0 ? prev - 1 : getQuickActionsCount() - 1
        );
        return;
      }
      if (key.rightArrow) {
        setQuickActionIndex((prev) =>
          prev < getQuickActionsCount() - 1 ? prev + 1 : 0
        );
        return;
      }

      // Enter to select current quick action
      if (key.return && !value.trim()) {
        const command = getQuickActionCommand(quickActionIndex);
        if (command) {
          handleQuickActionSelect(command);
          return;
        }
      }
    }

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
      {/* Quick actions bar */}
      <QuickActions
        onSelect={handleQuickActionSelect}
        selectedIndex={quickActionIndex}
        visible={showQuickActions}
      />

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
          key={inputKey}
          isDisabled={disabled}
          placeholder={placeholder || "Ask Gordon anything... (try /help)"}
          onChange={handleChange}
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
}

export default ChatInput;

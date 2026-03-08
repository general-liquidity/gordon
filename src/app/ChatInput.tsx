/**
 * Chat Input Component with Slash Command Support
 * Uses ink-ui TextInput with built-in features
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { NoticeAlert } from "./components/PromptPrimitives.tsx";
import { COLORS } from "./theme.ts";
import { getSlashCommandSuggestions, parseSlashCommand } from "./slashCommands.ts";
import { CommandAutocomplete } from "./components/CommandAutocomplete.tsx";
import {
  QuickActions,
  getQuickActionCommand,
  getQuickActionsCount,
} from "./components/QuickActions.tsx";
import type { QuickActionContext } from "./commandUx.ts";

interface ChatInputProps {
  onSubmit: (value: string) => void;
  onOpenQuickActions?: () => void;
  onTypingStateChange?: (isTyping: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  queueDepth?: number;
  placeholder?: string;
  emptyStateHint?: string | null;
  quickActionContext: QuickActionContext;
  seedValue?: string;
  seedNonce?: number;
}

function ChatInputComponent({
  onSubmit,
  onOpenQuickActions,
  onTypingStateChange,
  disabled = false,
  busy = false,
  queueDepth = 0,
  placeholder,
  emptyStateHint = null,
  quickActionContext,
  seedValue = "",
  seedNonce = 0,
}: ChatInputProps): React.ReactElement {
  const normalizeInputValue = useCallback((input: string) => input.replace(/\r\n/g, "\n"), []);
  // Local state - isolated from parent re-renders
  const [value, setValue] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [inputKey, setInputKey] = useState(0); // Key to force TextInput remount
  const [quickActionIndex, setQuickActionIndex] = useState(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const emitTypingState = useCallback((isTyping: boolean) => {
    if (isTypingRef.current === isTyping) {
      return;
    }

    isTypingRef.current = isTyping;
    onTypingStateChange?.(isTyping);
  }, [onTypingStateChange]);

  const scheduleTypingIdle = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null;
      emitTypingState(false);
    }, 1200);
  }, [emitTypingState]);

  // Show quick actions when input is empty
  const showQuickActions = !disabled && !busy && value.trim() === "";

  // Get suggestions based on current input
  const suggestions = useMemo(() => {
    if (!value.startsWith("/")) {
      return [];
    }
    return getSlashCommandSuggestions(value);
  }, [value]);

  // Show autocomplete when typing a command
  const shouldShowAutocomplete = showAutocomplete && suggestions.length > 0 && value.startsWith("/");

  useEffect(() => {
    if (seedNonce === 0) {
      return;
    }

    const normalizedSeed = normalizeInputValue(seedValue);
    setValue(normalizedSeed);
    setShowAutocomplete(normalizedSeed.startsWith("/"));
    setAutocompleteIndex(0);
    setQuickActionIndex(0);
    setInputKey((k) => k + 1);
    if (normalizedSeed.length > 0) {
      emitTypingState(true);
      scheduleTypingIdle();
    } else {
      emitTypingState(false);
    }
  }, [emitTypingState, normalizeInputValue, scheduleTypingIdle, seedNonce, seedValue]);

  useEffect(() => () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    emitTypingState(false);
  }, [emitTypingState]);

  const handleSubmit = useCallback((submitValue: string) => {
    if (!submitValue.trim()) return;

    let finalValue = normalizeInputValue(submitValue).trim();

    // First, check if the user typed a complete valid command
    // This takes priority over autocomplete selection to avoid race conditions
    const parsedCommand = parseSlashCommand(finalValue);
    if (parsedCommand) {
      // User typed a valid command - use it directly (already in finalValue)
      // No need to modify finalValue
    } else if (showAutocomplete && suggestions.length > 0 && suggestions[autocompleteIndex]) {
      // Only use autocomplete selection if user typed a partial/invalid command
      const selectedCmd = suggestions[autocompleteIndex];
      // Extract any args after the partial command (e.g., "/ana btc" -> "btc")
      const parts = submitValue.trim().split(/\s+/);
      const args = parts.slice(1).join(" ");
      finalValue = args ? `/${selectedCmd.name} ${args}` : `/${selectedCmd.name}`;
    }

    onSubmit(finalValue);
    emitTypingState(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setValue(""); // Clear local state
    setShowAutocomplete(false);
    setAutocompleteIndex(0);
    setInputKey((k) => k + 1); // Force TextInput remount to clear its internal state
  }, [autocompleteIndex, emitTypingState, normalizeInputValue, onSubmit, showAutocomplete, suggestions]);

  const handleChange = useCallback((newValue: string) => {
    const normalizedValue = normalizeInputValue(newValue);
    setValue(normalizedValue);
    if (normalizedValue.length > 0) {
      emitTypingState(true);
      scheduleTypingIdle();
    } else {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      emitTypingState(false);
    }
    // Show autocomplete when typing / at the start
    if (normalizedValue.startsWith("/")) {
      setShowAutocomplete(true);
      setAutocompleteIndex(0);
    } else {
      setShowAutocomplete(false);
    }
  }, [emitTypingState, normalizeInputValue, scheduleTypingIdle]);

  // Handle quick action selection
  const handleQuickActionSelect = useCallback((command: string) => {
    onSubmit(command);
    emitTypingState(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setValue("");
    setQuickActionIndex(0);
    setInputKey((k) => k + 1);
  }, [emitTypingState, onSubmit]);

  // Handle special keys for autocomplete and quick action navigation
  useInput((input, key) => {
    if (disabled) return;

    // Handle quick actions when input is empty
    if (showQuickActions) {
      if (key.upArrow && onOpenQuickActions) {
        onOpenQuickActions();
        return;
      }

      // Number keys 1-5 to select quick actions
      const numKey = parseInt(input, 10);
      if (numKey >= 1 && numKey <= getQuickActionsCount(quickActionContext)) {
        const command = getQuickActionCommand(numKey - 1, quickActionContext);
        if (command) {
          handleQuickActionSelect(command);
          return;
        }
      }

      // Left/right arrow to navigate quick actions
      if (key.leftArrow) {
        setQuickActionIndex((prev) =>
          prev > 0 ? prev - 1 : getQuickActionsCount(quickActionContext) - 1
        );
        return;
      }
      if (key.rightArrow) {
        setQuickActionIndex((prev) =>
          prev < getQuickActionsCount(quickActionContext) - 1 ? prev + 1 : 0
        );
        return;
      }

      // Enter to select current quick action
      if (key.return && !value.trim()) {
        const command = getQuickActionCommand(quickActionIndex, quickActionContext);
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
      {emptyStateHint && showQuickActions && (
        <Box marginBottom={1} marginX={2}>
          <Text color={COLORS.DIM} italic>
            {emptyStateHint}
          </Text>
        </Box>
      )}

      {/* Quick actions bar */}
      <QuickActions
        onSelect={handleQuickActionSelect}
        selectedIndex={quickActionIndex}
        visible={showQuickActions}
        context={quickActionContext}
      />

      {/* Autocomplete dropdown */}
      {shouldShowAutocomplete && (
        <CommandAutocomplete
          suggestions={suggestions}
          selectedIndex={autocompleteIndex}
          inputValue={value}
        />
      )}

      {(busy || queueDepth > 0) && (
        <Box marginBottom={1} marginX={2}>
          <Text color={COLORS.DIM}>
            {busy
              ? "Enter queues a follow-up. Esc stops the current streamed response when possible. Use /steer <message> to redirect the next run."
              : "Queued follow-ups are ready to run."}
          </Text>
          {queueDepth > 0 && (
            <Text color={COLORS.HIGHLIGHT}> Queue: {queueDepth}</Text>
          )}
        </Box>
      )}

      {value.includes("\n") && (
        <NoticeAlert title="Multi-line input ready" variant="info">
          Enter submits the full pasted block. Gordon will keep the line breaks intact.
        </NoticeAlert>
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
          defaultValue={value}
          placeholder={placeholder || "Ask Gordon anything... (try /help)"}
          onChange={handleChange}
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
}

export const ChatInput = React.memo(ChatInputComponent);

export default ChatInput;

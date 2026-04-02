/**
 * Chat Input Component with Slash Command Support
 * Uses ink-ui TextInput with built-in features
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { NoticeAlert } from "./components/PromptPrimitives.tsx";
import { CommandBar } from "./components/workspace/CommandBar.tsx";
import { COLORS } from "./theme.ts";
import { getSlashCommandSuggestions, parseSlashCommand } from "./slashCommands.ts";
import { CommandAutocomplete } from "./components/CommandAutocomplete.tsx";
import { shouldShowInlineQuickActions } from "./chatFlow.ts";
import {
  QuickActions,
  getQuickActionCommand,
  getQuickActionsCount,
} from "./components/QuickActions.tsx";
import type { QuickActionContext } from "./commandUx.ts";

interface ChatInputProps {
  onSubmit: (value: string) => void;
  onWorkspaceShortcut?: (digit: string) => void;
  onOpenQuickActions?: () => void;
  onTypingStateChange?: (isTyping: boolean) => void;
  onDraftChange?: (value: string) => void;
  disabled?: boolean;
  busy?: boolean;
  queueDepth?: number;
  placeholder?: string;
  emptyStateHint?: string | null;
  quickActionContext: QuickActionContext;
  hasConversationMomentum?: boolean;
  seedValue?: string;
  seedNonce?: number;
}

function ChatInputComponent({
  onSubmit,
  onWorkspaceShortcut,
  onOpenQuickActions,
  onTypingStateChange,
  onDraftChange,
  disabled = false,
  busy = false,
  queueDepth = 0,
  placeholder,
  emptyStateHint = null,
  quickActionContext,
  hasConversationMomentum = false,
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
  const showQuickActions = shouldShowInlineQuickActions({
    disabled,
    busy,
    value,
    hasConversationMomentum,
  });

  // Get suggestions based on current input
  const suggestions = useMemo(() => {
    if (!value.startsWith("/")) {
      return [];
    }
    return getSlashCommandSuggestions(value);
  }, [value]);

  // Show autocomplete when typing a command
  const shouldShowAutocomplete = showAutocomplete && suggestions.length > 0 && value.startsWith("/");
  const promptTone = disabled
    ? COLORS.DIM
    : busy
      ? COLORS.AMBER
      : COLORS.BRASS;

  useEffect(() => {
    if (seedNonce === 0) {
      return;
    }

    const normalizedSeed = normalizeInputValue(seedValue);
    setValue(normalizedSeed);
    onDraftChange?.(normalizedSeed);
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
  }, [emitTypingState, normalizeInputValue, onDraftChange, scheduleTypingIdle, seedNonce, seedValue]);

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
    onDraftChange?.("");
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setValue(""); // Clear local state
    setShowAutocomplete(false);
    setAutocompleteIndex(0);
    setInputKey((k) => k + 1); // Force TextInput remount to clear its internal state
  }, [autocompleteIndex, emitTypingState, normalizeInputValue, onDraftChange, onSubmit, showAutocomplete, suggestions]);

  const handleChange = useCallback((newValue: string) => {
    const normalizedValue = normalizeInputValue(newValue);
    setValue(normalizedValue);
    onDraftChange?.(normalizedValue);
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
  }, [emitTypingState, normalizeInputValue, onDraftChange, scheduleTypingIdle]);

  // Handle quick action selection
  const handleQuickActionSelect = useCallback((command: string) => {
    onSubmit(command);
    emitTypingState(false);
    onDraftChange?.("");
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setValue("");
    setQuickActionIndex(0);
    setInputKey((k) => k + 1);
  }, [emitTypingState, onDraftChange, onSubmit]);

  // Handle special keys for autocomplete and quick action navigation
  useInput((input, key) => {
    if (disabled) return;

    if (!value.trim() && /^[1-5]$/.test(input) && onWorkspaceShortcut) {
      onWorkspaceShortcut(input);
      setValue("");
      onDraftChange?.("");
      setShowAutocomplete(false);
      setAutocompleteIndex(0);
      setQuickActionIndex(0);
      setInputKey((k) => k + 1);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      emitTypingState(false);
      return;
    }

    // Handle quick actions when input is empty
    if (showQuickActions) {
      if (key.upArrow && onOpenQuickActions) {
        onOpenQuickActions();
        return;
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

      {value.includes("\n") && (
        <NoticeAlert title="Multi-line input ready" variant="info">
          Enter submits the full pasted block. Gordon will keep the line breaks intact.
        </NoticeAlert>
      )}

      <CommandBar
        busy={busy}
        queueDepth={queueDepth}
        disabled={disabled}
        autocomplete={shouldShowAutocomplete ? (
          <CommandAutocomplete
            suggestions={suggestions}
            selectedIndex={autocompleteIndex}
            inputValue={value}
            embedded
            maxVisible={6}
            showCategories={false}
          />
        ) : null}
        hint={busy
          ? "Enter queues. Esc stops."
          : queueDepth > 0
            ? `Queue ${queueDepth} ready. Enter sends next.`
            : "Enter sends. /help opens the book."}
      >
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.DIM}>route</Text>
            <Text color={promptTone} bold>
              {busy ? " »" : " >"}
            </Text>
            <Text color={promptTone}> </Text>
            <TextInput
              key={inputKey}
              isDisabled={disabled}
              defaultValue={value}
              placeholder={placeholder || "Ask Gordon anything... (try /help)"}
              onChange={handleChange}
              onSubmit={handleSubmit}
            />
            {disabled && (
              <Text color={COLORS.DIM}>  prompt locked</Text>
            )}
          </Box>
        </Box>
      </CommandBar>
    </Box>
  );
}

export const ChatInput = React.memo(ChatInputComponent);

export default ChatInput;

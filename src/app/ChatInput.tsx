/**
 * Isolated Chat Input Component
 * Manages its own state to prevent re-render issues from parent updates
 */

import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  DIM: "#a39e93",
} as const;

interface ChatInputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSubmit, disabled = false, placeholder }: ChatInputProps): React.ReactElement {
  // Local state - isolated from parent re-renders
  const [value, setValue] = useState("");

  const handleSubmit = useCallback((submitValue: string) => {
    if (!submitValue.trim()) return;
    onSubmit(submitValue.trim());
    setValue(""); // Clear after submit
  }, [onSubmit]);

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue);
  }, []);

  return (
    <Box
      borderStyle="single"
      borderColor={disabled ? COLORS.DIM : COLORS.TAN_DIM}
      paddingX={1}
      marginX={1}
    >
      <Text color={disabled ? COLORS.DIM : COLORS.TAN}>
        {">"}{" "}
      </Text>
      <TextInput
        value={value}
        onChange={handleChange}
        onSubmit={handleSubmit}
        placeholder={placeholder || "Ask Gordon anything..."}
      />
    </Box>
  );
}

export default ChatInput;

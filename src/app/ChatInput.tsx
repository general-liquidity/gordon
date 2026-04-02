import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";

import { COLORS } from "./theme.ts";

export const ChatInput: React.FC<{
  placeholder: string;
  busy: boolean;
  canCancel: boolean;
  seedValue: string;
  seedNonce: number;
  disabled?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onTypingStateChange: (typing: boolean) => void;
  onWorkspaceShortcut: (digit: string) => void;
}> = ({
  placeholder,
  busy,
  canCancel,
  seedValue,
  seedNonce,
  disabled = false,
  onSubmit,
  onCancel,
  onDraftChange,
  onTypingStateChange,
  onWorkspaceShortcut,
}) => {
  const [value, setValue] = useState(seedValue);

  useEffect(() => {
    setValue(seedValue);
    onDraftChange(seedValue);
    onTypingStateChange(seedValue.trim().length > 0);
  }, [onDraftChange, onTypingStateChange, seedNonce, seedValue]);

  useInput((input, key) => {
    if (disabled) return;
    if (key.ctrl || key.meta || key.tab) return;

    if (key.return) {
      const submission = value.trim();
      if (submission.length > 0) {
        void onSubmit(submission);
        setValue("");
        onDraftChange("");
        onTypingStateChange(false);
      }
      return;
    }

    if (key.escape && busy && canCancel) {
      onCancel();
      return;
    }

    if (key.backspace || key.delete) {
      const next = value.slice(0, -1);
      setValue(next);
      onDraftChange(next);
      onTypingStateChange(next.trim().length > 0);
      return;
    }

    if (value.length === 0 && /^[1-5]$/u.test(input)) {
      onWorkspaceShortcut(input);
      return;
    }

    if (input.length > 0) {
      const next = value + input;
      setValue(next);
      onDraftChange(next);
      onTypingStateChange(next.trim().length > 0);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={busy ? COLORS.AMBER : COLORS.BRASS}
      paddingX={1}
      marginTop={1}
    >
      <Text color={busy ? COLORS.AMBER : COLORS.BRASS} bold>
        COMMAND BAR
        <Text color={COLORS.DIM}> · {busy ? "live queue engaged" : "ready"}</Text>
      </Text>
      <Text color={value.length > 0 ? COLORS.WHITE : COLORS.DIM}>
        {value.length > 0 ? ">" : "·"} {value.length > 0 ? value : placeholder}
      </Text>
      <Text color={COLORS.DIM}>
        {busy ? "Enter queues. Esc stops." : "Enter sends. 1-5 route when empty. Ctrl+K actions."}
      </Text>
    </Box>
  );
};

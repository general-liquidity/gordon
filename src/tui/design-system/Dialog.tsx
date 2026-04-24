import React, { type ReactNode } from "react";
import { Box, Text, useInput, useStdout } from "../ink-custom";

// ============================================================================
// Dialog — Modal dialog wrapper with border, title, and key handling
//
// ╭─ Title ──────────────────────────╮
// │  Optional subtitle               │
// │  children                        │
// ╰──────────────────────────────────╯
//
// Escape closes, Enter confirms. Captures input when mounted.
// ============================================================================

interface Props {
  title: string;
  subtitle?: string;
  color?: string;
  onClose: () => void;
  onConfirm?: () => void;
  children: ReactNode;
}

export function Dialog({ title, subtitle, color = "yellow", onClose, onConfirm, children }: Props) {
  const { stdout } = useStdout();
  const width = Math.min(stdout?.columns ?? 80, 60);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
    } else if (key.return && onConfirm) {
      onConfirm();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      width={width}
      paddingX={1}
    >
      <Text color={color} bold>
        {title}
      </Text>
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  );
}

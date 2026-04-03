import React, { type ReactNode } from "react";
import { Box, Text, useStdout } from "ink";

// ============================================================================
// Pane — Bordered section container with colored top-line
//
// ┌── Title ──────────────────────────┐
// │  children                          │
// └────────────────────────────────────┘
//
// When modal=true, skips the divider and uses tighter padding.
// ============================================================================

interface Props {
  title?: string;
  color?: string;
  modal?: boolean;
  children: ReactNode;
}

export function Pane({ title, color = "cyan", modal = false, children }: Props) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  if (modal) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {title ? (
          <Text color={color} bold>
            {title}
          </Text>
        ) : null}
        {children}
      </Box>
    );
  }

  // Build the top border line
  const prefix = "\u2500\u2500 ";
  const suffix = " ";
  const titleStr = title ?? "";
  const lineChars = titleStr
    ? Math.max(0, width - prefix.length - titleStr.length - suffix.length - 2)
    : width - 2;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>
          {titleStr
            ? `${prefix}${titleStr}${suffix}${"\u2500".repeat(lineChars)}`
            : "\u2500".repeat(width - 2)}
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={2}>
        {children}
      </Box>
    </Box>
  );
}

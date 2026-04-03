import React from "react";
import { Box, Text, useStdout } from "ink";

// ============================================================================
// Divider — Horizontal rule with optional title
//
// ─────────────── or ──── TITLE ────────
// ============================================================================

interface Props {
  title?: string;
}

export function Divider({ title }: Props) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  if (title) {
    const titleWithPad = ` ${title} `;
    const remaining = Math.max(0, width - titleWithPad.length - 2);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return (
      <Box>
        <Text dimColor>
          {"\u2500".repeat(left)}{titleWithPad}{"\u2500".repeat(right)}
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text dimColor>{"\u2500".repeat(width - 2)}</Text>
    </Box>
  );
}

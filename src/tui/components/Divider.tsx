import React from "react";
import { Box, Text, useStdout } from "../ink-custom";

// ============================================================================
// Divider — Horizontal rule with optional title
//
// ─────────────── or ──── TITLE ────────
// ============================================================================

interface Props {
  title?: string;
  color?: string;
  style?: "solid" | "dashed" | "double";
}

const CHARS = { solid: "\u2500", dashed: "\u2504", double: "\u2550" };

export function Divider({ title, color, style = "solid" }: Props) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  if (title) {
    const titleWithPad = ` ${title} `;
    const remaining = Math.max(0, width - titleWithPad.length - 2);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    const ch = CHARS[style];
    return (
      <Box>
        <Text dimColor={!color} color={color}>
          {ch.repeat(left)}{titleWithPad}{ch.repeat(right)}
        </Text>
      </Box>
    );
  }

  const ch = CHARS[style];
  return (
    <Box>
      <Text dimColor={!color} color={color}>{ch.repeat(width - 2)}</Text>
    </Box>
  );
}

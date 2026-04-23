import React from "react";
import { Text } from "ink";

// ============================================================================
// ProgressBar — Unicode block progress indicator
//
// precision="char" (default): whole-character fill, no partial blocks
// precision="block": 8-level sub-character precision using Unicode block elements
//   [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']
// ============================================================================

interface Props {
  value: number;
  width?: number;
  fillColor?: string;
  emptyColor?: string;
  /** "char" = whole-character fill (default). "block" = 8-level sub-character precision. */
  precision?: "block" | "char";
}

const BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];

export function ProgressBar({
  value,
  width = 20,
  fillColor = "cyanBright",
  emptyColor,
  precision = "char",
}: Props) {
  const clamped = Math.max(0, Math.min(1, value));

  let filled: string;
  let partial: string;
  let empty: string;

  if (precision === "block") {
    // 8-level sub-character precision
    const totalEighths = clamped * width * 8;
    const fullChars = Math.floor(totalEighths / 8);
    const partialIndex = Math.round(totalEighths % 8);
    const emptyChars = Math.max(0, width - fullChars - (partialIndex > 0 ? 1 : 0));

    filled = (BLOCKS[8] ?? "█").repeat(fullChars);
    partial = partialIndex > 0 ? (BLOCKS[partialIndex] ?? "") : "";
    empty = " ".repeat(emptyChars);
  } else {
    // Whole-character fill (default "char" behavior)
    const fullChars = Math.round(clamped * width);
    const emptyChars = width - fullChars;

    filled = (BLOCKS[8] ?? "█").repeat(fullChars);
    partial = "";
    empty = " ".repeat(emptyChars);
  }

  return (
    <Text>
      <Text color={fillColor}>{filled}{partial}</Text>
      <Text dimColor={!!emptyColor} color={emptyColor}>{empty}</Text>
    </Text>
  );
}

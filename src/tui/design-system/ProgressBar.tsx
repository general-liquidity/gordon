import React from "react";
import { Text } from "ink";

// ============================================================================
// ProgressBar — Unicode block progress indicator
//
// Uses 9-level sub-character blocks for smooth appearance:
//   [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']
// ============================================================================

interface Props {
  value: number;
  width?: number;
  fillColor?: string;
  emptyColor?: string;
}

const BLOCKS = [" ", "\u258F", "\u258E", "\u258D", "\u258C", "\u258B", "\u258A", "\u2589", "\u2588"];

export function ProgressBar({ value, width = 20, fillColor = "cyanBright", emptyColor }: Props) {
  const clamped = Math.max(0, Math.min(1, value));
  const totalEighths = clamped * width * 8;
  const fullChars = Math.floor(totalEighths / 8);
  const partialIndex = Math.round(totalEighths % 8);
  const emptyChars = Math.max(0, width - fullChars - (partialIndex > 0 ? 1 : 0));

  const filled = BLOCKS[8]!.repeat(fullChars);
  const partial = partialIndex > 0 ? (BLOCKS[partialIndex] ?? "") : "";
  const empty = " ".repeat(emptyChars);

  return (
    <Text>
      <Text color={fillColor}>{filled}{partial}</Text>
      <Text dimColor={!!emptyColor} color={emptyColor}>{empty}</Text>
    </Text>
  );
}

import React from "react";
import { Text } from "ink";

// ============================================================================
// ShimmerChar — Single character with glimmer highlight
//
// When charIndex matches glimmerIndex: bold + cyanBright
// When charIndex is ±1 of glimmerIndex: cyanBright (no bold)
// Otherwise: default (dimColor for subtle background)
// ============================================================================

interface Props {
  char: string;
  glimmerIndex: number;
  charIndex: number;
}

export const ShimmerChar = React.memo(function ShimmerChar({ char, glimmerIndex, charIndex }: Props) {
  const distance = Math.abs(charIndex - glimmerIndex);

  if (distance === 0) {
    return (
      <Text bold color="cyanBright">
        {char}
      </Text>
    );
  }

  if (distance === 1) {
    return (
      <Text color="cyanBright">
        {char}
      </Text>
    );
  }

  return <Text dimColor>{char}</Text>;
});

import React from "react";
import { Text } from "../ink-custom";
import { useAnimationClock } from "../hooks/useAnimationClock.js";

// ============================================================================
// FlashingChar — A character that flashes on/off to draw attention
//
// Uses the shared animation clock at the specified intervalMs. Toggles
// visible on odd frames and invisible on even frames. When not visible,
// renders a space of the same display width so layout is stable.
// ============================================================================

interface Props {
  /** Character to flash — default "!" */
  char?: string;
  /** Ink color string — default "yellow" */
  color?: string;
  /** Flash interval in ms — default 400 */
  intervalMs?: number;
  /** Whether to render the character bold */
  bold?: boolean;
}

export function FlashingChar({ char = "!", color = "yellow", intervalMs = 400, bold = false }: Props) {
  const frame = useAnimationClock(intervalMs);
  const visible = frame % 2 === 1;

  if (!visible) {
    // Preserve layout width — render a space matching the char width
    return <Text>{" ".repeat(char.length)}</Text>;
  }

  return (
    <Text color={color} bold={bold}>
      {char}
    </Text>
  );
}

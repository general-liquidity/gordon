import React from "react";
import { Text, useStdout } from "ink";
import { useAnimationClock } from "../hooks/useAnimationClock.js";

// ============================================================================
// UnseenDivider — "N new messages" indicator at viewport bottom
//
// Shown when the user has scrolled up and new messages have arrived below
// the visible area. The G key (handled by VirtualMessageList) triggers
// onJumpToBottom — this component is purely visual.
// ============================================================================

interface Props {
  count: number;
  onJumpToBottom: () => void;
}

export function UnseenDivider({ count }: Props) {
  const clockFrame = useAnimationClock(500);
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  if (count <= 0) return null;

  // Arrow blinks: solid on even frames, invisible on odd frames
  const arrow = clockFrame % 2 === 0 ? "↓" : " ";

  // Use a fixed-width pill string for dash calculation so the layout
  // never reflows when the arrow blinks (↓ and space are both 1 column wide)
  const pillFixed = ` ↓  ${count} new `;

  const dashCount = Math.max(0, Math.floor((termWidth - pillFixed.length - 2) / 2));
  const dashes = "─".repeat(dashCount);

  return (
    <Text>
      <Text dimColor>{dashes} </Text>
      <Text color="cyanBright" bold>
        {arrow}
      </Text>
      <Text color="cyanBright">{"  " + count + " new"}</Text>
      <Text dimColor>{" " + dashes}</Text>
    </Text>
  );
}

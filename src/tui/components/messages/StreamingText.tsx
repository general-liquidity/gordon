import React, { useState, useEffect } from "react";
import { Text } from "../../ink-custom";
import { useAnimationClock } from "../../hooks/animation/useAnimationClock.js";

// ============================================================================
// StreamingText — Word-by-word text appearance with cursor
//
// Simulates the streaming feel of LLM output.
// When content updates externally (from stream), it renders immediately.
// The shimmer cursor ▊ blinks at the end during streaming.
// ============================================================================

interface Props {
  content: string;
  isStreaming: boolean;
  color?: string;
}

export function StreamingText({ content, isStreaming, color }: Props) {
  const [cursorVisible, setCursorVisible] = useState(true);

  // Shared clock for cursor blink (500ms cycle = every 10th frame at 50ms)
  const clockFrame = useAnimationClock(isStreaming ? 50 : 0);

  useEffect(() => {
    if (!isStreaming) {
      setCursorVisible(false);
      return;
    }
    // Toggle every ~500ms (10 frames at 50ms)
    setCursorVisible(Math.floor(clockFrame / 10) % 2 === 0);
  }, [clockFrame, isStreaming]);

  return (
    <Text color={color}>
      {content}
      {isStreaming && cursorVisible ? <Text color="rgb(52,238,176)">{"\u2588"}</Text> : null}
    </Text>
  );
}

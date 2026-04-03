import React, { useState, useEffect } from "react";
import { Text } from "ink";

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

  // Blink cursor during streaming
  useEffect(() => {
    if (!isStreaming) {
      setCursorVisible(false);
      return;
    }
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(interval);
  }, [isStreaming]);

  return (
    <Text color={color}>
      {content}
      {isStreaming && cursorVisible ? <Text color="cyanBright">{"\u2588"}</Text> : null}
    </Text>
  );
}

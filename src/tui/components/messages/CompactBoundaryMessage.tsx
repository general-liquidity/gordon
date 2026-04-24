import React from "react";
import { Box, Text, useStdout } from "../../ink-custom";
import type { Message } from "../MessageBubble.js";

// CompactBoundaryMessage — separator line shown when the conversation is compacted.
// Renders a centered label flanked by dim dashes:
//   ── ✦ conversation compacted · 847 tokens freed ──
function CompactBoundaryMessageInner({ message }: { message: Message }) {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  const label = ` ✶ ${message.content || "conversation compacted"} `;
  const totalDashes = Math.max(0, width - label.length - 4);
  const left = Math.floor(totalDashes / 2);
  const right = totalDashes - left;
  const dash = "─";

  return (
    <Box marginTop={1} flexDirection="row">
      <Text dimColor>{dash.repeat(left)}</Text>
      <Text dimColor>{" "}</Text>
      <Text color="cyanBright">{"✶"}</Text>
      <Text dimColor>{" "}{message.content || "conversation compacted"}{" "}</Text>
      <Text dimColor>{dash.repeat(right)}</Text>
    </Box>
  );
}

export const CompactBoundaryMessage = React.memo(
  CompactBoundaryMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

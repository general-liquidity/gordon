import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Compact/resume messages: single dim line with icon.
export const CompactMessage = React.memo(function CompactMessage({
  message,
}: {
  message: Message;
}) {
  const isResume = message.variant === "resume";
  const icon = isResume ? "\u21BB" : "\u273B";
  // variant "compact" is the tool-result COLLAPSE (">N tool results"), not memory
  // compaction \u2014 real compaction is variant "compact_boundary". Show the content
  // (e.g. "11 tool results") as the label so a multi-tool turn doesn't masquerade
  // as a conversation compaction on every turn.
  const label = isResume ? "session resumed" : message.content || "conversation compacted";

  return (
    <Box marginTop={0} paddingLeft={2}>
      <Text dimColor>
        {icon} {label}
      </Text>
    </Box>
  );
});

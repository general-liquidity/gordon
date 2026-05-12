import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Compact/resume messages: single dim line with icon.
export const CompactMessage = React.memo(function CompactMessage({ message }: { message: Message }) {
  const isResume = message.variant === "resume";
  const icon = isResume ? "\u21BB" : "\u273B";
  const label = isResume ? "session resumed" : "conversation compacted";

  return (
    <Box marginTop={0} paddingLeft={2}>
      <Text dimColor>{icon} {label}</Text>
      {message.content && <Text dimColor> {"\u00b7"} {message.content}</Text>}
    </Box>
  );
});

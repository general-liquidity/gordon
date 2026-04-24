import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "../MessageBubble.js";

// AssistantRedactedThinkingMessage — compact "thinking redacted" indicator.
// Small and unobtrusive; shown when extended thinking output is redacted.
function AssistantRedactedThinkingMessageInner({ message: _ }: { message: Message }) {
  return (
    <Box marginTop={1}>
      <Text dimColor>{"  ⋯ thinking redacted"}</Text>
    </Box>
  );
}

export const AssistantRedactedThinkingMessage = React.memo(
  AssistantRedactedThinkingMessageInner,
  (prev, next) => prev.message.id === next.message.id,
);

import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// User messages: Claude Code-style ">" prefix, no background box.
function UserMessageInner({ message }: { message: Message }) {
  return (
    <Box marginTop={1} flexDirection="row">
      <Text color="green" bold>{">"}</Text>
      <Text>{" "}</Text>
      <Box flexGrow={1}>
        <Text dimColor>{message.content}</Text>
      </Box>
    </Box>
  );
}

/** React.memo'd — user messages are immutable once sent. */
export const UserMessage = React.memo(
  UserMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

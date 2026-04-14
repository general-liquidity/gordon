import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// User messages: full-width background box (Claude Code pattern).
// Background stretches to terminal edge regardless of text length.
function UserMessageInner({ message }: { message: Message }) {
  return (
    <Box
      marginTop={1}
      paddingX={2}
      paddingY={0}
      width="100%"
      backgroundColor="gray"
    >
      <Text bold color="white">{message.content}</Text>
    </Box>
  );
}

/** React.memo'd — user messages are immutable once sent. */
export const UserMessage = React.memo(
  UserMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

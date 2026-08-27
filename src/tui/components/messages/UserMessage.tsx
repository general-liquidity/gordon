import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// User messages: Claude Code style — green ">" prefix, content rendered
// in default terminal color (NOT dimColor — that turned every prompt
// into dark gray and made the chat look read-only). No background box,
// no border; the ">" alone is the affordance.
function UserMessageInner({ message }: { message: Message }) {
  return (
    <Box marginTop={1} flexDirection="row">
      <Text color="green" bold>
        {">"}
      </Text>
      <Text> </Text>
      <Box flexGrow={1}>
        <Text>{message.content}</Text>
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

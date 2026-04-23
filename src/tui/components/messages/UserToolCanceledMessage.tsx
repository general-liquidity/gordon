import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// UserToolCanceledMessage — canceled tool execution.
// Renders: ⎿ ⊘ {content}
function UserToolCanceledMessageInner({ message }: { message: Message }) {
  return (
    <Box flexDirection="row" marginTop={0}>
      <Text dimColor>{"⎿ "}</Text>
      <Text color="yellow" dimColor>{"⊘"}</Text>
      <Text>{" "}</Text>
      <Text dimColor>{message.content}</Text>
    </Box>
  );
}

export const UserToolCanceledMessage = React.memo(
  UserToolCanceledMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "../MessageBubble.js";

// UserToolErrorMessage — failed tool execution result.
// Renders: ⎿ ✗ {content}
function UserToolErrorMessageInner({ message }: { message: Message }) {
  return (
    <Box flexDirection="row" marginTop={0}>
      <Text dimColor>{"⎿ "}</Text>
      <Text color="red">{"✗"}</Text>
      <Text>{" "}</Text>
      <Text color="red" dimColor>{message.content}</Text>
    </Box>
  );
}

export const UserToolErrorMessage = React.memo(
  UserToolErrorMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

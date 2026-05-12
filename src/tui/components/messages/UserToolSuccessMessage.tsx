import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// UserToolSuccessMessage — successful tool execution result.
// Renders: ⎿ ✓ {content}
function UserToolSuccessMessageInner({ message }: { message: Message }) {
  return (
    <Box flexDirection="row" marginTop={0}>
      <Text dimColor>{"⎿ "}</Text>
      <Text color="green">{"✓"}</Text>
      <Text>{" "}</Text>
      <Text dimColor>{message.content}</Text>
    </Box>
  );
}

export const UserToolSuccessMessage = React.memo(
  UserToolSuccessMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// UserToolRejectMessage — tool rejected by the risk kernel.
// Renders: ⎿ ⊘ Rejected by risk kernel: {content}
function UserToolRejectMessageInner({ message }: { message: Message }) {
  return (
    <Box flexDirection="row" marginTop={0}>
      <Text dimColor>{"⎿ "}</Text>
      <Text color="yellow">{"⊘"}</Text>
      <Text>{" "}</Text>
      <Text color="yellow" bold>{"Rejected by risk kernel"}</Text>
      <Text color="yellow">{": "}</Text>
      <Text color="yellow">{message.content}</Text>
    </Box>
  );
}

export const UserToolRejectMessage = React.memo(
  UserToolRejectMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

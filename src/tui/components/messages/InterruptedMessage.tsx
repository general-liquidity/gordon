import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// InterruptedMessage — shown when user presses Ctrl+C to interrupt Gordon.
function InterruptedMessageInner({ message: _ }: { message: Message }) {
  return (
    <Box marginTop={1} paddingLeft={2}>
      <Text color="yellow">{"⊘ Interrupted"}</Text>
    </Box>
  );
}

export const InterruptedMessage = React.memo(
  InterruptedMessageInner,
  (prev, next) => prev.message.id === next.message.id,
);

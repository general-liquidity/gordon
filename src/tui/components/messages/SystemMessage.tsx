import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// System messages: single dim line, no badge. Minimal footprint.
function SystemMessageInner({ message }: { message: Message }) {
  return (
    <Box marginTop={0} paddingLeft={2}>
      <Text dimColor>{message.content}</Text>
    </Box>
  );
}

/** React.memo'd — system messages never change after render. */
export const SystemMessage = React.memo(
  SystemMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

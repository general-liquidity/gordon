import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// User messages: full-width background box (Claude Code pattern).
// Background stretches to terminal edge regardless of text length.
export function UserMessage({ message }: { message: Message }) {
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

import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// Error messages: ✗ error — single line, red, concise.
export function ErrorMessage({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="red">{"\u2717"} </Text>
        <Text bold color="red">error</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color="red">{message.content}</Text>
      </Box>
    </Box>
  );
}

import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Error messages: ✗ error — single line, red, concise.
export const ErrorMessage = React.memo(function ErrorMessage({ message }: { message: Message }) {
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
});

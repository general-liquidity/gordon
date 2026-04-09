import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// Shutdown: graceful exit notice with session summary
// Trading context: confirms positions are safe before exit
export function ShutdownMessage({ message }: { message: Message }) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Box paddingLeft={2}>
        <Text dimColor>{"\u25CB"} </Text>
        <Text dimColor>Session ended</Text>
        {message.content && (
          <>
            <Text dimColor> {"\u00b7"} </Text>
            <Text dimColor>{message.content}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

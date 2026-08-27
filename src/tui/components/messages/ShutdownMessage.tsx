import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Shutdown: graceful exit notice with session summary
// Trading context: confirms positions are safe before exit
export const ShutdownMessage = React.memo(function ShutdownMessage({
  message,
}: {
  message: Message;
}) {
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
});

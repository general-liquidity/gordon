import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Rate limit: shows when API or exchange throttles requests
// Trading context: exchange rate limits are critical — they can prevent order execution
export const RateLimitMessage = React.memo(function RateLimitMessage({
  message,
}: {
  message: Message;
}) {
  return (
    <Box marginTop={1}>
      <Box paddingLeft={2}>
        <Text color="yellow">{"\u26A0"} </Text>
        <Text color="yellow" bold>
          RATE LIMITED
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text dimColor>{message.content}</Text>
      </Box>
    </Box>
  );
});

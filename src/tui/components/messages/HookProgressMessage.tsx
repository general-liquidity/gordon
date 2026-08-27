import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Hook progress: shows lifecycle hook execution inline
// e.g., "Running PreTrade hook… constitution check"
// Trading context: constitution checks, risk hooks, position limits
export const HookProgressMessage = React.memo(function HookProgressMessage({
  message,
}: {
  message: Message;
}) {
  const isRunning = message.content.includes("running") || message.content.includes("Running");
  return (
    <Box paddingLeft={2}>
      <Text dimColor>{isRunning ? "\u25CF " : "\u2713 "}</Text>
      <Text dimColor bold>
        {message.agent ?? "hook"}
      </Text>
      <Text dimColor> {message.content}</Text>
    </Box>
  );
});

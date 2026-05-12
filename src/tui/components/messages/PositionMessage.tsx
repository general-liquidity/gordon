import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Position lifecycle: opened, closed, updated — shows symbol, side, P&L
export const PositionMessage = React.memo(function PositionMessage({ message }: { message: Message }) {
  // Parse structured content if available
  const isClose = message.content.includes("closed") || message.content.includes("P&L");
  const icon = isClose ? "\u25C8" : "\u25CF";
  const color = isClose
    ? (message.content.includes("+") ? "green" : "red")
    : "cyanBright";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold color={color}>POSITION</Text>
        {message.agent && <Text dimColor> {"\u00b7"} {message.agent}</Text>}
      </Box>
      <Box paddingLeft={2}>
        <Text>{message.content}</Text>
      </Box>
    </Box>
  );
});

import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Order events: placed, filled, cancelled, rejected
export const OrderMessage = React.memo(function OrderMessage({ message }: { message: Message }) {
  const isFill = message.content.includes("filled") || message.content.includes("executed");
  const isCancel = message.content.includes("cancel");
  const isReject = message.content.includes("reject");

  const icon = isFill ? "\u2713" : isCancel ? "\u2717" : isReject ? "\u2717" : "\u25CF";
  const color = isFill ? "green" : isCancel ? "yellow" : isReject ? "red" : "cyanBright";
  const label = isFill ? "FILLED" : isCancel ? "CANCELLED" : isReject ? "REJECTED" : "ORDER";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold color={color}>{label}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>{message.content}</Text>
      </Box>
    </Box>
  );
});

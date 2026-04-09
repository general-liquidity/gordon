import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// System messages: single dim line, no badge. Minimal footprint.
export function SystemMessage({ message }: { message: Message }) {
  return (
    <Box marginTop={0} paddingLeft={2}>
      <Text dimColor>{message.content}</Text>
    </Box>
  );
}

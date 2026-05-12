import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Paste detection: shows when user pastes large content
// Trading context: pasted addresses, tx hashes, trade logs
export const PasteDetectionMessage = React.memo(function PasteDetectionMessage({ message }: { message: Message }) {
  const lines = message.content.split("\n").length;
  return (
    <Box paddingLeft={2}>
      <Text dimColor>[Pasted text +{lines} line{lines !== 1 ? "s" : ""}]</Text>
    </Box>
  );
});

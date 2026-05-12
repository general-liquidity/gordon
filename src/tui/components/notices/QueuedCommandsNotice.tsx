import React from "react";
import { Box, Text } from "../../ink-custom";

// Queued commands display — shows when user types while Gordon is streaming
interface Props {
  count: number;
}

export function QueuedCommandsNotice({ count }: Props) {
  if (count === 0) return null;
  return (
    <Box paddingLeft={2}>
      <Text dimColor>{count} message{count !== 1 ? "s" : ""} queued — will send when Gordon finishes</Text>
    </Box>
  );
}

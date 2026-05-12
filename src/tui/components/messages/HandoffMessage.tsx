import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// Handoff messages: → agent — agent routing transitions.
export const HandoffMessage = React.memo(function HandoffMessage({ message }: { message: Message }) {
  return (
    <Box marginTop={0} paddingLeft={2}>
      <Text color="cyanBright">{"\u2192"} {message.agent ?? "agent"}</Text>
      {message.content && <Text dimColor> {"\u00b7"} {message.content}</Text>}
    </Box>
  );
});

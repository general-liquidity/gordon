import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// AdvisorMessage — Gordon's proactive advisory tips.
// Renders: ◈ {content}
function AdvisorMessageInner({ message }: { message: Message }) {
  return (
    <Box flexDirection="row" marginTop={1} paddingLeft={2}>
      <Text color="magenta">{"◈"}</Text>
      <Text>{" "}</Text>
      <Text>{message.content}</Text>
    </Box>
  );
}

export const AdvisorMessage = React.memo(
  AdvisorMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

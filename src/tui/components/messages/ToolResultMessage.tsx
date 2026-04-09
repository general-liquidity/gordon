import React from "react";
import { Box, Text } from "ink";
import { RichContent } from "../RichContent.js";
import { NoSelect } from "../NoSelect.js";
import type { Message } from "../MessageBubble.js";

// Tool result messages: dimmed, with ⎿ hook. Shows tool output inline.
export function ToolResultMessage({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginTop={0}>
      <Box>
        <NoSelect>{"\u231F  "}</NoSelect>
        <Box flexDirection="column" flexGrow={1}>
          <RichContent content={message.content} maxLines={5} />
        </Box>
      </Box>
    </Box>
  );
}

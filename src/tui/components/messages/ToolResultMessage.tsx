import React from "react";
import { Box, Text } from "../../ink-custom";
import { RichContent } from "../RichContent.js";
import { NoSelect } from "../NoSelect.js";
import type { Message } from "../MessageBubble.js";

// Tool result messages: dimmed, with ⎿ hook. Shows tool output inline.
function ToolResultMessageInner({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginTop={0}>
      <Box>
        <NoSelect>{"\u231F  "}</NoSelect>
        <Box flexDirection="column" flexGrow={1}>
          <RichContent content={message.content} />
        </Box>
      </Box>
    </Box>
  );
}

/** React.memo'd — tool results are immutable. */
export const ToolResultMessage = React.memo(
  ToolResultMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

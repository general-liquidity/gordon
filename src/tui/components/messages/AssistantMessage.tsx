import React from "react";
import { Box, Text } from "ink";
import { RichContent } from "../RichContent.js";
import { StreamingMarkdown } from "../StreamingMarkdown.js";
import { NoSelect } from "../NoSelect.js";
import type { Message } from "../MessageBubble.js";

// Assistant (gordon) messages: ⎿ hook + indented content.
// When streaming=true, renders with StreamingMarkdown (progressive + cursor).
// When streaming=false, renders with RichContent (final parsed output).
export function AssistantMessage({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <NoSelect>{"\u231F  "}</NoSelect>
        <Box flexDirection="column" flexGrow={1}>
          {message.streaming ? (
            <StreamingMarkdown content={message.content} isStreaming={true} />
          ) : (
            <RichContent content={message.content} maxLines={25} />
          )}
        </Box>
      </Box>
    </Box>
  );
}

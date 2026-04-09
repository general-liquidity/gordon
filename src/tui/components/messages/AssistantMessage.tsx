import React from "react";
import { Box } from "ink";
import { RichContent } from "../RichContent.js";
import { StreamingMarkdown } from "../StreamingMarkdown.js";
import { MessageResponse } from "../MessageResponseContext.js";
import type { Message } from "../MessageBubble.js";

// Assistant (gordon) messages: ⎿ hook via MessageResponse (prevents nesting).
// Streaming=true → StreamingMarkdown (progressive, stable prefix).
// Streaming=false → RichContent (final parsed output).
export function AssistantMessage({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <MessageResponse>
        {message.streaming ? (
          <StreamingMarkdown content={message.content} isStreaming={true} />
        ) : (
          <RichContent content={message.content} maxLines={25} />
        )}
      </MessageResponse>
    </Box>
  );
}

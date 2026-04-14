import React from "react";
import { Box } from "ink";
import { RichContent } from "../RichContent.js";
import { StreamingMarkdown } from "../StreamingMarkdown.js";
import { MessageResponse } from "../MessageResponseContext.js";
import type { Message } from "../MessageBubble.js";

// Assistant (gordon) messages: ⎿ hook via MessageResponse (prevents nesting).
// Streaming=true → StreamingMarkdown (progressive, stable prefix).
// Streaming=false → RichContent (final parsed output).
function AssistantMessageInner({ message }: { message: Message }) {
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

/**
 * React.memo'd — completed messages never re-render when new messages arrive
 * because the id + content + streaming flag are all stable. Only re-renders
 * when the streaming flag flips or the content actually changes (which for
 * completed messages is never).
 */
export const AssistantMessage = React.memo(
  AssistantMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.streaming === next.message.streaming,
);

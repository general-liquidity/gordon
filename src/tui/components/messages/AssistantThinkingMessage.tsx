import React from "react";
import { Box } from "ink";
import { ThinkStep } from "../ThinkStep.js";
import type { Message } from "../MessageBubble.js";

// AssistantThinkingMessage — wraps ThinkStep as a proper message variant.
// Extracts elapsed time from message.metadata.elapsed if present.
function AssistantThinkingMessageInner({ message }: { message: Message }) {
  const metadata = (message as Message & { metadata?: Record<string, unknown> }).metadata;
  const elapsedMs =
    metadata?.elapsed != null && typeof metadata.elapsed === "number"
      ? metadata.elapsed
      : undefined;

  return (
    <Box flexDirection="column" marginTop={1}>
      <ThinkStep
        reasoning={message.content}
        agentName={message.agent}
        elapsedMs={elapsedMs}
        isComplete={!message.streaming}
      />
    </Box>
  );
}

export const AssistantThinkingMessage = React.memo(
  AssistantThinkingMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

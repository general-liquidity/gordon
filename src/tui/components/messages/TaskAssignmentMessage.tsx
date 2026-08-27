import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";

// TaskAssignmentMessage — delegation event to a sub-agent.
// Renders: → Delegated to {agent}: {content}
function TaskAssignmentMessageInner({ message }: { message: Message }) {
  const agent = message.agent ?? "agent";
  return (
    <Box flexDirection="row" marginTop={1} paddingLeft={2}>
      <Text color="cyanBright">{"→"}</Text>
      <Text>{" Delegated to "}</Text>
      <Text color="cyanBright" bold>
        {agent}
      </Text>
      {message.content ? (
        <>
          <Text>{": "}</Text>
          <Text dimColor>{message.content}</Text>
        </>
      ) : null}
    </Box>
  );
}

export const TaskAssignmentMessage = React.memo(
  TaskAssignmentMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

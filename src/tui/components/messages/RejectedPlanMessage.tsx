import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// RejectedPlanMessage — a plan that failed risk/approval review.
// Renders a red-bordered compact notice:
//   ⊘ PLAN REJECTED
//     {content}
function RejectedPlanMessageInner({ message }: { message: Message }) {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor="red"
      paddingX={1}
    >
      <Box>
        <Text color="red" bold>{"⊘ PLAN REJECTED"}</Text>
      </Box>
      {message.content ? (
        <Box paddingLeft={2}>
          <Text color="red">{message.content}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export const RejectedPlanMessage = React.memo(
  RejectedPlanMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

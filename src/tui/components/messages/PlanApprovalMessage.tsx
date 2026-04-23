import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// PlanApprovalMessage — plan ready for human review.
// Renders a cyanBright-bordered box:
//   ◈ PLAN READY FOR REVIEW
//     {content}
//     [Enter] to approve in chat
function PlanApprovalMessageInner({ message }: { message: Message }) {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor="cyanBright"
      paddingX={2}
    >
      <Box>
        <Text color="cyanBright" bold>{"◈ PLAN READY FOR REVIEW"}</Text>
      </Box>
      {message.content ? (
        <Box paddingLeft={2}>
          <Text>{message.content}</Text>
        </Box>
      ) : null}
      <Box paddingLeft={2}>
        <Text dimColor>{"[Enter] to approve in chat"}</Text>
      </Box>
    </Box>
  );
}

export const PlanApprovalMessage = React.memo(
  PlanApprovalMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id && prev.message.content === next.message.content,
);

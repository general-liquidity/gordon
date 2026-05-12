import React from "react";
import { Box, Text } from "../../ink-custom";
import { RichContent } from "./RichContent.tsx";
import { NoSelect } from "../layout/NoSelect.tsx";
import type { Message } from "./MessageBubble.tsx";

// Approval messages: ⚠ APPROVAL [id] with action hints.
export const ApprovalMessage = React.memo(function ApprovalMessage({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="yellow">{"\u26A0"} </Text>
        <Text bold color="yellow">APPROVAL</Text>
        {message.badge && <Text color="yellow"> [{message.badge}]</Text>}
      </Box>
      <Box>
        <NoSelect>{"\u231F  "}</NoSelect>
        <Box flexDirection="column" flexGrow={1}>
          <RichContent content={message.content} />
        </Box>
      </Box>
      {message.badge && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {"\u2192 approve "}{message.badge}
            {"  \u2502  deny "}{message.badge}
            {"  \u2502  approve "}{message.badge}{" persist"}
          </Text>
        </Box>
      )}
    </Box>
  );
});

import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// UnseenDivider — "N new messages" indicator at viewport bottom
//
// Shown when the user has scrolled up and new messages have arrived below
// the visible area. Clicking/pressing Enter triggers onJumpToBottom.
// ============================================================================

interface Props {
  count: number;
  onJumpToBottom: () => void;
}

export function UnseenDivider({ count, onJumpToBottom }: Props) {
  if (count <= 0) return null;

  return (
    <Box justifyContent="center" marginTop={0} marginBottom={0}>
      <Text color="cyanBright" bold>
        {"\u2193"} {count} new message{count !== 1 ? "s" : ""}
      </Text>
      <Text dimColor> {"\u2502"} press G to jump </Text>
    </Box>
  );
}

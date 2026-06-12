import React from "react";
import { Box, Text, useInput } from "../../ink-custom";

export interface ResetSessionDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResetSessionDialog({ onConfirm, onCancel }: ResetSessionDialogProps): React.JSX.Element {
  useInput((input, key) => {
    if (key.escape || input === "n" || input === "N") {
      onCancel();
      return;
    }
    if (key.return || input === "y" || input === "Y") {
      onConfirm();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} paddingY={1}>
      <Text color="yellow" bold>Reset conversation?</Text>
      <Text dimColor>This clears the visible transcript, pending approvals, queued input, and turn summaries.</Text>
      <Text dimColor>The current session identity stays intact. Use /new-session for a fresh thread.</Text>
      <Box marginTop={1}>
        <Text color="yellow">Enter/y reset</Text>
        <Text dimColor> · Esc/n cancel</Text>
      </Box>
    </Box>
  );
}

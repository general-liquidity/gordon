import React from "react";
import { Box, Text, useInput } from "ink";

// Press Enter to continue — for critical trading confirmations
// Used before: emergency halt execution, large order confirmation, session exit
interface Props {
  message: string;
  severity?: "info" | "warning" | "critical";
  onConfirm: () => void;
  onCancel?: () => void;
}

export function PressEnterToContinue({ message, severity = "info", onConfirm, onCancel }: Props) {
  const color = severity === "critical" ? "red" : severity === "warning" ? "yellow" : "gray";

  useInput((_input, key) => {
    if (key.return) onConfirm();
    if (key.escape && onCancel) onCancel();
  });

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text color={color}>{message}</Text>
      <Text dimColor>Press Enter to continue{onCancel ? " or Esc to cancel" : ""}</Text>
    </Box>
  );
}

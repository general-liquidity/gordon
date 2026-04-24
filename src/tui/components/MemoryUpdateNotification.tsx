import React, { useState, useEffect } from "react";
import { Box, Text } from "../ink-custom";

// ============================================================================
// MemoryUpdateNotification — Banner when memory file is updated
// ============================================================================

interface Props { filePath: string; onDismiss: () => void; }

export function MemoryUpdateNotification({ filePath, onDismiss }: Props) {
  const [visible, setVisible] = useState(true);
  const fileName = filePath.split("/").pop() ?? filePath;

  useEffect(() => {
    const timer = setTimeout(() => { setVisible(false); onDismiss(); }, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!visible) return null;
  return (
    <Box>
      <Text color="cyan">{"\u2139"} </Text>
      <Text dimColor>Memory updated: </Text>
      <Text>{fileName}</Text>
    </Box>
  );
}

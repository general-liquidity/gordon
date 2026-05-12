import React from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// MessageActions — Per-message context menu (Shift+Up to activate)
// ============================================================================

interface Props { onCopy?: () => void; onRetry?: () => void; onPin?: () => void; onClose: () => void; }

export function MessageActions({ onCopy, onRetry, onPin, onClose }: Props) {
  useInput((input, key) => {
    if (key.escape) onClose();
    else if (input === "c" && onCopy) { onCopy(); onClose(); }
    else if (input === "r" && onRetry) { onRetry(); onClose(); }
    else if (input === "p" && onPin) { onPin(); onClose(); }
  });

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      {onCopy ? <Text dimColor>[c] Copy </Text> : null}
      {onRetry ? <Text dimColor>[r] Retry </Text> : null}
      {onPin ? <Text dimColor>[p] Pin </Text> : null}
      <Text dimColor>[Esc] Close</Text>
    </Box>
  );
}

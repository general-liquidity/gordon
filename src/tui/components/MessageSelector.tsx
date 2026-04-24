import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// MessageSelector — Visual message picker for rewind/branch operations
// ============================================================================

interface Message { role?: string; content?: string; timestamp?: number; }
interface Props { messages: Message[]; onSelect: (index: number) => void; onClose: () => void; }

function timeAgo(ts?: number): string {
  if (!ts) return "";
  const ms = Date.now() - ts;
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

export function MessageSelector({ messages, onSelect, onClose }: Props) {
  const userMessages = messages.map((m, i) => ({ ...m, originalIndex: i })).filter((m) => m.role === "user");
  const [selected, setSelected] = useState(0);

  useInput((_, key) => {
    if (key.escape) onClose();
    else if (key.return && userMessages[selected]) onSelect(userMessages[selected]!.originalIndex);
    else if (key.upArrow) setSelected((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelected((p) => Math.min(userMessages.length - 1, p + 1));
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">Select a message ({userMessages.length} user messages)</Text>
      {userMessages.slice(Math.max(0, selected - 5), selected + 10).map((msg, i) => {
        const actualI = i + Math.max(0, selected - 5);
        return (
          <Box key={actualI}>
            <Text color={actualI === selected ? "cyanBright" : undefined}>
              {actualI === selected ? "\u25B8 " : "  "}
            </Text>
            <Text dimColor>{String(actualI + 1).padStart(3)} </Text>
            <Text bold={actualI === selected}>{(msg.content ?? "").slice(0, 50)}</Text>
            <Text dimColor> {timeAgo(msg.timestamp)}</Text>
          </Box>
        );
      })}
      <Text dimColor>Enter to select {"\u00B7"} Esc to close</Text>
    </Box>
  );
}

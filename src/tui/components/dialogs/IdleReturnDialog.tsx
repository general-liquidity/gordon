import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// IdleReturnDialog — "You've been away" with options
// ============================================================================

interface Props {
  idleDurationMs: number;
  tokenCount: number;
  onContinue: () => void;
  onClearAndRestart: () => void;
  onDismiss: () => void;
  onNeverShowAgain: () => void;
}

const OPTIONS = [
  "Continue this conversation",
  "Clear context and start fresh",
  "Dismiss",
  "Never show again",
];

export function IdleReturnDialog({
  idleDurationMs,
  tokenCount,
  onContinue,
  onClearAndRestart,
  onDismiss,
  onNeverShowAgain,
}: Props) {
  const [selected, setSelected] = useState(0);
  const minutes = Math.round(idleDurationMs / 60000);
  const handlers = [onContinue, onClearAndRestart, onDismiss, onNeverShowAgain];

  useInput((_, key) => {
    if (key.escape) onDismiss();
    else if (key.return) handlers[selected]!();
    else if (key.upArrow) setSelected((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelected((p) => Math.min(OPTIONS.length - 1, p + 1));
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyanBright">
        Welcome back!
      </Text>
      <Text>
        You've been away for <Text bold>{minutes}m</Text>. Conversation is{" "}
        <Text bold>{(tokenCount / 1000).toFixed(1)}k</Text> tokens.
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => (
          <Box key={i}>
            <Text color={i === selected ? "cyanBright" : undefined}>
              {i === selected ? "\u25B8 " : "  "}
              {opt}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

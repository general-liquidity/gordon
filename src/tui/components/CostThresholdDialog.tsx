import React from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// CostThresholdDialog — Alert when session API cost exceeds threshold
// ============================================================================

interface Props { currentCost: number; threshold: number; onDismiss: () => void; }

export function CostThresholdDialog({ currentCost, threshold, onDismiss }: Props) {
  useInput((_, key) => { if (key.escape || key.return) onDismiss(); });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">{"\u26A0"} COST THRESHOLD</Text>
      <Text>Session cost: <Text bold color="yellow">${currentCost.toFixed(2)}</Text></Text>
      <Text dimColor>This session has exceeded the ${threshold.toFixed(0)} cost threshold.</Text>
      <Box marginTop={1}><Text dimColor>Press Enter or Esc to continue</Text></Box>
    </Box>
  );
}

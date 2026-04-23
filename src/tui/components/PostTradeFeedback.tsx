/**
 * PostTradeFeedback — Inline rating prompt for trade recommendations.
 *
 * Shown after Gordon makes a trade recommendation. Not a full modal —
 * renders as a compact inline form. Keys 1-5 submit a rating,
 * 'S' or Escape skips.
 */

import React from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// Types
// ============================================================================

interface Props {
  /** e.g. "SELL 0.5 BTC @ $68,432" */
  tradeDescription: string;
  onRate: (rating: 1 | 2 | 3 | 4 | 5) => void;
  onSkip: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function PostTradeFeedback({ tradeDescription, onRate, onSkip }: Props) {
  useInput((input, key) => {
    if (key.escape || input === "s" || input === "S") {
      onSkip();
      return;
    }
    if (input === "1") { onRate(1); return; }
    if (input === "2") { onRate(2); return; }
    if (input === "3") { onRate(3); return; }
    if (input === "4") { onRate(4); return; }
    if (input === "5") { onRate(5); return; }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Text dimColor>Was this trade recommendation helpful?</Text>
      <Box paddingLeft={1}>
        <Text bold>{tradeDescription}</Text>
      </Box>
      <Text> </Text>

      {/* Rating row */}
      <Box>
        <Text color="red">{"[1]"}</Text>
        <Text> Poor  </Text>
        <Text color="yellow">{"[2]"}</Text>
        <Text> Fair  </Text>
        <Text color="cyan">{"[3]"}</Text>
        <Text> Good  </Text>
        <Text color="green">{"[4]"}</Text>
        <Text> Great  </Text>
        <Text color="green" bold>{"[5]"}</Text>
        <Text> Excellent  </Text>
        <Text dimColor>{"[S]"}</Text>
        <Text dimColor> Skip</Text>
      </Box>
    </Box>
  );
}

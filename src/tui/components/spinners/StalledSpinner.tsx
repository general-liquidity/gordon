import { Box, Text } from "../../ink-custom";
import { FlashingChar } from "./FlashingChar.js";

// ============================================================================
// StalledSpinner — Specialized spinner shown when the agent is stalled
//
// Color progression:
//   3–5 s  →  yellow
//   > 5 s  →  red
//
// With toolName:  ● Waiting for {toolName}... {N}s
// Without:        ● Slow response · {N}s · retrying...
// ============================================================================

interface Props {
  /** How long the agent has been stalled, in milliseconds */
  stalledForMs: number;
  /** Name of the tool that is taking long (optional) */
  toolName?: string;
  /** Number of retry attempts so far */
  retryCount?: number;
}

export function StalledSpinner({ stalledForMs, toolName, retryCount }: Props) {
  const seconds = Math.floor(stalledForMs / 1000);
  const isRed = stalledForMs >= 5000;
  const indicatorColor = isRed ? "red" : "yellow";
  const dot = "·";

  return (
    <Box paddingLeft={2}>
      {/* Flashing indicator in the appropriate color */}
      <FlashingChar char="●" color={indicatorColor} intervalMs={500} />
      <Text> </Text>

      {toolName ? (
        /* Waiting for a specific tool */
        <>
          <Text color={indicatorColor}>{"Waiting for "}</Text>
          <Text color={indicatorColor} bold>
            {toolName}
          </Text>
          <Text color={indicatorColor}>{"..."}</Text>
          <Text dimColor>{` ${dot} `}</Text>
          <Text dimColor>{`${seconds}s`}</Text>
        </>
      ) : (
        /* Generic stall / retry */
        <>
          <Text color={indicatorColor}>{"Slow response"}</Text>
          <Text dimColor>{` ${dot} `}</Text>
          <Text dimColor>{`${seconds}s`}</Text>
          <Text dimColor>{` ${dot} `}</Text>
          <Text dimColor>
            {retryCount != null && retryCount > 0 ? `retrying (${retryCount})...` : "retrying..."}
          </Text>
        </>
      )}
    </Box>
  );
}

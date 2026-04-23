import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// TeammateSpinnerLine — Single agent task line in the spinner tree
//
// Renders one line of the multi-agent task tree, showing status icon,
// agent name, and contextual info (task label, duration, error state).
//
// running: ├─ ● Scanner  Scanning markets...
// done:    ├─ ✓ Analyst  3.2s
// error:   ├─ ✗ Executor  failed
// pending: ├─ ○ Monitor  waiting
// waiting: ├─ ○ Planner
// ============================================================================

type AgentStatus = "running" | "done" | "error" | "pending" | "waiting";

interface Props {
  agentName: string;
  status: AgentStatus;
  taskLabel?: string;
  /** Duration in milliseconds (shown for done status) */
  duration?: number;
  /** When true, use └─ instead of ├─ */
  isLast?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

export function TeammateSpinnerLine({ agentName, status, taskLabel, duration, isLast = false }: Props) {
  const connector = isLast ? "└─" : "├─";

  const iconChar = status === "running"
    ? "●"
    : status === "done"
      ? "✓"
      : status === "error"
        ? "✗"
        : "○";

  const iconColor = status === "running"
    ? "cyanBright"
    : status === "done"
      ? "green"
      : status === "error"
        ? "red"
        : undefined; // dimColor handled via prop below

  const isDim = status === "pending" || status === "waiting";

  // Determine trailing info text
  let trailingText: string | null = null;
  let trailingDim = false;

  if (status === "running" && taskLabel) {
    trailingText = taskLabel;
    trailingDim = false;
  } else if (status === "done") {
    trailingText = duration != null ? formatDuration(duration) : null;
    trailingDim = true;
  } else if (status === "error") {
    trailingText = "failed";
    trailingDim = false;
  } else if (status === "pending") {
    trailingText = "waiting";
    trailingDim = true;
  }

  return (
    <Box>
      {/* Tree connector */}
      <Text dimColor>{connector} </Text>

      {/* Status icon */}
      {iconColor ? (
        <Text color={iconColor}>{iconChar}</Text>
      ) : (
        <Text dimColor>{iconChar}</Text>
      )}

      {/* Agent name */}
      <Text> </Text>
      {isDim ? (
        <Text dimColor>{agentName}</Text>
      ) : (
        <Text color="white">{agentName}</Text>
      )}

      {/* Trailing info */}
      {trailingText && (
        <>
          <Text dimColor>{"  "}</Text>
          {trailingDim ? (
            <Text dimColor>{trailingText}</Text>
          ) : status === "error" ? (
            <Text color="red">{trailingText}</Text>
          ) : (
            <Text dimColor>{trailingText}</Text>
          )}
        </>
      )}
    </Box>
  );
}

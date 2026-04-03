/**
 * ThinkStep — Agent reasoning display
 *
 * Renders a "THINKING" badge in dimColor with agent reasoning text.
 * Shows between plan generation and plan presentation to give the
 * user visibility into the agent's thought process.
 *
 * Phase 17 of the TUI rebuild.
 */

import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// Types
// ============================================================================

interface Props {
  /** The reasoning text from the agent */
  reasoning: string;
  /** Optional agent name (e.g. "analyst", "risk-manager") */
  agentName?: string;
  /** Whether to show elapsed time */
  elapsedMs?: number;
}

// ============================================================================
// Helpers
// ============================================================================

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Truncate reasoning to a maximum number of lines for display.
 * Long reasoning is collapsed with a trailing "..." indicator.
 */
function truncateReasoning(text: string, maxLines: number = 6): string[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `... (+${lines.length - maxLines} more)`];
}

// ============================================================================
// Component
// ============================================================================

export function ThinkStep({ reasoning, agentName, elapsedMs }: Props) {
  const lines = truncateReasoning(reasoning);

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      {/* Badge line */}
      <Box>
        <Text dimColor bold inverse>{" THINKING "}</Text>
        {agentName && (
          <>
            <Text dimColor> </Text>
            <Text dimColor color="cyan">{agentName}</Text>
          </>
        )}
        {elapsedMs != null && (
          <>
            <Text dimColor> {"\u00b7"} </Text>
            <Text dimColor>{formatElapsed(elapsedMs)}</Text>
          </>
        )}
      </Box>

      {/* Reasoning text */}
      <Box flexDirection="column" paddingLeft={2} marginTop={0}>
        {lines.map((line, i) => (
          <Text key={i} dimColor>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

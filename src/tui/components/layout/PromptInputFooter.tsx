import React from "react";
import { Box, Text } from "../../ink-custom";

// ============================================================================
// PromptInputFooter — Status bar rendered below the prompt input
//
// Left:   token count + session cost  (e.g. "1.2K tok · $0.04")
// Center: active permission mode badge (color-coded)
// Right:  active agent name when streaming (e.g. "● Scanner")
// ============================================================================

interface Props {
  tokenCount: number;
  cost: number;
  permissionMode: string;
  activeAgent?: string;
  isStreaming: boolean;
}

const MODE_COLOR: Record<string, string> = {
  auto: "cyanBright",
  ask: "yellow",
  strict: "red",
  paper: "blue",
  observe: "gray",
  plan: "magenta",
};

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K tok`;
  }
  return `${count} tok`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function PromptInputFooter({
  tokenCount,
  cost,
  permissionMode,
  activeAgent,
  isStreaming,
}: Props) {
  const modeColor = MODE_COLOR[permissionMode] ?? "white";
  const modeLabel = permissionMode.toUpperCase();

  return (
    <Box flexDirection="row" justifyContent="space-between">
      {/* Left: token count + cost */}
      <Box>
        <Text dimColor>
          {formatTokenCount(tokenCount)} {"·"} {formatCost(cost)}
        </Text>
      </Box>

      {/* Center: permission mode badge */}
      <Box>
        <Text color={modeColor} bold>
          {modeLabel}
        </Text>
      </Box>

      {/* Right: active agent (only while streaming) */}
      <Box>
        {isStreaming && activeAgent ? (
          <Text color="cyanBright">
            {"●"} {activeAgent}
          </Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
    </Box>
  );
}

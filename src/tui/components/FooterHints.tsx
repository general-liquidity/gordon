import React from "react";
import { Box, Text, Spacer } from "ink";

// ============================================================================
// FooterHints — Right-aligned hints on the input line
// Replaces StatusLine. Shows: mode · agent count · Ctrl+P · ? help
// ============================================================================

interface Props {
  permissionMode: "auto" | "ask" | "strict";
  activeAgentCount: number;
  isStreaming: boolean;
  activeAgentName: string | null;
  autonomousActive?: boolean;
  autonomousStrategyCount?: number;
}

export function FooterHints({
  permissionMode,
  activeAgentCount,
  isStreaming,
  activeAgentName,
  autonomousActive = false,
  autonomousStrategyCount = 0,
}: Props) {
  const modeColor = permissionMode === "auto" ? "red" : permissionMode === "strict" ? "green" : "cyanBright";

  return (
    <Box>
      <Spacer />
      {/* Mode */}
      <Text color={modeColor}>{permissionMode}</Text>

      {/* Autonomous loop indicator (Phase 6) */}
      {autonomousActive && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text color="magentaBright">
            {"\u25C8"} {autonomousStrategyCount} {autonomousStrategyCount === 1 ? "strategy" : "strategies"}
          </Text>
        </>
      )}

      {/* Active agents */}
      {isStreaming && activeAgentCount > 0 && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          {activeAgentCount === 1 && activeAgentName ? (
            <Text color="cyanBright">{activeAgentName}</Text>
          ) : (
            <Text color="cyanBright">{activeAgentCount} agents</Text>
          )}
        </>
      )}

      {/* Shortcuts */}
      <Text dimColor> {"\u00b7"} Ctrl+P {"\u00b7"} ? help</Text>
    </Box>
  );
}

import React from "react";
import { Box, Text, Spacer } from "../../ink-custom";

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
  /** Vim mode active */
  vimMode?: boolean;
  /** Effort/fast mode level */
  effortLevel?: "low" | "medium" | "high" | "auto";
  /** Token budget remaining (0-1 ratio) */
  tokenBudgetRatio?: number;
}

export function FooterHints({
  permissionMode,
  activeAgentCount,
  isStreaming,
  activeAgentName,
  autonomousActive = false,
  autonomousStrategyCount = 0,
  vimMode = false,
  effortLevel,
  tokenBudgetRatio,
}: Props) {
  const modeColor = permissionMode === "auto" ? "red" : permissionMode === "strict" ? "green" : "cyanBright";

  return (
    <Box>
      <Spacer />
      {/* Mode */}
      <Text color={modeColor}>{permissionMode}</Text>

      {/* Vim mode indicator */}
      {vimMode && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text color="magenta">[VIM]</Text>
        </>
      )}

      {/* Effort/fast mode indicator */}
      {effortLevel && effortLevel !== "auto" && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text color="yellow">{"\u21AF"} {effortLevel}</Text>
        </>
      )}

      {/* Token budget indicator */}
      {tokenBudgetRatio != null && tokenBudgetRatio < 0.3 && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text color={tokenBudgetRatio < 0.1 ? "red" : "yellow"}>
            {"\u2193"} {Math.round(tokenBudgetRatio * 100)}% ctx
          </Text>
        </>
      )}

      {/* Autonomous loop indicator */}
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

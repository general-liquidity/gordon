import React from "react";
import { Box, Text } from "ink";
import type { PermissionMode } from "../state/types.js";

// ============================================================================
// GordonHeader — Codex-style info box
// ============================================================================

interface Props {
  permissionMode: PermissionMode;
  sessionId: string | null;
  threadId: string | null;
  isResumedSession: boolean;
  resumeMessageCount?: number;
  toolCount?: number;
  exchangeStatus?: string;
  pnl?: number;
  positionCount?: number;
  feedCount?: number;
  mcpWarnings?: string[];
}

const MODE_COLOR: Record<PermissionMode, string> = {
  auto:    "red",
  ask:     "rgb(52,238,176)",
  strict:  "green",
  paper:   "yellow",
  observe: "magenta",
  plan:    "blue",
};

export function GordonHeader({
  permissionMode,
  sessionId,
  threadId,
  isResumedSession,
  resumeMessageCount,
  toolCount = 0,
  exchangeStatus,
  mcpWarnings = [],
}: Props) {
  const modeColor = MODE_COLOR[permissionMode] ?? "rgb(52,238,176)";
  const version = process.env.npm_package_version ?? process.env.GORDON_VERSION ?? "0.9";
  const isPaper = permissionMode === "paper";

  // Show the thread ID (meaningful) or fall back to session/resource ID
  const sessionDisplay = threadId
    ? threadId.slice(0, 32)
    : sessionId
    ? sessionId.slice(0, 32)
    : "initializing...";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor={isPaper ? "yellow" : "gray"}
        paddingX={2}
        paddingY={0}
        flexDirection="column"
        width={56}
      >
        <Box>
          <Text color="rgb(52,238,176)" bold>{"≫"}  Gordon CLI</Text>
          <Text dimColor> (v{version})</Text>
          {isPaper && <Text color="yellow" bold>  [PAPER]</Text>}
        </Box>
        <Text>   The Frontier Trading Agent</Text>
        <Text dimColor>   General Liquidity, Inc.</Text>
        <Text> </Text>
        <Box>
          <Text dimColor>   model:     </Text>
          <Text>{process.env.GORDON_MODEL ?? "auto"}</Text>
          {process.env.GORDON_EFFORT && <Text dimColor> {process.env.GORDON_EFFORT}</Text>}
          <Text dimColor>   /model to change</Text>
        </Box>
        <Box>
          <Text dimColor>   mode:      </Text>
          <Text color={modeColor}>{permissionMode}</Text>
          <Text dimColor>      {isPaper ? "/live to exit" : "/auto to change"}</Text>
        </Box>
        <Box>
          <Text dimColor>   session:   </Text>
          <Text>{sessionDisplay}</Text>
        </Box>
        {exchangeStatus && (
          <Box>
            <Text dimColor>   exchange:  </Text>
            <Text>{isPaper ? `${exchangeStatus} (sandbox)` : exchangeStatus}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>   tools:     </Text>
          <Text>{toolCount} loaded</Text>
        </Box>
      </Box>

      {/* MCP connection warnings (Codex pattern: visible, not swallowed) */}
      {mcpWarnings && mcpWarnings.length > 0 && mcpWarnings.map((w, i) => (
        <Box key={i} paddingX={1}>
          <Text color="yellow">{"⚠"} {w}</Text>
        </Box>
      ))}

      <Box marginTop={1} paddingX={1}>
        <Text dimColor>Tip: Type /scan to discover opportunities, or describe what you want to trade.</Text>
      </Box>

      {isResumedSession && resumeMessageCount != null && (
        <Box paddingX={1}>
          <Text dimColor>{"↻"} Resumed {"·"} {resumeMessageCount} messages restored</Text>
        </Box>
      )}
    </Box>
  );
}

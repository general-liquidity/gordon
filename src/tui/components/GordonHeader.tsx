import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// GordonHeader — Codex-style info box
// ============================================================================

interface Props {
  permissionMode: "auto" | "ask" | "strict";
  sessionId: string | null;
  threadId: string | null;
  isResumedSession: boolean;
  resumeMessageCount?: number;
  toolCount?: number;
  exchangeStatus?: string;
  pnl?: number;
  positionCount?: number;
  feedCount?: number;
}

export function GordonHeader({
  permissionMode,
  sessionId,
  threadId,
  isResumedSession,
  resumeMessageCount,
  toolCount = 0,
  exchangeStatus,
}: Props) {
  const modeColor = permissionMode === "auto" ? "red" : permissionMode === "strict" ? "green" : "rgb(52,238,176)";
  const version = process.env.npm_package_version ?? process.env.GORDON_VERSION ?? "0.9";

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
        borderColor="gray"
        paddingX={2}
        paddingY={0}
        flexDirection="column"
        width={56}
      >
        <Box>
          <Text color="rgb(52,238,176)" bold>{"\u226B"}  Gordon CLI</Text>
          <Text dimColor> (v{version})</Text>
        </Box>
        <Text>   The Frontier Trading Agent</Text>
        <Text dimColor>   General Liquidity, Inc.</Text>
        <Text> </Text>
        <Box>
          <Text dimColor>   mode:      </Text>
          <Text color={modeColor}>{permissionMode}</Text>
          <Text dimColor>      /auto to change</Text>
        </Box>
        <Box>
          <Text dimColor>   session:   </Text>
          <Text>{sessionDisplay}</Text>
        </Box>
        {exchangeStatus && (
          <Box>
            <Text dimColor>   exchange:  </Text>
            <Text>{exchangeStatus}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>   tools:     </Text>
          <Text>{toolCount} loaded</Text>
        </Box>
      </Box>

      <Box marginTop={1} paddingX={1}>
        <Text dimColor>Tip: Type /scan to discover opportunities, or describe what you want to trade.</Text>
      </Box>

      {isResumedSession && resumeMessageCount != null && (
        <Box paddingX={1}>
          <Text dimColor>{"\u21BB"} Resumed {"\u00b7"} {resumeMessageCount} messages restored</Text>
        </Box>
      )}
    </Box>
  );
}

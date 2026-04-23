import React from "react";
import { Box, Text, useInput } from "ink";
import { useAnimationClock } from "../../hooks/useAnimationClock.js";
import { Divider } from "../Divider.js";

// ============================================================================
// MCPReconnect — Animated reconnection status for a failing MCP server
//
// ↻ Reconnecting: Binance Adapter
// Attempt 2 of 5 · Next retry in 3s
// ────────●────────────────────────
// [C] Cancel
// ============================================================================

interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  status: "connected" | "disconnected" | "error" | "reconnecting";
  toolCount: number;
  resourceCount?: number;
  latencyMs?: number;
  endpoint?: string;
  description?: string;
}

interface Props {
  server: MCPServer;
  attempt: number;
  maxAttempts: number;
  nextRetryMs?: number;
  onCancel: () => void;
}

const SPINNER_FRAMES = ["↻", "↺", "↻", "↺"];
const BAR_WIDTH = 36;

function buildProgressBar(attempt: number, maxAttempts: number, frame: number): string {
  const filled = Math.round((attempt / maxAttempts) * (BAR_WIDTH - 2));
  const empty = BAR_WIDTH - 2 - filled;

  // Pulse the marker position slightly using the animation frame
  const markerOffset = Math.floor(filled + (frame % 4) * 0.5) % (BAR_WIDTH - 1);
  const left = "─".repeat(markerOffset);
  const right = "─".repeat(Math.max(0, BAR_WIDTH - 2 - markerOffset));
  return left + "●" + right;
}

export function MCPReconnect({ server, attempt, maxAttempts, nextRetryMs, onCancel }: Props) {
  const frame = useAnimationClock(200);

  useInput((input, key) => {
    if (key.escape || input === "c" || input === "C") {
      onCancel();
    }
  });

  const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "↻";
  const progressBar = buildProgressBar(attempt, maxAttempts, frame);
  const nextRetrySec =
    nextRetryMs !== undefined ? Math.ceil(nextRetryMs / 1000) : null;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>{spinnerChar} Reconnecting: </Text>
        <Text bold color="cyanBright">{server.name}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          Attempt{" "}
          <Text color="yellow">{attempt}</Text>
          {" of "}
          <Text color="yellow">{maxAttempts}</Text>
          {nextRetrySec !== null && (
            <>
              {" · Next retry in "}
              <Text color="cyanBright">{nextRetrySec}s</Text>
            </>
          )}
        </Text>
      </Box>

      <Divider />

      <Box marginTop={1} marginBottom={1}>
        <Text color="yellow">{progressBar}</Text>
      </Box>

      <Divider />

      <Box marginTop={1}>
        <Text dimColor>[C] Cancel</Text>
      </Box>
    </Box>
  );
}

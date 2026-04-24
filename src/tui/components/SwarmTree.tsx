import React from "react";
import { Box, Text } from "../ink-custom";
import { WorkerBadge } from "./WorkerBadge.js";

// ============================================================================
// SwarmTree — Coordinator → workers visualization
// Shows all active agents in a flat tree when multiple run in parallel.
//
// GORDON · Coordinator
//   ├─ Scanner         ● scanning 50 symbols
//   ├─ Analyst (BTC)   ✓ done (3.2s)
//   ├─ Analyst (ETH)   ● indicators...
//   ├─ Analyst (SOL)   ○ queued
//   └─ Planner         ○ waiting for analysis
// ============================================================================

export interface SwarmAgent {
  id: string;
  name: string;
  symbol?: string;
  status: "running" | "done" | "error" | "queued";
  detail?: string;
  duration?: number;
}

interface Props {
  agents: SwarmAgent[];
}

const STATUS_ICON: Record<string, string> = {
  running: "\u25CF",  // ●
  done: "\u2713",     // ✓
  error: "\u2717",    // ✗
  queued: "\u25CB",   // ○
};

const STATUS_COLOR: Record<string, string> = {
  running: "cyanBright",
  done: "green",
  error: "red",
  queued: "gray",
};

export function SwarmTree({ agents }: Props) {
  if (agents.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text bold color="cyanBright">GORDON</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text color="cyanBright">Coordinator</Text>
      </Box>
      {agents.map((agent, i) => {
        const isLast = i === agents.length - 1;
        const connector = isLast ? "\u2514\u2500" : "\u251C\u2500";
        const icon = STATUS_ICON[agent.status] ?? "\u25CB";
        const iconColor = STATUS_COLOR[agent.status] ?? "gray";
        const label = agent.symbol ? `${agent.name} (${agent.symbol})` : agent.name;
        const durationStr = agent.duration ? ` (${formatMs(agent.duration)})` : "";

        return (
          <Box key={agent.id}>
            <Text dimColor>  {connector} </Text>
            <WorkerBadge agent={agent.name} showBullet={false} />
            {agent.symbol && <Text dimColor> ({agent.symbol})</Text>}
            <Text>  </Text>
            <Text color={iconColor}>{icon}</Text>
            <Text> </Text>
            <Text dimColor={agent.status === "queued"}>
              {agent.detail ?? agent.status}{durationStr}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

import React from "react";
import { Text } from "ink";

// ============================================================================
// WorkerBadge — Colored bullet + agent name
// ● Scanner  ● Analyst  ● Planner  ● Executor
// ============================================================================

const WORKER_COLORS: Record<string, string> = {
  Gordon: "cyanBright",
  Scanner: "cyan",
  Analyst: "blueBright",
  Planner: "cyanBright",
  Executor: "greenBright",
  Monitor: "gray",
  Teacher: "cyan",
  Backtester: "yellow",
  Critic: "redBright",
  Auditor: "gray",
  Coordinator: "cyanBright",
};

interface Props {
  agent: string;
  showBullet?: boolean;
}

export function WorkerBadge({ agent, showBullet = true }: Props) {
  const color = WORKER_COLORS[agent] ?? "cyanBright";
  return (
    <Text color={color} bold>
      {showBullet ? "\u25CF " : ""}{agent}
    </Text>
  );
}

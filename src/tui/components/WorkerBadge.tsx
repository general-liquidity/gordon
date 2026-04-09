import React from "react";
import { Text } from "ink";

// ============================================================================
// WorkerBadge — Colored bullet + agent name
// ● Scanner  ● Analyst  ● Planner  ● Executor
// ============================================================================

const WORKER_COLORS: Record<string, string> = {
  Gordon: "rgb(52,238,176)",
  Scanner: "cyan",
  Analyst: "blueBright",
  Planner: "rgb(52,238,176)",
  Executor: "greenBright",
  Monitor: "gray",
  Teacher: "cyan",
  Backtester: "yellow",
  Critic: "redBright",
  Auditor: "gray",
  Coordinator: "rgb(52,238,176)",
};

interface Props {
  agent: string;
  showBullet?: boolean;
}

export function WorkerBadge({ agent, showBullet = true }: Props) {
  const color = WORKER_COLORS[agent] ?? "rgb(52,238,176)";
  return (
    <Text color={color} bold>
      {showBullet ? "\u25CF " : ""}{agent}
    </Text>
  );
}

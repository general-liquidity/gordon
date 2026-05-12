import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// CoordinatorAgentStatus — Live panel showing background agent workers
//
// Each worker: role badge + task + elapsed time + token count + status icon
// Enter to view, x to dismiss. Auto-evicts completed after 30s.
// ============================================================================

export type WorkerStatus = "pending" | "running" | "completed" | "failed" | "dismissed";

export interface WorkerTask {
  id: string;
  role: string;
  task: string;
  status: WorkerStatus;
  startedAt: number;
  completedAt?: number;
  tokenCount: number;
  cost: number;
  result?: string;
}

interface Props {
  workers: WorkerTask[];
  onView?: (id: string) => void;
  onDismiss?: (id: string) => void;
}

const STATUS_ICONS: Record<WorkerStatus, string> = {
  pending: "\u25CB",
  running: "\u25CF",
  completed: "\u2713",
  failed: "\u2717",
  dismissed: "\u2014",
};

const STATUS_COLORS: Record<WorkerStatus, string> = {
  pending: "gray",
  running: "cyan",
  completed: "green",
  failed: "red",
  dismissed: "gray",
};

const ROLE_COLORS: Record<string, string> = {
  Scanner: "cyan",
  Analyst: "blue",
  Planner: "magenta",
  Executor: "yellow",
  Monitor: "green",
  Backtester: "magentaBright",
  Critic: "red",
  Auditor: "gray",
};

function elapsed(startedAt: number, completedAt?: number): string {
  const ms = (completedAt ?? Date.now()) - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function CoordinatorAgentStatus({ workers, onView, onDismiss }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, setTick] = useState(0);

  // Auto-refresh elapsed times
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const visible = workers.filter((w) => w.status !== "dismissed");
  if (visible.length === 0) return null;

  useInput((input, key) => {
    if (key.upArrow) setSelectedIndex((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelectedIndex((p) => Math.min(visible.length - 1, p + 1));
    else if (key.return && visible[selectedIndex]) onView?.(visible[selectedIndex]!.id);
    else if (input === "x" && visible[selectedIndex]) onDismiss?.(visible[selectedIndex]!.id);
  });

  return (
    <Box flexDirection="column">
      <Text dimColor bold>AGENTS</Text>
      {visible.map((worker, i) => (
        <Box key={worker.id}>
          <Text color={i === selectedIndex ? "cyanBright" : undefined}>
            {i === selectedIndex ? "\u25B8 " : "  "}
          </Text>
          <Text color={STATUS_COLORS[worker.status]}>{STATUS_ICONS[worker.status]} </Text>
          <Text color={ROLE_COLORS[worker.role] ?? "white"} bold>
            {worker.role.padEnd(10)}
          </Text>
          <Text>{worker.task.slice(0, 30).padEnd(31)}</Text>
          <Text dimColor>{elapsed(worker.startedAt, worker.completedAt).padStart(8)}</Text>
          {worker.tokenCount > 0 ? (
            <Text dimColor> {"\u00B7"} {(worker.tokenCount / 1000).toFixed(1)}k tok</Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

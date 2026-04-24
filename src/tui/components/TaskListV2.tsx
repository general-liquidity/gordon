import React from "react";
import { Box, Text } from "../ink-custom";
import { type BackgroundTaskData } from "./BackgroundTask.js";

// ============================================================================
// TaskListV2 — Compact embeddable task list (no keyboard handling)
//
//   ● Monitoring BTC/USDT          running · 2h 14m   [monitor]
//   ✓ Full market scan             completed           [scan]
//   ⏸ Autonomous BTC strategy      paused · 45m 12s   [autonomous]
// ============================================================================

interface Props {
  tasks: BackgroundTaskData[];
  maxVisible?: number;          // default 5
  filter?: "all" | "running" | "completed";
  onSelect?: (task: BackgroundTaskData) => void;
}

const STATUS_ICONS: Record<BackgroundTaskData["status"], string> = {
  running: "●",
  paused: "⏸",
  completed: "✓",
  failed: "✗",
  scheduled: "⏰",
};

const STATUS_COLORS: Record<BackgroundTaskData["status"], string> = {
  running: "cyanBright",
  paused: "yellow",
  completed: "green",
  failed: "red",
  scheduled: "gray",
};

const TYPE_LABELS: Record<BackgroundTaskData["type"], string> = {
  monitoring: "monitor",
  scan: "scan",
  autonomous: "autonomous",
  backtest: "backtest",
  scheduled: "scheduled",
};

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function TaskListV2({
  tasks,
  maxVisible = 5,
  filter = "all",
  onSelect,
}: Props) {
  const filtered = tasks.filter((t) => {
    if (filter === "running") return t.status === "running";
    if (filter === "completed") return t.status === "completed";
    return true;
  });

  const visible = filtered.slice(0, maxVisible);
  const hiddenCount = filtered.length - visible.length;

  if (visible.length === 0) {
    return (
      <Box paddingLeft={1}>
        <Text dimColor>No {filter === "all" ? "" : filter + " "}tasks.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visible.map((task) => {
        const icon = STATUS_ICONS[task.status];
        const color = STATUS_COLORS[task.status];
        const typeLabel = TYPE_LABELS[task.type];

        const elapsed =
          task.startedAt &&
          (task.status === "running" || task.status === "paused")
            ? formatElapsed(task.startedAt)
            : null;

        return (
          <Box
            key={task.id}
            flexDirection="row"
            gap={1}
          >
            <Text color={color}>{icon}</Text>
            <Text bold>{task.label.slice(0, 32).padEnd(33)}</Text>
            <Text color={color}>{task.status}</Text>
            {elapsed && (
              <>
                <Text dimColor>{"·"}</Text>
                <Text dimColor>{elapsed}</Text>
              </>
            )}
            <Text dimColor>[{typeLabel}]</Text>
          </Box>
        );
      })}
      {hiddenCount > 0 && (
        <Box paddingLeft={1}>
          <Text dimColor>...and {hiddenCount} more task{hiddenCount !== 1 ? "s" : ""}</Text>
        </Box>
      )}
    </Box>
  );
}

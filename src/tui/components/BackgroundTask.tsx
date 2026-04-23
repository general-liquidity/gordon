import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// BackgroundTask — Individual background task card
//
// Shows status, label, elapsed time, and action hints:
//
//   ● Monitoring BTC/USDT  running · 2h 14m
//     Next alert: price > $70,000
//     [P] Pause  [S] Stop
// ============================================================================

export interface BackgroundTaskData {
  id: string;
  label: string;
  type: "monitoring" | "scan" | "autonomous" | "backtest" | "scheduled";
  status: "running" | "paused" | "completed" | "failed" | "scheduled";
  startedAt?: number;     // unix ms
  nextRunAt?: number;     // for scheduled tasks
  progress?: number;      // 0-100
  result?: string;        // brief result summary
  errorMessage?: string;
}

interface Props {
  task: BackgroundTaskData;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

const STATUS_ICONS: Record<BackgroundTaskData["status"], string> = {
  running: "●",    // ●
  paused: "⏸",     // ⏸
  completed: "✓",  // ✓
  failed: "✗",     // ✗
  scheduled: "⏰",  // ⏰
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

function formatNextRun(nextRunAt: number): string {
  const diff = nextRunAt - Date.now();
  if (diff <= 0) return "now";
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `in ${minutes}m ${seconds}s`;
  return `in ${seconds}s`;
}

export function BackgroundTask({ task, onPause, onResume, onStop }: Props) {
  const icon = STATUS_ICONS[task.status];
  const color = STATUS_COLORS[task.status];
  const typeLabel = TYPE_LABELS[task.type];

  const elapsed =
    task.startedAt && (task.status === "running" || task.status === "paused")
      ? formatElapsed(task.startedAt)
      : null;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {/* First line: icon + label + status summary */}
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold>{task.label}</Text>
        <Text dimColor>  </Text>
        <Text color={color}>{task.status}</Text>
        {elapsed && (
          <>
            <Text dimColor> {"·"} </Text>
            <Text dimColor>{elapsed}</Text>
          </>
        )}
        <Text dimColor>  [{typeLabel}]</Text>
      </Box>

      {/* Progress bar if applicable */}
      {task.progress != null && task.status === "running" && (
        <Box paddingLeft={2}>
          <Text dimColor>{"["}</Text>
          <Text color="cyanBright">{"█".repeat(Math.floor(task.progress / 5))}</Text>
          <Text dimColor>{"░".repeat(20 - Math.floor(task.progress / 5))}</Text>
          <Text dimColor>{"]"}</Text>
          <Text dimColor> {task.progress}%</Text>
        </Box>
      )}

      {/* Next run time for scheduled tasks */}
      {task.nextRunAt && task.status === "scheduled" && (
        <Box paddingLeft={2}>
          <Text dimColor>Next run: {formatNextRun(task.nextRunAt)}</Text>
        </Box>
      )}

      {/* Result for completed tasks */}
      {task.result && task.status === "completed" && (
        <Box paddingLeft={2}>
          <Text color="green">{task.result}</Text>
        </Box>
      )}

      {/* Error message for failed tasks */}
      {task.errorMessage && task.status === "failed" && (
        <Box paddingLeft={2}>
          <Text color="red">{task.errorMessage}</Text>
        </Box>
      )}

      {/* Action hints */}
      {(task.status === "running" || task.status === "paused") && (
        <Box paddingLeft={2} gap={2}>
          {task.status === "running" && onPause && (
            <Text dimColor>[P] Pause</Text>
          )}
          {task.status === "paused" && onResume && (
            <Text dimColor>[R] Resume</Text>
          )}
          {onStop && (
            <Text dimColor>[S] Stop</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

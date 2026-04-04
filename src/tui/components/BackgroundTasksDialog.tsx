import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// BackgroundTasksDialog — List all background tasks with status and controls
//
// Tabs: All / Running / Completed. Enter to foreground, x to kill, Esc close.
// ============================================================================

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "killed";
export type TaskType = "analysis" | "backtest" | "strategy" | "dream" | "shell";

export interface ManagedTask {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  startedAt: number;
  completedAt?: number;
  isBackgrounded: boolean;
}

interface Props {
  tasks: ManagedTask[];
  onClose: () => void;
  onForeground?: (taskId: string) => void;
  onKill?: (taskId: string) => void;
}

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "\u25CB", running: "\u25CF", completed: "\u2713", failed: "\u2717", killed: "\u2014",
};
const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "gray", running: "cyan", completed: "green", failed: "red", killed: "gray",
};
const TYPE_COLORS: Record<TaskType, string> = {
  analysis: "blue", backtest: "magenta", strategy: "cyan", dream: "yellow", shell: "gray",
};

const TABS = ["All", "Running", "Completed"] as const;

function elapsed(startedAt: number, completedAt?: number): string {
  const ms = (completedAt ?? Date.now()) - startedAt;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${Math.floor(ms / 60000)}m`;
}

export function BackgroundTasksDialog({ tasks, onClose, onForeground, onKill }: Props) {
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(0);

  const filtered = tasks.filter((t) => {
    if (tab === 1) return t.status === "running" || t.status === "pending";
    if (tab === 2) return t.status === "completed" || t.status === "failed" || t.status === "killed";
    return true;
  });

  useInput((input, key) => {
    if (key.escape) onClose();
    else if (key.tab) { setTab((p) => (p + 1) % TABS.length); setSelected(0); }
    else if (key.upArrow) setSelected((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelected((p) => Math.min(filtered.length - 1, p + 1));
    else if (key.return && filtered[selected]) onForeground?.(filtered[selected]!.id);
    else if (input === "x" && filtered[selected]) onKill?.(filtered[selected]!.id);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1}>
      <Box>
        {TABS.map((t, i) => (
          <Text key={t} bold={i === tab} color={i === tab ? "cyanBright" : undefined} dimColor={i !== tab}>
            {i > 0 ? " | " : ""}{t}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {filtered.length === 0 ? (
          <Text dimColor>No tasks</Text>
        ) : (
          filtered.map((task, i) => (
            <Box key={task.id}>
              <Text color={i === selected ? "cyanBright" : undefined}>
                {i === selected ? "\u25B8 " : "  "}
              </Text>
              <Text color={STATUS_COLORS[task.status]}>{STATUS_ICONS[task.status]} </Text>
              <Text color={TYPE_COLORS[task.type]} bold>{task.type.padEnd(9)}</Text>
              <Text bold={i === selected}>{task.title.slice(0, 35).padEnd(36)}</Text>
              <Text dimColor>{elapsed(task.startedAt, task.completedAt)}</Text>
            </Box>
          ))
        )}
      </Box>
      <Text dimColor>Tab to switch {"\u00B7"} Enter to foreground {"\u00B7"} x to kill {"\u00B7"} Esc to close</Text>
    </Box>
  );
}

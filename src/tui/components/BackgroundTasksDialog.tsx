import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { BackgroundTask, type BackgroundTaskData } from "./BackgroundTask.js";

// ============================================================================
// BackgroundTasksDialog — Full dialog for managing all background tasks
//
// Header: BACKGROUND TASKS  (N running · M scheduled)
// Body:   Scrollable task list; selected task highlighted with single border
// Footer: [P] Pause  [R] Resume  [S] Stop  [Esc] Close
//
// Arrow keys navigate, keys apply to selected task.
// ============================================================================

interface Props {
  tasks: BackgroundTaskData[];
  onPauseTask: (id: string) => void;
  onResumeTask: (id: string) => void;
  onStopTask: (id: string) => void;
  onClose: () => void;
}

export function BackgroundTasksDialog({
  tasks,
  onPauseTask,
  onResumeTask,
  onStopTask,
  onClose,
}: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const runningCount = tasks.filter((t) => t.status === "running").length;
  const scheduledCount = tasks.filter((t) => t.status === "scheduled").length;

  const selected = tasks[selectedIdx];

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIdx((i) => (i > 0 ? i - 1 : Math.max(0, tasks.length - 1)));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx((i) => (i < tasks.length - 1 ? i + 1 : 0));
      return;
    }
    if (!selected) return;
    if (input === "p" || input === "P") {
      if (selected.status === "running") onPauseTask(selected.id);
    }
    if (input === "r" || input === "R") {
      if (selected.status === "paused") onResumeTask(selected.id);
    }
    if (input === "s" || input === "S") {
      if (selected.status === "running" || selected.status === "paused") {
        onStopTask(selected.id);
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyanBright"
      paddingX={1}
      paddingY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyanBright">BACKGROUND TASKS</Text>
        <Text dimColor>
          {"  "}({runningCount} running {"·"} {scheduledCount} scheduled)
        </Text>
      </Box>

      {/* Task list */}
      {tasks.length === 0 ? (
        <Box paddingLeft={1} paddingY={1}>
          <Text dimColor>
            No background tasks. Try /scan or /autonomous to start one.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          {tasks.map((task, i) => {
            const isSelected = i === selectedIdx;
            return (
              <Box
                key={task.id}
                flexDirection="column"
                borderStyle={isSelected ? "single" : undefined}
                borderColor={isSelected ? "cyanBright" : undefined}
                paddingX={isSelected ? 1 : 0}
              >
                <BackgroundTask
                  task={task}
                  onPause={
                    task.status === "running"
                      ? () => onPauseTask(task.id)
                      : undefined
                  }
                  onResume={
                    task.status === "paused"
                      ? () => onResumeTask(task.id)
                      : undefined
                  }
                  onStop={
                    task.status === "running" || task.status === "paused"
                      ? () => onStopTask(task.id)
                      : undefined
                  }
                />
              </Box>
            );
          })}
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1} gap={2}>
        <Text dimColor>[{"↑↓"}] Navigate</Text>
        <Text dimColor>[P] Pause</Text>
        <Text dimColor>[R] Resume</Text>
        <Text dimColor>[S] Stop</Text>
        <Text dimColor>[Esc] Close</Text>
      </Box>
    </Box>
  );
}

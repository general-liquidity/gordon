/**
 * TaskDependencyView — TUI component for visualizing the task dependency graph
 *
 * Renders tasks as a pipeline list with status icons, dependency annotations,
 * and keyboard navigation. Arrow keys navigate, Enter starts pending tasks,
 * Escape closes.
 *
 * Pattern: Claude Code task/plugin browser (navigable list with actions).
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { Pane } from "../design-system/Pane.js";
import type { TaskNode } from "../services/taskDependencyGraph.js";

// ============================================================================
// Types
// ============================================================================

interface Props {
  tasks: TaskNode[];
  onStart?: (id: string) => void;
  onCancel?: (id: string) => void;
  onClose?: () => void;
}

// ============================================================================
// Status icons and colors
// ============================================================================

const STATUS_ICON: Record<TaskNode["status"], string> = {
  completed: "\u2713",   // checkmark
  in_progress: "\u25CF", // filled circle
  pending: "\u25CB",     // empty circle
  failed: "\u2717",      // cross
  blocked: "\u2298",     // circled division
};

const STATUS_COLOR: Record<TaskNode["status"], string> = {
  completed: "green",
  in_progress: "cyan",
  pending: "white",
  failed: "red",
  blocked: "gray",
};

// ============================================================================
// Helpers
// ============================================================================

function buildBlockedByLabel(task: TaskNode, allTasks: TaskNode[]): string {
  if (task.status !== "blocked" || task.dependencies.length === 0) return "";

  const pendingDeps = task.dependencies.filter((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    return dep && dep.status !== "completed";
  });

  if (pendingDeps.length === 0) return "";

  const labels = pendingDeps.map((depId) => {
    const idx = allTasks.findIndex((t) => t.id === depId);
    return `#${idx + 1}`;
  });

  return `blocked by: ${labels.join(", ")}`;
}

function taskIndex(id: string, allTasks: TaskNode[]): number {
  return allTasks.findIndex((t) => t.id === id) + 1;
}

// ============================================================================
// Component
// ============================================================================

export function TaskDependencyView({ tasks, onStart, onCancel, onClose }: Props) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape && onClose) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(tasks.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const task = tasks[cursor];
      if (!task) return;
      if (task.status === "pending" && onStart) {
        onStart(task.id);
      }
      return;
    }
    if (input === "x" || input === "X") {
      const task = tasks[cursor];
      if (!task) return;
      if (
        (task.status === "pending" || task.status === "in_progress" || task.status === "blocked") &&
        onCancel
      ) {
        onCancel(task.id);
      }
    }
  });

  if (tasks.length === 0) {
    return (
      <Pane title="TASK PIPELINE" color="cyan">
        <Text dimColor>No tasks in pipeline.</Text>
        {onClose && (
          <Text dimColor>Esc close</Text>
        )}
      </Pane>
    );
  }

  // Summary counts
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;

  return (
    <Pane title="TASK PIPELINE" color="cyan">
      <Box>
        <Text dimColor>
          {tasks.length} tasks {"\u00b7"} {completed} done
          {inProgress > 0 ? ` \u00b7 ${inProgress} running` : ""}
          {failed > 0 ? ` \u00b7 ${failed} failed` : ""}
        </Text>
      </Box>
      <Text> </Text>

      {/* Task list */}
      <Box flexDirection="column">
        {tasks.map((task, i) => {
          const isFocused = i === cursor;
          const icon = STATUS_ICON[task.status];
          const color = STATUS_COLOR[task.status];
          const blockedLabel = buildBlockedByLabel(task, tasks);
          const pointer = isFocused ? "\u25B8 " : "  ";
          const idx = `${i + 1}.`;

          return (
            <Box key={task.id} paddingLeft={1}>
              <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
              <Box width={4}>
                <Text dimColor>{idx}</Text>
              </Box>
              <Text color={color}>{icon} </Text>
              <Text bold={isFocused} color={isFocused ? color : undefined}>
                {task.title}
              </Text>
              {blockedLabel && (
                <Text dimColor> ({blockedLabel})</Text>
              )}
              {task.error && (
                <Text color="red"> [{task.error}]</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Focused task details */}
      {tasks[cursor] && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"\u2500".repeat(40)}</Text>
          <Box>
            <Text bold color={STATUS_COLOR[tasks[cursor].status]}>
              {tasks[cursor].title}
            </Text>
            <Text dimColor> {"\u00b7"} </Text>
            <Text>{tasks[cursor].status}</Text>
          </Box>
          {tasks[cursor].dependencies.length > 0 && (
            <Box>
              <Text dimColor>Depends on: </Text>
              <Text>
                {tasks[cursor].dependencies
                  .map((depId) => {
                    const dep = tasks.find((t) => t.id === depId);
                    return dep
                      ? `#${taskIndex(depId, tasks)} ${dep.title}`
                      : depId;
                  })
                  .join(", ")}
              </Text>
            </Box>
          )}
          {tasks[cursor].dependents.length > 0 && (
            <Box>
              <Text dimColor>Blocks: </Text>
              <Text>
                {tasks[cursor].dependents
                  .map((depId) => {
                    const dep = tasks.find((t) => t.id === depId);
                    return dep
                      ? `#${taskIndex(depId, tasks)} ${dep.title}`
                      : depId;
                  })
                  .join(", ")}
              </Text>
            </Box>
          )}
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Enter start {"\u00b7"} x cancel {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}

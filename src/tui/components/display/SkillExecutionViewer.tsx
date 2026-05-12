import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";
import { ProgressBar } from "../../design-system/ProgressBar.js";

// ============================================================================
// SkillExecutionViewer — Track /loop and /batch skill execution
//
// Shows active skill runs, progress, results, and errors.
// Supports multiple concurrent skill executions.
// ============================================================================

export type SkillRunStatus = "running" | "completed" | "failed" | "paused";

export interface SkillRun {
  id: string;
  skillName: string;
  status: SkillRunStatus;
  startedAt: number;
  completedAt?: number;
  progress?: number; // 0-1
  currentStep?: string;
  result?: string;
  error?: string;
  iterations?: number;
  maxIterations?: number;
}

interface Props {
  runs: SkillRun[];
  onCancel?: (id: string) => void;
  onClose: () => void;
}

const STATUS_CONFIG: Record<SkillRunStatus, { icon: string; color: string }> = {
  running:   { icon: "\u25CF", color: "cyanBright" },
  completed: { icon: "\u2713", color: "green" },
  failed:    { icon: "\u2717", color: "red" },
  paused:    { icon: "\u25C8", color: "yellow" },
};

function elapsed(startedAt: number, completedAt?: number): string {
  const ms = (completedAt ?? Date.now()) - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

export function SkillExecutionViewer({ runs, onCancel, onClose }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [, setTick] = useState(0);

  // Refresh elapsed times
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [runs]);

  useInput((input, key) => {
    if (key.escape) onClose();
    if (key.upArrow) setSelectedIdx((p) => Math.max(0, p - 1));
    if (key.downArrow) setSelectedIdx((p) => Math.min(runs.length - 1, p + 1));
    if (input === "c" && runs[selectedIdx]?.status === "running") {
      onCancel?.(runs[selectedIdx]!.id);
    }
  });

  if (runs.length === 0) {
    return (
      <Pane title="SKILL EXECUTION" color="cyan">
        <Text dimColor>No active skill runs. Use /loop or /batch to start.</Text>
        <Text> </Text>
        <Text dimColor>Esc close</Text>
      </Pane>
    );
  }

  return (
    <Pane title="SKILL EXECUTION" color="cyan">
      {runs.map((run, i) => {
        const cfg = STATUS_CONFIG[run.status];
        const isSelected = i === selectedIdx;
        return (
          <Box key={run.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={isSelected ? "cyanBright" : undefined}>
                {isSelected ? "\u25B8 " : "  "}
              </Text>
              <Text color={cfg.color}>{cfg.icon} </Text>
              <Text bold>{run.skillName}</Text>
              <Text dimColor> {"\u00b7"} {elapsed(run.startedAt, run.completedAt)}</Text>
              {run.iterations != null && run.maxIterations != null && (
                <Text dimColor> {"\u00b7"} cycle {run.iterations}/{run.maxIterations}</Text>
              )}
            </Box>

            {/* Progress bar */}
            {run.progress != null && run.status === "running" && (
              <Box paddingLeft={4}>
                <ProgressBar value={run.progress} width={20} fillColor="cyanBright" />
                <Text dimColor> {(run.progress * 100).toFixed(0)}%</Text>
              </Box>
            )}

            {/* Current step */}
            {run.currentStep && run.status === "running" && (
              <Box paddingLeft={4}>
                <Text dimColor>{run.currentStep}</Text>
              </Box>
            )}

            {/* Result / Error */}
            {run.result && (
              <Box paddingLeft={4}>
                <Text color="green">{run.result.slice(0, 100)}</Text>
              </Box>
            )}
            {run.error && (
              <Box paddingLeft={4}>
                <Text color="red">{run.error.slice(0, 100)}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>c cancel selected {"\u00b7"} Esc close</Text>
    </Pane>
  );
}

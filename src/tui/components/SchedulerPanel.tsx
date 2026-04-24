/**
 * SchedulerPanel — List of scheduled scans/jobs with actions
 *
 * Pattern: Claude Code BackgroundTasksDialog — compact rows with status
 * indicators and inline actions (pause/resume/delete).
 * Triggered via /scheduler command.
 *
 * SCHEDULED JOBS (3)
 *
 *   NAME              SCHEDULE       LAST RUN     NEXT RUN     STATUS
 *   BTC 4h scan       0 * /4 * * *   2m ago       1h 58m       ✓ active
 *   Portfolio rebal    0 0 * * *      18h ago      5h 42m       ✓ active
 *   Funding arb        0 * /8 * * *   6h ago       1h 12m       ○ paused
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// Types
// ============================================================================

export type JobStatus = "active" | "paused";

export interface ScheduledJob {
  id: string;
  name: string;
  schedule: string;
  lastRun?: string;
  nextRun?: string;
  status: JobStatus;
}

interface Props {
  jobs: ScheduledJob[];
  onPause?: (jobId: string) => void;
  onResume?: (jobId: string) => void;
  onDelete?: (jobId: string) => void;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function timeAgo(iso?: string): string {
  if (!iso) return "\u2014";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "\u2014";
  }
}

function timeUntil(iso?: string): string {
  if (!iso) return "\u2014";
  try {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return "now";
    if (diff < 60_000) return "<1m";
    if (diff < 3_600_000) {
      const mins = Math.floor(diff / 60_000);
      return `${mins}m`;
    }
    const hours = Math.floor(diff / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    return `${hours}h ${mins}m`;
  } catch {
    return "\u2014";
  }
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Column widths
// ============================================================================

const COL_NAME = 18;
const COL_SCHED = 16;
const COL_LAST = 12;
const COL_NEXT = 12;
const COL_STATUS = 10;

// ============================================================================
// Component
// ============================================================================

export function SchedulerPanel({ jobs, onPause, onResume, onDelete, onClose }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleAction = useCallback(
    (input: string) => {
      const job = jobs[selectedIndex];
      if (!job) return;

      if (input === "p") {
        if (job.status === "active") {
          onPause?.(job.id);
        } else {
          onResume?.(job.id);
        }
      }

      if (input === "d") {
        if (confirmDelete === job.id) {
          onDelete?.(job.id);
          setConfirmDelete(null);
        } else {
          setConfirmDelete(job.id);
        }
      }
    },
    [selectedIndex, jobs, onPause, onResume, onDelete, confirmDelete],
  );

  useInput((input, key) => {
    if (key.escape) {
      if (confirmDelete) {
        setConfirmDelete(null);
      } else {
        onClose();
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      setConfirmDelete(null);
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(jobs.length - 1, i + 1));
      setConfirmDelete(null);
      return;
    }

    handleAction(input);
  });

  if (jobs.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text bold color="cyanBright">SCHEDULED JOBS</Text>
        <Text> </Text>
        <Text dimColor>No scheduled jobs configured.</Text>
        <Text> </Text>
        <Text dimColor>Esc to close</Text>
      </Box>
    );
  }

  const activeCount = jobs.filter((j) => j.status === "active").length;
  const pausedCount = jobs.filter((j) => j.status === "paused").length;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {/* Header */}
      <Box>
        <Text bold color="cyanBright">SCHEDULED JOBS</Text>
        <Text dimColor>
          {" "}({jobs.length} {"\u00b7"}{" "}
        </Text>
        <Text color="green">{activeCount} active</Text>
        {pausedCount > 0 && (
          <>
            <Text dimColor> {"\u00b7"} </Text>
            <Text dimColor>{pausedCount} paused</Text>
          </>
        )}
        <Text dimColor>)</Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box>
        <Text>{"  "}</Text>
        <Box width={COL_NAME}><Text bold dimColor>NAME</Text></Box>
        <Box width={COL_SCHED}><Text bold dimColor>SCHEDULE</Text></Box>
        <Box width={COL_LAST}><Text bold dimColor>LAST RUN</Text></Box>
        <Box width={COL_NEXT}><Text bold dimColor>NEXT RUN</Text></Box>
        <Box width={COL_STATUS}><Text bold dimColor>STATUS</Text></Box>
      </Box>

      {/* Job rows */}
      {jobs.map((job, i) => {
        const isSelected = i === selectedIndex;
        const statusIcon = job.status === "active" ? "\u2713" : "\u25CB";
        const statusColor = job.status === "active" ? "green" : "gray";
        const statusLabel = job.status === "active" ? "active" : "paused";
        const isDeleting = confirmDelete === job.id;

        return (
          <Box key={job.id} flexDirection="column">
            <Box>
              <Text color={isSelected ? "yellow" : undefined}>
                {isSelected ? "\u25B8 " : "  "}
              </Text>
              <Box width={COL_NAME}>
                <Text bold={isSelected}>
                  {padRight(job.name, COL_NAME)}
                </Text>
              </Box>
              <Box width={COL_SCHED}>
                <Text dimColor>{padRight(job.schedule, COL_SCHED)}</Text>
              </Box>
              <Box width={COL_LAST}>
                <Text dimColor>{padRight(timeAgo(job.lastRun), COL_LAST)}</Text>
              </Box>
              <Box width={COL_NEXT}>
                <Text>
                  {padRight(
                    job.status === "paused" ? "\u2014" : timeUntil(job.nextRun),
                    COL_NEXT,
                  )}
                </Text>
              </Box>
              <Box width={COL_STATUS}>
                <Text color={statusColor}>
                  {statusIcon} {statusLabel}
                </Text>
              </Box>
            </Box>

            {/* Delete confirmation inline */}
            {isDeleting && isSelected && (
              <Box paddingLeft={4}>
                <Text color="red">
                  Delete "{job.name}"? Press d again to confirm, Esc to cancel
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Footer hints */}
      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} p pause/resume {"\u00b7"} d delete {"\u00b7"} Esc close
      </Text>
    </Box>
  );
}

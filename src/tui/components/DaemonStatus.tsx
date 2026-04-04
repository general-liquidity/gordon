import React from "react";
import { Box, Text } from "ink";

// ============================================================================
// DaemonStatus — Compact status indicator for background daemon
//
// One-line format: "daemon: ● running · 3 tasks · 2h 14m"
// Embeddable in FooterHints or any footer row.
// ============================================================================

interface Props {
  status: "running" | "stopped" | "error";
  taskCount: number;
  /** Uptime in milliseconds */
  uptime: number;
}

const STATUS_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  running: { icon: "\u25CF", color: "green", label: "running" },
  stopped: { icon: "\u25CB", color: "gray", label: "stopped" },
  error:   { icon: "\u2717", color: "red",   label: "error" },
};

export function DaemonStatus({ status, taskCount, uptime }: Props) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.stopped!;
  const taskStr = `${taskCount} task${taskCount !== 1 ? "s" : ""}`;
  const uptimeStr = formatUptime(uptime);

  return (
    <Box>
      <Text dimColor>daemon: </Text>
      <Text color={cfg.color}>{cfg.icon} {cfg.label}</Text>
      {status === "running" && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text dimColor>{taskStr}</Text>
          <Text dimColor> {"\u00b7"} </Text>
          <Text dimColor>{uptimeStr}</Text>
        </>
      )}
      {status === "error" && (
        <>
          <Text dimColor> {"\u00b7"} </Text>
          <Text color="red" dimColor>check logs</Text>
        </>
      )}
    </Box>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

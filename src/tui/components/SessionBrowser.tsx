/**
 * SessionBrowser — Browse and resume past sessions
 *
 * Lists past sessions from runtime.listRecentHistory().
 * Shows: date, message count, P&L, duration.
 * Select to resume a session.
 *
 * Phase 17 of the TUI rebuild.
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// Types
// ============================================================================

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  messageCount: number;
  pnl?: number;
  duration?: string;
  label?: string;
}

interface Props {
  sessions: SessionSummary[];
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(startedAt: string, endedAt?: string): string {
  try {
    const start = new Date(startedAt).getTime();
    const end = endedAt ? new Date(endedAt).getTime() : Date.now();
    const diffMs = end - start;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
  } catch {
    return "";
  }
}

// ============================================================================
// Component
// ============================================================================

export function SessionBrowser({ sessions, onSelect, onClose }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Sort sessions by start date, most recent first
  const sorted = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      ),
    [sessions],
  );

  useInput((_, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(sorted.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const session = sorted[selectedIndex];
      if (session) onSelect(session.sessionId);
    }
  });

  if (sorted.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="cyan">SESSION HISTORY</Text>
        <Text> </Text>
        <Text dimColor>No past sessions found.</Text>
        <Text> </Text>
        <Text dimColor>Esc to close</Text>
      </Box>
    );
  }

  // Column widths
  const COL_DATE = 18;
  const COL_MSGS = 8;
  const COL_PNL = 12;
  const COL_DUR = 10;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Box>
        <Text bold color="cyan">SESSION HISTORY</Text>
        <Text dimColor> ({sorted.length} sessions)</Text>
      </Box>
      <Text> </Text>

      {/* Header row */}
      <Box paddingLeft={3}>
        <Box width={COL_DATE}>
          <Text bold dimColor>DATE</Text>
        </Box>
        <Box width={COL_MSGS}>
          <Text bold dimColor>MSGS</Text>
        </Box>
        <Box width={COL_PNL}>
          <Text bold dimColor>P&L</Text>
        </Box>
        <Box width={COL_DUR}>
          <Text bold dimColor>DURATION</Text>
        </Box>
      </Box>

      {/* Session rows */}
      {sorted.slice(0, 20).map((session, i) => {
        const isSelected = i === selectedIndex;
        const dur =
          session.duration ?? formatDuration(session.startedAt, session.endedAt);

        return (
          <Box key={session.sessionId} paddingLeft={1}>
            <Text color={isSelected ? "yellow" : undefined}>
              {isSelected ? "\u25B8 " : "  "}
            </Text>
            <Box width={COL_DATE}>
              <Text bold={isSelected}>{formatDate(session.startedAt)}</Text>
            </Box>
            <Box width={COL_MSGS}>
              <Text>{session.messageCount}</Text>
            </Box>
            <Box width={COL_PNL}>
              {session.pnl != null ? (
                <Text color={session.pnl >= 0 ? "green" : "red"}>
                  {session.pnl >= 0 ? "+" : ""}
                  {session.pnl.toFixed(2)}
                </Text>
              ) : (
                <Text dimColor>{"\u2014"}</Text>
              )}
            </Box>
            <Box width={COL_DUR}>
              <Text dimColor>{dur}</Text>
            </Box>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Enter resume {"\u00b7"} Esc close
      </Text>
    </Box>
  );
}

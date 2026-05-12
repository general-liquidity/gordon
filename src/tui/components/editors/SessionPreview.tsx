/**
 * SessionPreview — Bordered preview card shown before resuming a past session.
 *
 * Displays last agent, open positions, P&L, last active timestamp,
 * and keyboard shortcuts to resume, start a new session, or cancel.
 *
 * Keybindings: R = resume, N = new session, Escape = cancel.
 */

import React from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

export interface SessionPreview {
  lastAgent?: string;
  openPositions: number;
  pnlUsd?: number;
  lastActivity?: string; // ISO timestamp
  messageCount?: number;
}

interface Props {
  preview: SessionPreview;
  onResume: () => void;
  onClose: () => void;
  /** When true, skip the internal R/N/Esc keybindings (parent owns input). */
  embedded?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function formatTimeAgo(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  } catch {
    return iso;
  }
}

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? "+" : "";
  const abs = Math.abs(pnl);
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ============================================================================
// Component
// ============================================================================

export function SessionPreview({ preview, onResume, onClose, embedded = false }: Props) {
  useInput((input, key) => {
    if (key.escape || input === "n" || input === "N") {
      onClose();
      return;
    }
    if (input === "r" || input === "R") {
      onResume();
    }
  }, { isActive: !embedded });

  const lastAgent = preview.lastAgent ?? "Gordon";
  const hasPnl = preview.pnlUsd != null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      {/* Title */}
      <Box justifyContent="center">
        <Text bold color="cyan">{"↻ RESUME SESSION"}</Text>
      </Box>
      <Text> </Text>

      {/* Details */}
      <Box flexDirection="column" paddingLeft={1}>
        <Box>
          <Text dimColor>Last agent:      </Text>
          <Text>{lastAgent}</Text>
        </Box>
        <Box>
          <Text dimColor>Open positions:  </Text>
          <Text>{preview.openPositions}</Text>
        </Box>
        {hasPnl && (
          <Box>
            <Text dimColor>{"P&L:             "}</Text>
            <Text color={preview.pnlUsd! >= 0 ? "green" : "red"}>
              {formatPnl(preview.pnlUsd!)}
            </Text>
          </Box>
        )}
        {preview.lastActivity && (
          <Box>
            <Text dimColor>Last active:     </Text>
            <Text>{formatTimeAgo(preview.lastActivity)}</Text>
          </Box>
        )}
        {preview.messageCount != null && (
          <Box>
            <Text dimColor>Messages:        </Text>
            <Text>{preview.messageCount}</Text>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Text> </Text>
      <Text dimColor>{"[R] Resume  [N] New session  [Esc] Cancel"}</Text>
    </Box>
  );
}

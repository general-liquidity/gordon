/**
 * AuditBrowser — Scrollable list of agent decisions
 *
 * Pattern: Claude Code Messages transcript — role-prefixed entries with
 * colored agent badges, timestamps, and collapsible reasoning.
 * Triggered via /audit command.
 *
 * AUDIT TRAIL (12 entries)
 *
 *   14:32:01  SCANNER   scan BTC/USDT 4h               ✓
 *     Detected bullish divergence on RSI + MACD cross
 *
 *   14:32:05  ANALYST   evaluate setup confidence       ✓
 *     Confidence 82%. Entry zone 67,200-67,500.
 *
 *   14:32:08  PLANNER   create trade plan               ✗
 *     Risk/reward below 2:1 threshold (1.8:1). Skipped.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { WorkerBadge } from "./WorkerBadge.js";

// ============================================================================
// Types
// ============================================================================

export interface AuditEntry {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  result: "success" | "failure";
  reasoning?: string;
}

interface Props {
  entries: AuditEntry[];
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ============================================================================
// Component
// ============================================================================

const PAGE_SIZE = 15;

export function AuditBrowser({ entries, onClose }: Props) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Sort entries by timestamp, most recent last
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const visibleEntries = sorted.slice(scrollOffset, scrollOffset + PAGE_SIZE);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => {
        const next = Math.max(0, i - 1);
        // Scroll up if needed
        if (next < scrollOffset) {
          setScrollOffset(next);
        }
        return next;
      });
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => {
        const next = Math.min(sorted.length - 1, i + 1);
        // Scroll down if needed
        if (next >= scrollOffset + PAGE_SIZE) {
          setScrollOffset(next - PAGE_SIZE + 1);
        }
        return next;
      });
      return;
    }

    // Toggle reasoning collapse with Enter or space
    if (key.return || input === " ") {
      const entry = sorted[selectedIndex];
      if (entry?.reasoning) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(entry.id)) {
            next.delete(entry.id);
          } else {
            next.add(entry.id);
          }
          return next;
        });
      }
    }
  });

  if (sorted.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text bold color="cyanBright">AUDIT TRAIL</Text>
        <Text> </Text>
        <Text dimColor>No audit entries found.</Text>
        <Text> </Text>
        <Text dimColor>Esc to close</Text>
      </Box>
    );
  }

  // Count successes and failures
  const successes = sorted.filter((e) => e.result === "success").length;
  const failures = sorted.filter((e) => e.result === "failure").length;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {/* Header */}
      <Box>
        <Text bold color="cyanBright">AUDIT TRAIL</Text>
        <Text dimColor>
          {" "}({sorted.length} entries {"\u00b7"}{" "}
        </Text>
        <Text color="green">{successes} {"\u2713"}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text color="red">{failures} {"\u2717"}</Text>
        <Text dimColor>)</Text>
      </Box>
      <Text> </Text>

      {/* Entries */}
      {visibleEntries.map((entry, visIdx) => {
        const absIdx = scrollOffset + visIdx;
        const isSelected = absIdx === selectedIndex;
        const isExpanded = expandedIds.has(entry.id);
        const resultIcon = entry.result === "success" ? "\u2713" : "\u2717";
        const resultColor = entry.result === "success" ? "green" : "red";
        const hasReasoning = Boolean(entry.reasoning);

        return (
          <Box key={entry.id} flexDirection="column">
            {/* Main row */}
            <Box>
              <Text color={isSelected ? "yellow" : undefined}>
                {isSelected ? "\u25B8 " : "  "}
              </Text>
              <Text dimColor>{formatTime(entry.timestamp)}  </Text>
              <Box width={12}>
                <WorkerBadge agent={entry.agent} showBullet={false} />
              </Box>
              <Text>{entry.action}</Text>
              <Text>  </Text>
              <Text color={resultColor} bold>{resultIcon}</Text>
              {hasReasoning && (
                <Text dimColor>{isExpanded ? " \u25BC" : " \u25B6"}</Text>
              )}
            </Box>

            {/* Expanded reasoning */}
            {isExpanded && entry.reasoning && (
              <Box paddingLeft={6} marginBottom={1}>
                <Text dimColor>{entry.reasoning}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Footer */}
      <Text> </Text>
      {sorted.length > PAGE_SIZE && (
        <Text dimColor>
          Showing {scrollOffset + 1}-{Math.min(scrollOffset + PAGE_SIZE, sorted.length)} of {sorted.length}
        </Text>
      )}
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Enter expand {"\u00b7"} Esc close
      </Text>
    </Box>
  );
}

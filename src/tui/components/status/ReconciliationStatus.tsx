/**
 * ReconciliationStatus — Position/balance reconciliation
 *
 * Shows reconciliation status badge, last/next run times,
 * and discrepancy table with delta highlighting.
 *
 * Pattern: Claude Code health check panel with status indicators.
 */

import React from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export type ReconStatus = "ok" | "warning" | "error";

export interface Discrepancy {
  type: "position" | "balance";
  symbol: string;
  gordonValue: number;
  exchangeValue: number;
  delta: number;
}

interface Props {
  status: ReconStatus;
  discrepancies: Discrepancy[];
  lastRunAt: string;
  nextRunAt: string;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function statusConfig(status: ReconStatus): { icon: string; color: string; label: string } {
  if (status === "ok") return { icon: "\u2713", color: "green", label: "OK" };
  if (status === "warning") return { icon: "\u26A0", color: "yellow", label: "WARNING" };
  return { icon: "\u2717", color: "red", label: "ERROR" };
}

function deltaColor(delta: number): string {
  const abs = Math.abs(delta);
  if (abs < 0.01) return "green";
  if (abs < 1) return "yellow";
  return "red";
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(4);
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;
}

// ============================================================================
// Component
// ============================================================================

export function ReconciliationStatus({
  status,
  discrepancies,
  lastRunAt,
  nextRunAt,
  onClose,
}: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  const cfg = statusConfig(status);

  return (
    <Pane title="RECONCILIATION" color={cfg.color}>
      {/* Status */}
      <Box>
        <Text color={cfg.color} bold>
          {cfg.icon} {cfg.label}
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text dimColor>Last: {formatTime(lastRunAt)}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text dimColor>Next: {formatTime(nextRunAt)}</Text>
      </Box>

      {/* Discrepancies */}
      {discrepancies.length === 0 ? (
        <Box marginTop={1}>
          <Text color="green">No discrepancies found.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>DISCREPANCIES ({discrepancies.length})</Text>
          <Text> </Text>

          {/* Column headers */}
          <Box paddingLeft={2}>
            <Box width={10}><Text bold dimColor>TYPE</Text></Box>
            <Box width={10}><Text bold dimColor>SYMBOL</Text></Box>
            <Box width={14}><Text bold dimColor>GORDON</Text></Box>
            <Box width={14}><Text bold dimColor>EXCHANGE</Text></Box>
            <Box width={12}><Text bold dimColor>DELTA</Text></Box>
          </Box>

          {discrepancies.map((d, i) => (
            <Box key={`${d.type}-${d.symbol}-${i}`} paddingLeft={2}>
              <Box width={10}>
                <Text dimColor>{padRight(d.type, 10)}</Text>
              </Box>
              <Box width={10}>
                <Text bold>{padRight(d.symbol, 10)}</Text>
              </Box>
              <Box width={14}>
                <Text>{padLeft(fmtNum(d.gordonValue), 12)}</Text>
              </Box>
              <Box width={14}>
                <Text>{padLeft(fmtNum(d.exchangeValue), 12)}</Text>
              </Box>
              <Box width={12}>
                <Text color={deltaColor(d.delta)}>
                  {d.delta >= 0 ? "+" : ""}{fmtNum(d.delta)}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}

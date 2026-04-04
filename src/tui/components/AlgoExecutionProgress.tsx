/**
 * AlgoExecutionProgress — Live progress for TWAP/VWAP/Iceberg orders
 *
 * Shows algo name badge, fill progress bar, avg price vs target,
 * child order count, elapsed time, and status coloring.
 *
 * Pattern: Claude Code task progress panel with real-time metrics.
 */

import React from "react";
import { Box, Text } from "ink";
import { Pane } from "../design-system/Pane.js";
import { ProgressBar } from "../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export type AlgoType = "TWAP" | "VWAP" | "Iceberg";

export type AlgoStatus = "running" | "completed" | "cancelled";

interface Props {
  algo: AlgoType;
  filledQty: number;
  totalQty: number;
  avgFillPrice: number;
  targetPrice: number;
  childOrders: number;
  elapsed: string;
  status: AlgoStatus;
}

// ============================================================================
// Helpers
// ============================================================================

function statusColor(status: AlgoStatus): string {
  if (status === "running") return "cyan";
  if (status === "completed") return "green";
  return "red";
}

function statusIcon(status: AlgoStatus): string {
  if (status === "running") return "\u25CF";
  if (status === "completed") return "\u2713";
  return "\u2717";
}

function priceDelta(avg: number, target: number): { label: string; color: string } {
  if (target === 0) return { label: "\u2014", color: "gray" };
  const pct = ((avg - target) / target) * 100;
  const sign = pct >= 0 ? "+" : "";
  return {
    label: `${sign}${pct.toFixed(3)}%`,
    color: Math.abs(pct) < 0.05 ? "green" : Math.abs(pct) < 0.2 ? "yellow" : "red",
  };
}

// ============================================================================
// Component
// ============================================================================

export function AlgoExecutionProgress({
  algo,
  filledQty,
  totalQty,
  avgFillPrice,
  targetPrice,
  childOrders,
  elapsed,
  status,
}: Props) {
  const fillRatio = totalQty > 0 ? filledQty / totalQty : 0;
  const fillPct = (fillRatio * 100).toFixed(1);
  const delta = priceDelta(avgFillPrice, targetPrice);
  const color = statusColor(status);

  return (
    <Pane title={`${algo} EXECUTION`} color={color}>
      {/* Status line */}
      <Box>
        <Text color={color}>{statusIcon(status)} {status.toUpperCase()}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text bold color={color}>{algo}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text dimColor>{elapsed}</Text>
      </Box>

      {/* Fill progress */}
      <Box marginTop={1}>
        <Box width={10}>
          <Text dimColor>Fill</Text>
        </Box>
        <ProgressBar value={fillRatio} width={20} fillColor={color} />
        <Text> </Text>
        <Text color={color}>
          {filledQty.toLocaleString()} / {totalQty.toLocaleString()} ({fillPct}%)
        </Text>
      </Box>

      {/* Avg price vs target */}
      <Box>
        <Box width={10}>
          <Text dimColor>Avg Price</Text>
        </Box>
        <Text>${avgFillPrice.toFixed(2)}</Text>
        <Text dimColor> vs target </Text>
        <Text>${targetPrice.toFixed(2)}</Text>
        <Text dimColor> (</Text>
        <Text color={delta.color}>{delta.label}</Text>
        <Text dimColor>)</Text>
      </Box>

      {/* Child orders */}
      <Box>
        <Box width={10}>
          <Text dimColor>Children</Text>
        </Box>
        <Text>{childOrders} child orders</Text>
      </Box>
    </Pane>
  );
}

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useStats } from "../state/StatsProvider.js";

// ============================================================================
// CostDisplay — Compact inline session stats
//
// Format: "$0.42 tok · +$142 P&L · 3 trades · 12m"
// Token cost: dimColor
// P&L: green (positive) / red (negative)
// Trade count & elapsed: dimColor
// ============================================================================

export function CostDisplay() {
  const { stats } = useStats();
  const [elapsed, setElapsed] = useState("");

  // Update elapsed time every 30 seconds
  useEffect(() => {
    const update = () => {
      const diffMs = Date.now() - stats.sessionStartTime;
      setElapsed(formatElapsed(diffMs));
    };
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, [stats.sessionStartTime]);

  const costStr = `$${stats.tokenCostUsd.toFixed(2)} tok`;
  const pnlSign = stats.tradingPnL >= 0 ? "+" : "";
  const pnlStr = `${pnlSign}$${stats.tradingPnL.toFixed(0)} P&L`;
  const pnlColor = stats.tradingPnL >= 0 ? "green" : "red";
  const tradeStr = `${stats.tradeCount} trade${stats.tradeCount !== 1 ? "s" : ""}`;

  return (
    <Box>
      <Text dimColor>{costStr}</Text>
      <Text dimColor> {"\u00b7"} </Text>
      <Text color={pnlColor}>{pnlStr}</Text>
      <Text dimColor> {"\u00b7"} </Text>
      <Text dimColor>{tradeStr}</Text>
      <Text dimColor> {"\u00b7"} </Text>
      <Text dimColor>{elapsed}</Text>
    </Box>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes > 0 ? `${minutes}m` : ""}`;
}

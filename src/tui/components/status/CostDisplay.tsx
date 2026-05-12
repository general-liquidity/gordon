import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "../../ink-custom";
import { useStats } from "../../state/StatsProvider.js";

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
  const [displayTokenCost, setDisplayTokenCost] = useState(stats.tokenCostUsd);

  // Smooth token counter animation — use ref to avoid cascading interval restarts
  const targetCostRef = useRef(stats.tokenCostUsd);
  targetCostRef.current = stats.tokenCostUsd;

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayTokenCost((prev) => {
        const gap = targetCostRef.current - prev;
        if (Math.abs(gap) < 0.001) return prev; // Don't update if close enough
        const increment = Math.abs(gap) < 0.05 ? 0.001 * Math.sign(gap) : gap * 0.15;
        return prev + increment;
      });
    }, 50);
    return () => clearInterval(interval);
  }, []); // No deps — interval runs once, reads target from ref

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

  const costStr = `$${displayTokenCost.toFixed(2)} tok`;
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

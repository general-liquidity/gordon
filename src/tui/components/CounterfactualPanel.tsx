/**
 * CounterfactualPanel — "What if" analysis
 *
 * Shows actual trade outcome and 3-4 alternative scenarios
 * with P&L comparison. Color coding for better/worse outcomes.
 *
 * Pattern: Claude Code diff/comparison view with annotations.
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export interface TradeOutcome {
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
}

export interface Scenario {
  description: string;
  alternateExit: number;
  alternatePnl: number;
  alternatePnlPercent: number;
}

interface Props {
  trade: TradeOutcome;
  scenarios: Scenario[];
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function pnlColor(pnl: number): string {
  if (pnl > 0) return "green";
  if (pnl < 0) return "red";
  return "white";
}

function fmtPnl(pnl: number): string {
  return `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
}

function fmtPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function comparisonColor(scenarioPnl: number, actualPnl: number): string {
  if (scenarioPnl > actualPnl) return "green";
  if (scenarioPnl < actualPnl) return "red";
  return "white";
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function CounterfactualPanel({ trade, scenarios, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <Pane title="WHAT IF ANALYSIS" color="yellow">
      {/* Actual trade */}
      <Box flexDirection="column">
        <Text bold>ACTUAL TRADE</Text>
        <Box paddingLeft={2}>
          <Text bold>{trade.symbol}</Text>
          <Text dimColor> {"\u00b7"} </Text>
          <Text>{trade.side.toUpperCase()}</Text>
          <Text dimColor> {"\u00b7"} </Text>
          <Text dimColor>Entry ${trade.entryPrice.toFixed(2)} {"\u2192"} Exit ${trade.exitPrice.toFixed(2)}</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text dimColor>P&L: </Text>
          <Text bold color={pnlColor(trade.pnl)}>{fmtPnl(trade.pnl)} ({fmtPct(trade.pnlPercent)})</Text>
        </Box>
      </Box>

      <Text> </Text>
      <Box>
        <Text dimColor>{"\u2500".repeat(50)}</Text>
      </Box>
      <Text> </Text>

      {/* Scenarios */}
      <Text bold>ALTERNATIVE SCENARIOS</Text>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={2}>
        <Box width={28}><Text bold dimColor>SCENARIO</Text></Box>
        <Box width={12}><Text bold dimColor>EXIT</Text></Box>
        <Box width={14}><Text bold dimColor>P&L</Text></Box>
        <Box width={10}><Text bold dimColor>DIFF</Text></Box>
      </Box>

      {scenarios.map((s, i) => {
        const diff = s.alternatePnl - trade.pnl;
        const color = comparisonColor(s.alternatePnl, trade.pnl);

        return (
          <Box key={i} paddingLeft={2}>
            <Box width={28}>
              <Text>{padRight(s.description, 28)}</Text>
            </Box>
            <Box width={12}>
              <Text>${s.alternateExit.toFixed(2)}</Text>
            </Box>
            <Box width={14}>
              <Text color={pnlColor(s.alternatePnl)}>
                {fmtPnl(s.alternatePnl)} ({fmtPct(s.alternatePnlPercent)})
              </Text>
            </Box>
            <Box width={10}>
              <Text color={color}>
                {diff >= 0 ? "+" : ""}{diff.toFixed(2)}
              </Text>
            </Box>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}

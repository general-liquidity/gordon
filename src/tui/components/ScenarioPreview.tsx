import React from "react";
import { Box, Text } from "ink";
import { Pane } from "../design-system/Pane.js";

export interface TradeScenarios {
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  sizeUsd: number;
  portfolioValueUsd?: number;
}

interface Scenario {
  name: string;
  priceLevel: number;
  pnlUsd: number;
  pnlPct: number;
  portfolioImpactPct?: number;
  color: string;
  icon: string;
}

export function ScenarioPreview({ scenarios: t }: { scenarios: TradeScenarios }) {
  const direction = t.side === "LONG" ? 1 : -1;
  const stopPnl = ((t.stopLoss - t.entry) / t.entry) * t.sizeUsd * direction;
  const targetPnl = ((t.takeProfit - t.entry) / t.entry) * t.sizeUsd * direction;
  const breakevenPnl = 0;

  const scenarios: Scenario[] = [
    {
      name: "Stop Hit",
      priceLevel: t.stopLoss,
      pnlUsd: stopPnl,
      pnlPct: (stopPnl / t.sizeUsd) * 100,
      portfolioImpactPct: t.portfolioValueUsd ? (stopPnl / t.portfolioValueUsd) * 100 : undefined,
      color: "red",
      icon: "✗",
    },
    {
      name: "Breakeven",
      priceLevel: t.entry,
      pnlUsd: breakevenPnl,
      pnlPct: 0,
      color: "gray",
      icon: "═",
    },
    {
      name: "Target Hit",
      priceLevel: t.takeProfit,
      pnlUsd: targetPnl,
      pnlPct: (targetPnl / t.sizeUsd) * 100,
      portfolioImpactPct: t.portfolioValueUsd ? (targetPnl / t.portfolioValueUsd) * 100 : undefined,
      color: "green",
      icon: "✓",
    },
  ];

  const rr = Math.abs(stopPnl) > 0 ? Math.abs(targetPnl / stopPnl) : 0;

  return (
    <Pane title="SCENARIO PREVIEW" color="cyan">
      <Box flexDirection="column">
        <Box>
          <Text dimColor bold>{"OUTCOME".padEnd(14)}</Text>
          <Text dimColor bold>{"PRICE".padEnd(12)}</Text>
          <Text dimColor bold>{"P&L $".padEnd(12)}</Text>
          <Text dimColor bold>{"P&L %".padEnd(10)}</Text>
          <Text dimColor bold>PORT</Text>
        </Box>
        {scenarios.map((s) => (
          <Box key={s.name}>
            <Text color={s.color}>{s.icon} </Text>
            <Text bold>{s.name.padEnd(12)}</Text>
            <Text>${s.priceLevel.toFixed(2).padEnd(10)} </Text>
            <Text color={s.color} bold>
              {s.pnlUsd >= 0 ? "+" : ""}${s.pnlUsd.toFixed(0).padEnd(9)}
            </Text>
            <Text color={s.color}>
              {s.pnlPct >= 0 ? "+" : ""}{s.pnlPct.toFixed(2)}%{"".padEnd(5)}
            </Text>
            {s.portfolioImpactPct !== undefined && (
              <Text dimColor>{s.portfolioImpactPct >= 0 ? "+" : ""}{s.portfolioImpactPct.toFixed(2)}%</Text>
            )}
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>Risk/Reward: </Text>
          <Text bold color={rr >= 2 ? "green" : rr >= 1 ? "yellow" : "red"}>{rr.toFixed(2)}:1</Text>
          <Text dimColor>  {"·"}  Win rate needed to break even: </Text>
          <Text bold>{(100 / (1 + rr)).toFixed(0)}%</Text>
        </Box>
      </Box>
    </Pane>
  );
}

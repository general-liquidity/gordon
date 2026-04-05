import React from "react";
import { Box, Text } from "ink";
import { Pane } from "../design-system/Pane.js";

export interface SymbolPulse {
  ticker: string;
  bullCount: number;
  bearCount: number;
  neutralCount: number;
  avgConfidence: number;
  dominantSignal: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
}

interface Props {
  pulses: SymbolPulse[];
  onClose?: () => void;
}

const SIGNAL_COLORS: Record<string, string> = {
  BULLISH: "green",
  BEARISH: "red",
  NEUTRAL: "gray",
  MIXED: "yellow",
};

export function MarketPulsePanel({ pulses }: Props) {
  return (
    <Pane title="MARKET PULSE">
      <Box flexDirection="column">
        <Box>
          <Text dimColor bold>{"SYMBOL".padEnd(10)}</Text>
          <Text dimColor bold>{"SIGNAL".padEnd(15)}</Text>
          <Text dimColor bold>{"BARS".padEnd(12)}</Text>
          <Text dimColor bold>{"CONF".padEnd(8)}</Text>
        </Box>
        {pulses.map((p) => {
          const bars = "+".repeat(p.bullCount) + "-".repeat(p.bearCount) + ".".repeat(p.neutralCount);
          const color = SIGNAL_COLORS[p.dominantSignal] ?? "white";
          return (
            <Box key={p.ticker}>
              <Text bold>{p.ticker.padEnd(10)}</Text>
              <Text color={color} bold>{p.dominantSignal.padEnd(15)}</Text>
              <Text color={color}>{bars.padEnd(12)}</Text>
              <Text dimColor>{p.avgConfidence.toFixed(1)}/10</Text>
            </Box>
          );
        })}
      </Box>
    </Pane>
  );
}

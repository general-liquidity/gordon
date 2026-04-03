import React from "react";
import { Box, Text } from "ink";
import { fmtNum } from "../components/DataTable.js";

/**
 * LiquidationRenderer -- Cascading liquidation levels with size bars
 * Phase 10: Shows liquidation levels above/below current price with volume bars
 */

interface LiquidationLevel {
  price: number;
  size: number;
  side: string; // "long" | "short"
  cumulative?: number;
}

interface LiquidationData {
  symbol: string;
  currentPrice: number;
  levels: LiquidationLevel[];
}

interface Props {
  data: LiquidationData;
}

export function LiquidationRenderer({ data }: Props) {
  // Split into above/below current price
  const above = data.levels
    .filter((l) => l.price > data.currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, 10);
  const below = data.levels
    .filter((l) => l.price <= data.currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, 10);

  const allSizes = data.levels.map((l) => l.size);
  const maxSize = Math.max(...allSizes, 1);
  const barWidth = 20;

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {/* Header */}
      <Box>
        <Text bold color="cyanBright">{data.symbol}</Text>
        <Text dimColor> {"\u00b7"} LIQUIDATION MAP</Text>
      </Box>

      {/* Levels above price (short liquidations) */}
      {above.map((level, i) => (
        <LevelRow key={`above-${i}`} level={level} maxSize={maxSize} barWidth={barWidth} />
      ))}

      {/* Current price marker */}
      <Box marginY={0}>
        <Box width={12} justifyContent="flex-end">
          <Text bold color="yellow">{fmtNum(data.currentPrice)}</Text>
        </Box>
        <Text> </Text>
        <Text dimColor>{"\u2500".repeat(barWidth + 12)} CURRENT</Text>
      </Box>

      {/* Levels below price (long liquidations) */}
      {below.map((level, i) => (
        <LevelRow key={`below-${i}`} level={level} maxSize={maxSize} barWidth={barWidth} />
      ))}
    </Box>
  );
}

function LevelRow({
  level,
  maxSize,
  barWidth,
}: {
  level: LiquidationLevel;
  maxSize: number;
  barWidth: number;
}) {
  const filled = Math.max(1, Math.round((level.size / maxSize) * barWidth));
  const isShort = level.side.toLowerCase() === "short";
  const color = isShort ? "red" : "green";
  const sideLabel = isShort ? "SH" : "LG";

  return (
    <Box>
      <Box width={12} justifyContent="flex-end">
        <Text color={color}>{fmtNum(level.price)}</Text>
      </Box>
      <Text> </Text>
      <Box width={10} justifyContent="flex-end">
        <Text dimColor>{fmtNum(level.size)}</Text>
      </Box>
      <Text> </Text>
      <Text color={color}>{"\u2588".repeat(filled)}</Text>
      <Text dimColor> {sideLabel}</Text>
      {level.cumulative != null && (
        <Text dimColor> ({fmtNum(level.cumulative)} cum)</Text>
      )}
    </Box>
  );
}

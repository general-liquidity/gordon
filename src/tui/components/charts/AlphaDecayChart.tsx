/**
 * AlphaDecayChart — Alpha decay over time
 *
 * ASCII sparkline showing alpha value per month.
 * Decay point marked with warning if detected.
 * Color: green above 0, red below 0, yellow at decay point.
 *
 * Pattern: Claude Code ASCII chart with annotations.
 */

import React from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export interface MonthlyAlpha {
  month: string;
  alpha: number;
}

interface Props {
  months: MonthlyAlpha[];
  decayPoint?: number;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

const SPARK_CHARS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

function alphaColor(alpha: number, isDecay: boolean): string {
  if (isDecay) return "yellow";
  if (alpha > 0) return "green";
  if (alpha < 0) return "red";
  return "white";
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function AlphaDecayChart({ months, decayPoint, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  if (months.length === 0) {
    return (
      <Pane title="ALPHA DECAY" color="cyan">
        <Text dimColor>No alpha data available.</Text>
        <Text> </Text>
        <Text dimColor>Esc close</Text>
      </Pane>
    );
  }

  const maxAlpha = Math.max(...months.map((m) => Math.abs(m.alpha)), 0.01);

  // Render the sparkline chart
  const chartHeight = 8;
  const chartRows: string[][] = [];
  const chartColors: string[][] = [];

  for (let row = chartHeight - 1; row >= 0; row--) {
    const rowChars: string[] = [];
    const rowColors: string[] = [];
    for (let col = 0; col < months.length; col++) {
      const m = months[col]!;
      const isDecayCol = decayPoint !== undefined && col === decayPoint;
      const normalized = ((m.alpha + maxAlpha) / (2 * maxAlpha)) * chartHeight;
      const filled = Math.round(normalized);

      if (row < filled) {
        const sparkIdx = Math.min(SPARK_CHARS.length - 1, Math.max(0, Math.round((normalized - row) * (SPARK_CHARS.length - 1))));
        rowChars.push(row === Math.floor(filled) - 1 ? SPARK_CHARS[sparkIdx]! : SPARK_CHARS[7]!);
      } else if (isDecayCol) {
        rowChars.push("\u2502");
      } else {
        rowChars.push(" ");
      }
      rowColors.push(alphaColor(m.alpha, isDecayCol));
    }
    chartRows.push(rowChars);
    chartColors.push(rowColors);
  }

  // Zero line position
  const zeroRow = Math.round((maxAlpha / (2 * maxAlpha)) * chartHeight);

  return (
    <Pane title="ALPHA DECAY" color="cyan">
      {/* Chart */}
      <Box flexDirection="column" paddingLeft={2}>
        {chartRows.map((row, rowIdx) => {
          const actualRow = chartHeight - 1 - rowIdx;
          const isZeroLine = actualRow === zeroRow;
          return (
            <Box key={rowIdx}>
              <Box width={6}>
                <Text dimColor>
                  {isZeroLine ? " 0.00" : "     "}
                </Text>
              </Box>
              <Text dimColor>{isZeroLine ? "\u2500" : "\u2502"}</Text>
              {row.map((ch, colIdx) => (
                <Text key={colIdx} color={chartColors[rowIdx]![colIdx]}>
                  {ch}
                </Text>
              ))}
            </Box>
          );
        })}

        {/* X-axis */}
        <Box>
          <Box width={6}><Text> </Text></Box>
          <Text dimColor>{"\u2514"}{"\u2500".repeat(months.length)}</Text>
        </Box>

        {/* Month labels (show first, mid, last) */}
        <Box>
          <Box width={7}><Text> </Text></Box>
          <Text dimColor>
            {months[0]?.month ?? ""}
            {months.length > 2
              ? " ".repeat(Math.max(1, Math.floor(months.length / 2) - (months[0]?.month.length ?? 0))) +
                (months[Math.floor(months.length / 2)]?.month ?? "")
              : ""}
          </Text>
        </Box>
      </Box>

      {/* Per-month values */}
      <Text> </Text>
      <Box flexDirection="column" paddingLeft={2}>
        {months.map((m, i) => {
          const isDecayCol = decayPoint !== undefined && i === decayPoint;
          return (
            <Box key={m.month}>
              <Box width={10}>
                <Text dimColor>{padRight(m.month, 10)}</Text>
              </Box>
              <Text color={alphaColor(m.alpha, isDecayCol)}>
                {m.alpha >= 0 ? "+" : ""}{m.alpha.toFixed(4)}
              </Text>
              {isDecayCol && <Text color="yellow"> {"\u26A0"} decay</Text>}
            </Box>
          );
        })}
      </Box>

      {/* Decay warning */}
      {decayPoint !== undefined && (
        <Box marginTop={1}>
          <Text color="yellow" bold>
            {"\u26A0"} Strategy alpha decaying {"\u2014"} consider parameter refresh
          </Text>
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}

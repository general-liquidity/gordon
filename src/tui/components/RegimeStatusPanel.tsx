/**
 * RegimeStatusPanel — Current market regime per symbol
 *
 * Each row: symbol + regime badge (colored) + confidence bar + duration
 * + mini sparkline.
 *
 * Pattern: Claude Code status dashboard with per-symbol metrics.
 */

import React from "react";
import { Box, Text, useInput } from "../ink-custom";
import { Pane } from "../design-system/Pane.js";
import { ProgressBar } from "../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export type RegimeType = "trending" | "ranging" | "volatile";

export interface SymbolRegime {
  symbol: string;
  regime: RegimeType;
  confidence: number;
  duration: string;
  sparkline: number[];
}

interface Props {
  regimes: SymbolRegime[];
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

const REGIME_COLOR: Record<RegimeType, string> = {
  trending: "cyan",
  ranging: "yellow",
  volatile: "red",
};

const REGIME_ICON: Record<RegimeType, string> = {
  trending: "\u2192",
  ranging: "\u2194",
  volatile: "\u2195",
};

const SPARK_CHARS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

function renderSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const last20 = values.slice(-20);
  const min = Math.min(...last20);
  const max = Math.max(...last20);
  const range = max - min || 1;
  return last20
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
    })
    .join("");
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function RegimeStatusPanel({ regimes, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  if (regimes.length === 0) {
    return (
      <Pane title="MARKET REGIMES" color="cyan">
        <Text dimColor>No regime data available.</Text>
        <Text> </Text>
        <Text dimColor>Esc close</Text>
      </Pane>
    );
  }

  return (
    <Pane title="MARKET REGIMES" color="cyan">
      {/* Column headers */}
      <Box paddingLeft={2}>
        <Box width={10}><Text bold dimColor>SYMBOL</Text></Box>
        <Box width={12}><Text bold dimColor>REGIME</Text></Box>
        <Box width={16}><Text bold dimColor>CONFIDENCE</Text></Box>
        <Box width={10}><Text bold dimColor>DURATION</Text></Box>
        <Box width={22}><Text bold dimColor>SPARKLINE</Text></Box>
      </Box>

      {/* Regime rows */}
      {regimes.map((r) => {
        const color = REGIME_COLOR[r.regime];
        const icon = REGIME_ICON[r.regime];
        const spark = renderSparkline(r.sparkline);

        return (
          <Box key={r.symbol} paddingLeft={2}>
            <Box width={10}>
              <Text bold>{padRight(r.symbol, 10)}</Text>
            </Box>
            <Box width={12}>
              <Text color={color} bold>
                {icon} {padRight(r.regime.toUpperCase(), 10)}
              </Text>
            </Box>
            <Box width={16}>
              <ProgressBar value={r.confidence / 100} width={8} fillColor={color} />
              <Text color={color}> {r.confidence}%</Text>
            </Box>
            <Box width={10}>
              <Text dimColor>{r.duration}</Text>
            </Box>
            <Box width={22}>
              <Text color={color}>{spark}</Text>
            </Box>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}

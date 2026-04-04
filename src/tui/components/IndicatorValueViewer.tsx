/**
 * IndicatorValueViewer — Real-time indicator values for a symbol
 *
 * Each row: name (left-aligned) + value (right-aligned, colored by zone)
 * + mini sparkline (last 20 values).
 *
 * Pattern: Claude Code context panel with live data visualization.
 */

import React from "react";
import { Box, Text } from "ink";
import { Pane } from "../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export type IndicatorZone = "overbought" | "oversold" | "neutral" | "bullish" | "bearish";

export interface IndicatorReading {
  name: string;
  value: number | string;
  zone?: IndicatorZone;
  sparkline?: number[];
}

interface Props {
  symbol: string;
  indicators: IndicatorReading[];
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function zoneColor(zone?: IndicatorZone): string | undefined {
  if (zone === "overbought") return "red";
  if (zone === "oversold") return "green";
  if (zone === "bullish") return "green";
  if (zone === "bearish") return "red";
  return undefined;
}

function zoneBadge(zone?: IndicatorZone): string {
  if (!zone) return "";
  return ` ${zone.toUpperCase()}`;
}

const SPARK_CHARS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

function renderSparkline(values?: number[]): string {
  if (!values || values.length === 0) return "";
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

function formatValue(v: number | string): string {
  if (typeof v === "string") return v;
  if (Number.isNaN(v)) return "\u2014";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(4);
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

export function IndicatorValueViewer({ symbol, indicators, onClose }: Props) {
  return (
    <Pane title={`INDICATORS \u00b7 ${symbol}`} color="cyan">
      {/* Header */}
      <Box>
        <Box width={20}><Text bold dimColor>INDICATOR</Text></Box>
        <Box width={14}><Text bold dimColor>{"     VALUE"}</Text></Box>
        <Box width={12}><Text bold dimColor>ZONE</Text></Box>
        <Box width={22}><Text bold dimColor>SPARKLINE</Text></Box>
      </Box>

      {/* Rows */}
      {indicators.map((ind) => {
        const color = zoneColor(ind.zone);
        const spark = renderSparkline(ind.sparkline);

        return (
          <Box key={ind.name}>
            <Box width={20}>
              <Text>{padRight(ind.name, 20)}</Text>
            </Box>
            <Box width={14}>
              <Text color={color}>{padLeft(formatValue(ind.value), 14)}</Text>
            </Box>
            <Box width={12}>
              <Text color={color}>{ind.zone ? padRight(ind.zone.toUpperCase(), 12) : padRight("", 12)}</Text>
            </Box>
            <Box width={22}>
              <Text color={color ?? "cyan"}>{spark}</Text>
            </Box>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}

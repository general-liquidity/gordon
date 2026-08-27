/**
 * IndicatorDashboard — Compact technical indicator display
 *
 * Shows key indicator values for a symbol in a compact key-value layout:
 *   - RSI gauge bar (0-100) colored by zone
 *   - MACD direction + cross state
 *   - Trend arrow + direction + strength
 *   - Bollinger Band position
 *   - Volume bar relative to average
 *
 * Pattern: Claude Code context visualization panel.
 */

import type React from "react";
import { Box, Text } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

export interface MacdData {
  value: number;
  signal: number;
  histogram: number;
}

export interface TrendData {
  direction: "up" | "down" | "sideways";
  strength: "strong" | "moderate" | "weak";
}

export interface BollingerData {
  upper: number;
  middle: number;
  lower: number;
  price: number;
}

export interface VolumeData {
  current: number;
  average: number;
}

interface Props {
  symbol: string;
  rsi: number;
  macd: MacdData;
  trend: TrendData;
  bollinger: BollingerData;
  volume: VolumeData;
}

// ============================================================================
// Helpers
// ============================================================================

function rsiColor(value: number): string {
  if (value <= 30) return "green";
  if (value >= 70) return "red";
  return "white";
}

function rsiZone(value: number): string {
  if (value <= 30) return "OVERSOLD";
  if (value >= 70) return "OVERBOUGHT";
  return "NEUTRAL";
}

function renderGauge(value: number, max: number, width: number = 16): string {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return "\u2588".repeat(Math.max(0, filled)) + "\u2591".repeat(Math.max(0, empty));
}

function macdState(macd: MacdData): { arrow: string; label: string; color: string } {
  const cross = macd.value > macd.signal;
  const rising = macd.histogram > 0;
  if (cross && rising) return { arrow: "\u25B2", label: "BULLISH CROSS", color: "green" };
  if (!cross && !rising) return { arrow: "\u25BC", label: "BEARISH CROSS", color: "red" };
  return { arrow: rising ? "\u25B2" : "\u25BC", label: "NEUTRAL", color: "yellow" };
}

function trendArrow(dir: TrendData["direction"]): string {
  if (dir === "up") return "\u25B2";
  if (dir === "down") return "\u25BC";
  return "\u25C6";
}

function trendColor(dir: TrendData["direction"]): string {
  if (dir === "up") return "green";
  if (dir === "down") return "red";
  return "yellow";
}

function bbPosition(bb: BollingerData): { label: string; color: string } {
  if (bb.price >= bb.upper) return { label: "ABOVE UPPER", color: "red" };
  if (bb.price <= bb.lower) return { label: "BELOW LOWER", color: "green" };
  const mid = (bb.upper + bb.lower) / 2;
  if (bb.price > mid) return { label: "UPPER HALF", color: "yellow" };
  return { label: "LOWER HALF", color: "cyan" };
}

// ============================================================================
// KVRow
// ============================================================================

function KVRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box paddingLeft={2}>
      <Box width={10}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box>{children}</Box>
    </Box>
  );
}

// ============================================================================
// Component
// ============================================================================

export function IndicatorDashboard({ symbol, rsi, macd, trend, bollinger, volume }: Props) {
  const macdInfo = macdState(macd);
  const bbInfo = bbPosition(bollinger);
  const volRatio = volume.average > 0 ? volume.current / volume.average : 1;
  const volAbove = volRatio >= 1;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0}>
      {/* Header */}
      <Box>
        <Text bold color="cyan">
          INDICATORS
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text bold>{symbol}</Text>
      </Box>

      {/* RSI */}
      <KVRow label="RSI">
        <Text color={rsiColor(rsi)}>
          {renderGauge(rsi, 100)} {rsi.toFixed(1)} {rsiZone(rsi)}
        </Text>
      </KVRow>

      {/* MACD */}
      <KVRow label="MACD">
        <Text color={macdInfo.color}>
          {macdInfo.arrow} {macdInfo.label}
        </Text>
        <Text dimColor>
          {" "}
          ({macd.histogram > 0 ? "+" : ""}
          {macd.histogram.toFixed(4)})
        </Text>
      </KVRow>

      {/* Trend */}
      <KVRow label="Trend">
        <Text color={trendColor(trend.direction)}>
          {trendArrow(trend.direction)} {trend.direction.toUpperCase()}
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text>{trend.strength}</Text>
      </KVRow>

      {/* Bollinger Bands */}
      <KVRow label="BB">
        <Text color={bbInfo.color}>{bbInfo.label}</Text>
        <Text dimColor>
          {" "}
          (L:{bollinger.lower.toFixed(2)} M:{bollinger.middle.toFixed(2)} U:
          {bollinger.upper.toFixed(2)})
        </Text>
      </KVRow>

      {/* Volume */}
      <KVRow label="Volume">
        <Text color={volAbove ? "green" : "red"}>
          {renderGauge(Math.min(volRatio * 50, 100), 100, 10)} {volRatio.toFixed(1)}x avg{" "}
          {volAbove ? "ABOVE" : "BELOW"}
        </Text>
      </KVRow>
    </Box>
  );
}

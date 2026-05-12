import React from "react";
import { Text } from "../../ink-custom";

// ============================================================================
// InlineChart — Unicode block sparkline
//
// ▁▂▃▃▄▅▆▆▇█████▇▇▆▇▇████
//
// Uses 8-level Unicode block characters for compact price history.
// Color: green if uptrend, red if downtrend.
// ============================================================================

const BLOCKS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

interface Props {
  data: number[];
  width?: number;
  showTrend?: boolean;
}

export function InlineChart({ data, width, showTrend = true }: Props) {
  if (data.length < 2) {
    return <Text dimColor>{"\u2014"}</Text>;
  }

  // Resample to target width if needed
  const targetWidth = width ?? Math.min(data.length, 30);
  const resampled = resample(data, targetWidth);

  const min = Math.min(...resampled);
  const max = Math.max(...resampled);
  const range = max - min || 1;

  // Build sparkline
  const chars = resampled.map((v) => {
    const idx = Math.floor(((v - min) / range) * (BLOCKS.length - 1));
    return BLOCKS[Math.max(0, Math.min(idx, BLOCKS.length - 1))]!;
  }).join("");

  // Determine trend color
  const first = resampled[0]!;
  const last = resampled[resampled.length - 1]!;
  const color = last > first ? "green" : last < first ? "red" : undefined;

  // Trend arrow
  const arrow = showTrend
    ? last > first ? " \u2191" : last < first ? " \u2193" : " \u2192"
    : "";

  return (
    <Text color={color}>
      {chars}{arrow}
    </Text>
  );
}

function resample(data: number[], targetLen: number): number[] {
  if (data.length <= targetLen) return data;
  const result: number[] = [];
  const step = data.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    const idx = Math.min(Math.floor(i * step), data.length - 1);
    result.push(data[idx]!);
  }
  return result;
}

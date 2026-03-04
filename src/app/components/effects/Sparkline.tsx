/**
 * Sparkline Component & Utility
 * Inline mini price charts using Unicode block characters.
 *
 * ▁▂▃▄▅▆▇█ — 8 levels of height
 *
 * Usage:
 *   <Sparkline data={[10, 12, 11, 15, 13, 14, 16]} />
 *   sparklineString([10, 12, 11, 15, 13, 14, 16]) → "▂▄▃▇▅▆█"
 */

import React from "react";
import { Text } from "ink";
import { getGradientColor, GRADIENTS, type GradientName } from "./GradientText.tsx";

// Unicode block characters from lowest to highest
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Convert numeric data to a sparkline string
 */
export function sparklineString(data: number[]): string {
  if (data.length === 0) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  return data
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (BLOCKS.length - 1));
      return BLOCKS[Math.min(idx, BLOCKS.length - 1)]!;
    })
    .join("");
}

/**
 * Determine trend from data: up, down, or flat
 */
export function sparklineTrend(data: number[]): "up" | "down" | "flat" {
  if (data.length < 2) return "flat";
  const first = data[0]!;
  const last = data[data.length - 1]!;
  const pctChange = ((last - first) / Math.abs(first || 1)) * 100;
  if (pctChange > 1) return "up";
  if (pctChange < -1) return "down";
  return "flat";
}

export interface SparklineProps {
  /** Numeric data points */
  data: number[];
  /** Width (number of characters). Data will be downsampled if longer. Default: data.length */
  width?: number;
  /** Color mode */
  color?: "trend" | "gradient" | string;
  /** Gradient name for "gradient" color mode */
  gradient?: GradientName;
  /** Show trend arrow after sparkline */
  showTrend?: boolean;
}

/**
 * Downsample data to fit a target width using averaging
 */
function downsample(data: number[], targetWidth: number): number[] {
  if (data.length <= targetWidth) return data;
  const bucketSize = data.length / targetWidth;
  const result: number[] = [];
  for (let i = 0; i < targetWidth; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += data[j]!;
    }
    result.push(sum / (end - start));
  }
  return result;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width,
  color = "trend",
  gradient = "EMERALD",
  showTrend = false,
}) => {
  if (data.length === 0) {
    return <Text color="#52525b">---</Text>;
  }

  const sampled = width ? downsample(data, width) : data;
  const trend = sparklineTrend(data);

  // Determine color
  let textColor: string;
  if (color === "trend") {
    textColor = trend === "up" ? "#22c55e" : trend === "down" ? "#ef4444" : "#a1a1aa";
  } else if (color === "gradient") {
    // Per-character gradient applied below
    textColor = "#22c55e";
  } else {
    textColor = color;
  }

  const trendArrow = trend === "up" ? " ↑" : trend === "down" ? " ↓" : " →";
  const trendColor = trend === "up" ? "#22c55e" : trend === "down" ? "#ef4444" : "#a1a1aa";

  if (color === "gradient") {
    // Render each bar with gradient color based on position
    const colors = GRADIENTS[gradient];
    const sparkChars = sparklineString(sampled);
    return (
      <>
        {[...sparkChars].map((char, i) => {
          const t = sparkChars.length <= 1 ? 0.5 : i / (sparkChars.length - 1);
          return (
            <Text key={i} color={getGradientColor(colors, t)}>
              {char}
            </Text>
          );
        })}
        {showTrend && (
          <Text color={trendColor} bold>
            {trendArrow}
          </Text>
        )}
      </>
    );
  }

  return (
    <>
      <Text color={textColor}>{sparklineString(sampled)}</Text>
      {showTrend && (
        <Text color={trendColor} bold>
          {trendArrow}
        </Text>
      )}
    </>
  );
};

export default Sparkline;

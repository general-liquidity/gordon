/**
 * GradientText Component
 * Renders text lines with color gradients — per-line vertical gradient.
 * Ink supports hex colors natively so we can do smooth transitions.
 *
 * Brand gradients:
 * - GORDON: dark green → bright green → gold (signature look)
 * - PROFIT: red → yellow → green (P&L heatmap)
 * - MARKET: dark blue → cyan → white (market data)
 * - MONO: dark grey → white (neutral emphasis)
 */

import React from "react";
import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Brand gradient palettes
// ---------------------------------------------------------------------------

export const GRADIENTS = {
  /** Signature Gordon gradient: deep green → bright green → gold */
  GORDON: ["#0a4a2a", "#166534", "#22c55e", "#4ade80", "#86efac", "#fbbf24", "#f59e0b"],
  /** P&L gradient: loss red → neutral → profit green */
  PROFIT: ["#ef4444", "#f97316", "#facc15", "#a3e635", "#22c55e"],
  /** Market data: deep blue → cyan → white */
  MARKET: ["#1e3a5f", "#2563eb", "#60a5fa", "#67e8f9", "#e0f2fe"],
  /** Neutral: dark → bright monochrome */
  MONO: ["#27272a", "#52525b", "#a1a1aa", "#d4d4d8", "#fafafa"],
  /** Gold: dark amber → bright gold */
  GOLD: ["#78350f", "#b45309", "#d97706", "#f59e0b", "#fbbf24", "#fde68a"],
  /** Emerald: dark → bright green */
  EMERALD: ["#052e16", "#14532d", "#166534", "#15803d", "#22c55e", "#4ade80", "#86efac"],
} as const;

export type GradientName = keyof typeof GRADIENTS;

// ---------------------------------------------------------------------------
// Interpolation helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Interpolate between gradient stops at position t (0-1) */
function interpolateGradient(colors: readonly string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (colors.length === 1) return colors[0]!;

  const segment = clamped * (colors.length - 1);
  const idx = Math.floor(segment);
  const frac = segment - idx;

  if (idx >= colors.length - 1) return colors[colors.length - 1]!;

  const [r1, g1, b1] = hexToRgb(colors[idx]!);
  const [r2, g2, b2] = hexToRgb(colors[idx + 1]!);

  return rgbToHex(
    r1 + (r2 - r1) * frac,
    g1 + (g2 - g1) * frac,
    b1 + (b2 - b1) * frac
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export interface GradientTextProps {
  /** Text content — can be multi-line string */
  children: string;
  /** Gradient color stops (hex array) or named gradient */
  gradient: readonly string[] | GradientName;
  /** Whether to apply gradient per-character (horizontal) or per-line (vertical) */
  direction?: "vertical" | "horizontal";
  /** Bold text */
  bold?: boolean;
}

/**
 * Renders text with a color gradient.
 * - Vertical: each line gets a color from the gradient
 * - Horizontal: each character in a line gets interpolated color
 */
export const GradientText: React.FC<GradientTextProps> = ({
  children,
  gradient,
  direction = "vertical",
  bold = false,
}) => {
  const colors = typeof gradient === "string" ? GRADIENTS[gradient] : gradient;
  const lines = children.split("\n");

  if (direction === "vertical") {
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => {
          const t = lines.length === 1 ? 0.5 : i / (lines.length - 1);
          const color = interpolateGradient(colors, t);
          return (
            <Text key={i} color={color} bold={bold}>
              {line}
            </Text>
          );
        })}
      </Box>
    );
  }

  // Horizontal: render each line with per-character coloring
  return (
    <Box flexDirection="column">
      {lines.map((line, lineIdx) => (
        <Box key={lineIdx}>
          {[...line].map((char, charIdx) => {
            const t = line.length <= 1 ? 0.5 : charIdx / (line.length - 1);
            const color = interpolateGradient(colors, t);
            return (
              <Text key={charIdx} color={color} bold={bold}>
                {char}
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
};

/**
 * Utility: get a color from a gradient at position t (0-1)
 * Useful for coloring individual values (e.g., P&L percentages)
 */
export function getGradientColor(
  gradient: readonly string[] | GradientName,
  t: number
): string {
  const colors = typeof gradient === "string" ? GRADIENTS[gradient] : gradient;
  return interpolateGradient(colors, t);
}

export default GradientText;

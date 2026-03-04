/**
 * HeatmapGrid Component
 * Color-coded heatmap grid showing top movers in a compact terminal layout.
 * Color intensity scales with price change magnitude — deeper red for losses,
 * deeper green for gains.
 *
 * Usage:
 *   <HeatmapGrid items={[{ symbol: "BTC", change: 5.2, price: 67000 }]} />
 *   <HeatmapGrid items={movers} columns={6} maxItems={30} title="Top Movers" />
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeatmapItem {
  /** Token/asset symbol (e.g. "BTC", "ETH") */
  symbol: string;
  /** Price change percentage */
  change: number;
  /** Current price (optional, displayed if provided) */
  price?: number;
  /** 24h volume (optional, used for volume-based sorting) */
  volume?: number;
}

export type HeatmapSortMode = "change" | "volume" | "none";

export interface HeatmapGridProps {
  /** Array of items to display in the heatmap */
  items: HeatmapItem[];
  /** Number of columns in the grid (default: 4) */
  columns?: number;
  /** Maximum number of items to display (default: 20) */
  maxItems?: number;
  /** Optional header title */
  title?: string;
  /** Sort mode — "change" sorts by absolute change (default), "volume" by volume, "none" preserves order */
  sort?: HeatmapSortMode;
  /** Cell width in characters (default: 16) */
  cellWidth?: number;
}

// ---------------------------------------------------------------------------
// Color mapping
// ---------------------------------------------------------------------------

/**
 * Map a price change percentage to a hex color.
 * Gradient steps:
 *   -10% or worse  → #7f1d1d  (very dark red)
 *   -5% to -10%    → #dc2626  (dark red)
 *   -2% to -5%     → #ef4444  (red)
 *   -0% to -2%     → #fca5a5  (light red)
 *   +0% to +2%     → #86efac  (light green)
 *   +2% to +5%     → #22c55e  (green)
 *   +5% to +10%    → #16a34a  (dark green)
 *   +10% or more   → #4ade80  (bright green)
 */
function getChangeColor(change: number): string {
  if (change <= -10) return "#7f1d1d";
  if (change <= -5) return "#dc2626";
  if (change <= -2) return "#ef4444";
  if (change < 0) return "#fca5a5";
  if (change === 0) return COLORS.SECONDARY;
  if (change <= 2) return "#86efac";
  if (change <= 5) return "#22c55e";
  if (change <= 10) return "#16a34a";
  return "#4ade80";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a change value as a signed percentage string.
 * Examples: "+5.20%", "-3.10%", "0.00%"
 */
function formatChange(change: number): string {
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

/**
 * Pad or truncate a string to fit a fixed width.
 */
function fitToWidth(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

/**
 * Sort items according to the specified mode.
 */
function sortItems(items: HeatmapItem[], mode: HeatmapSortMode): HeatmapItem[] {
  if (mode === "none") return items;

  return [...items].sort((a, b) => {
    if (mode === "volume") {
      return (b.volume ?? 0) - (a.volume ?? 0);
    }
    // Default: sort by absolute change (biggest movers first)
    return Math.abs(b.change) - Math.abs(a.change);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const HeatmapGrid: React.FC<HeatmapGridProps> = ({
  items,
  columns = 4,
  maxItems = 20,
  title,
  sort = "change",
  cellWidth = 16,
}) => {
  if (items.length === 0) {
    return (
      <Box>
        <Text color={COLORS.DIM}>No data available</Text>
      </Box>
    );
  }

  const sorted = sortItems(items, sort);
  const display = sorted.slice(0, maxItems);

  // Build rows from the flat list
  const rows: HeatmapItem[][] = [];
  for (let i = 0; i < display.length; i += columns) {
    rows.push(display.slice(i, i + columns));
  }

  // Inner width for the symbol + change text (minus 3 for padding/borders: "│ " + " │")
  const innerWidth = cellWidth - 3;

  return (
    <Box flexDirection="column">
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text color={COLORS.ACCENT_DIM} bold>
            {title}
          </Text>
        </Box>
      )}

      {/* Grid rows */}
      {rows.map((row, rowIdx) => (
        <Box key={rowIdx}>
          {row.map((item, colIdx) => {
            const color = getChangeColor(item.change);
            const changeStr = formatChange(item.change);
            // Truncate symbol to leave room for the change string + space
            const maxSymbolLen = Math.max(3, innerWidth - changeStr.length - 1);
            const sym = item.symbol.length > maxSymbolLen
              ? item.symbol.slice(0, maxSymbolLen)
              : item.symbol;
            const cellContent = `${sym} ${changeStr}`;
            const fitted = fitToWidth(cellContent, innerWidth);

            return (
              <Box key={colIdx}>
                <Text color={COLORS.DIM}>{"│ "}</Text>
                <Text color={color} bold={Math.abs(item.change) >= 5}>
                  {fitted}
                </Text>
                <Text color={COLORS.DIM}>{colIdx === row.length - 1 ? " │" : ""}</Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
};

export default HeatmapGrid;

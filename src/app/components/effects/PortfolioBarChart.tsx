/**
 * PortfolioBarChart Component
 * Horizontal bar chart for visualizing portfolio allocation in the terminal.
 * Each row renders: asset name, proportional bar (full-block chars), percentage, USD value.
 *
 * Usage:
 *   <PortfolioBarChart
 *     holdings={[
 *       { asset: "BTC", value: 47100, percentage: 45.2 },
 *       { asset: "ETH", value: 18300, percentage: 17.5 },
 *       { asset: "SOL", value: 9200, percentage: 8.8 },
 *     ]}
 *     title="Portfolio Allocation"
 *   />
 *
 * Bars scale proportionally to the largest holding. Colors cycle through
 * a predefined palette or can be set per-item.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../../theme.ts";

// ---------------------------------------------------------------------------
// Color palette — cycles through these for bar colors
// ---------------------------------------------------------------------------

const BAR_PALETTE = [
  "#22c55e",
  "#60a5fa",
  "#fbbf24",
  "#f97316",
  "#a78bfa",
  "#ec4899",
  "#14b8a6",
  "#f43e5e",
] as const;

// Full block character used for the horizontal bars
const BLOCK = "\u2588"; // █

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Holding {
  /** Ticker / asset name (e.g. "BTC", "ETH") */
  asset: string;
  /** USD value of the holding */
  value: number;
  /** Percentage of portfolio (auto-calculated when omitted) */
  percentage?: number;
  /** Hex color override for this item's bar */
  color?: string;
}

export interface PortfolioBarChartProps {
  /** Array of holdings to display */
  holdings: Holding[];
  /** Maximum number of rows to render (default: 10) */
  maxItems?: number;
  /** Override bar width in characters (default: auto from terminal width) */
  barWidth?: number;
  /** Show USD values column (default: true) */
  showValues?: boolean;
  /** Show percentage column (default: true) */
  showPercentages?: boolean;
  /** Optional title rendered above the chart */
  title?: string;
}

// ---------------------------------------------------------------------------
// Utility: format USD values for compact display
// ---------------------------------------------------------------------------

/**
 * Format a USD value into a compact human-readable string.
 *
 * Examples:
 *   0.42      -> "$0.42"
 *   850       -> "$850"
 *   1_200     -> "$1.2k"
 *   45_100    -> "$45.1k"
 *   1_200_000 -> "$1.2M"
 *   2_500_000_000 -> "$2.5B"
 */
export function formatUsdValue(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs >= 1_000_000_000) {
    const b = abs / 1_000_000_000;
    return `${sign}$${b % 1 === 0 ? b.toFixed(0) : b.toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  if (abs >= 1) {
    return `${sign}$${abs.toFixed(0)}`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute percentages from values when not supplied.
 */
function resolvePercentages(holdings: Holding[]): (Holding & { pct: number })[] {
  const total = holdings.reduce((sum, h) => sum + h.value, 0);
  return holdings.map((h) => ({
    ...h,
    pct: h.percentage ?? (total > 0 ? (h.value / total) * 100 : 0),
  }));
}

/**
 * Pick a bar color: use the item override, or cycle through the palette.
 */
function barColor(holding: Holding, index: number): string {
  return holding.color ?? BAR_PALETTE[index % BAR_PALETTE.length]!;
}

/**
 * Right-pad or truncate a string to a fixed width.
 */
function padEnd(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

/**
 * Left-pad a string to a fixed width.
 */
function padStart(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return " ".repeat(width - str.length) + str;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PortfolioBarChart: React.FC<PortfolioBarChartProps> = ({
  holdings,
  maxItems = 10,
  barWidth: barWidthOverride,
  showValues = true,
  showPercentages = true,
  title,
}) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  // Resolve & sort by value descending, limit to maxItems
  const resolved = resolvePercentages(holdings)
    .sort((a, b) => b.value - a.value)
    .slice(0, maxItems);

  if (resolved.length === 0) {
    return (
      <Box>
        <Text color={COLORS.DIM}>No holdings to display.</Text>
      </Box>
    );
  }

  // Column widths
  const assetColWidth = Math.max(
    4,
    Math.min(8, Math.max(...resolved.map((h) => h.asset.length)) + 1),
  );
  const pctColWidth = showPercentages ? 8 : 0; // " 45.2% "
  const valColWidth = showValues ? 10 : 0;     // " $47.1k "
  const gapChars = 2; // spaces between bar and label columns

  // Auto bar width: fill remaining terminal space
  const reservedWidth = assetColWidth + pctColWidth + valColWidth + gapChars;
  const availableBarWidth = Math.max(10, termWidth - reservedWidth - 2);
  const barWidth = barWidthOverride ?? availableBarWidth;

  // Scale bars relative to the largest percentage
  const maxPct = Math.max(...resolved.map((h) => h.pct), 1);

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text color={COLORS.ACCENT_DIM} bold>
            {title}
          </Text>
        </Box>
      )}

      {resolved.map((holding, idx) => {
        const barLen = Math.max(1, Math.round((holding.pct / maxPct) * barWidth));
        const bar = BLOCK.repeat(barLen);
        const color = barColor(holding, idx);

        return (
          <Box key={holding.asset + idx}>
            {/* Asset name */}
            <Text color={COLORS.WHITE}>
              {padEnd(holding.asset, assetColWidth)}
            </Text>

            {/* Bar */}
            <Text color={color}>{bar}</Text>
            <Text>{" ".repeat(Math.max(0, barWidth - barLen + 1))}</Text>

            {/* Percentage */}
            {showPercentages && (
              <Text color={COLORS.DIM}>
                {padStart(holding.pct.toFixed(1) + "%", pctColWidth)}
              </Text>
            )}

            {/* USD value */}
            {showValues && (
              <Text color={COLORS.SECONDARY}>
                {padStart(formatUsdValue(holding.value), valColWidth)}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export default PortfolioBarChart;

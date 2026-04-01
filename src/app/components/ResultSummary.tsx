/**
 * Result Summary Component
 * Unified data presentation for operation summaries
 *
 * Provides consistent output formatting for:
 * - Market scans
 * - Coin analysis
 * - Backtest results
 * - Portfolio views
 * - Strategy comparisons
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";
import { TicketCard } from "./desk/TicketCard.tsx";

// ============================================================================
// Types
// ============================================================================

/**
 * Summary data for any operation result
 */
export interface ResultSummary {
  /** Operation name (e.g., "Market Scan", "Analysis", "Backtest") */
  operation: string;
  /** Number of results found */
  found: number;
  /** Total items scanned (optional) */
  total?: number;
  /** Items filtered out (optional) */
  filtered?: number;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Top result highlight (optional) */
  topResult?: string;
  /** Additional context (optional) */
  context?: string;
}

export interface ResultSummaryProps {
  summary: ResultSummary;
  /** Show border around summary */
  bordered?: boolean;
  /** Title override */
  title?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format execution time in human-readable format
 */
export function formatExecutionTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format a number with appropriate precision
 */
export function formatNumber(value: number, decimals = 2): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "N/A";
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(decimals)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(decimals)}K`;
  }
  return value.toFixed(decimals);
}

/**
 * Format a percentage value with sign
 */
export function formatPercent(value: number, decimals = 2): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "N/A";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Format currency value
 */
export function formatCurrency(value: number, decimals = 2): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "N/A";
  }
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(decimals)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(decimals)}K`;
  }
  return `$${value.toFixed(decimals)}`;
}

/**
 * Get color based on value polarity
 */
export function getValueColor(value: number): string {
  if (value > 0) return COLORS.GREEN;
  if (value < 0) return COLORS.RED;
  return COLORS.WHITE;
}

// ============================================================================
// Component
// ============================================================================

/**
 * ResultSummary Component
 *
 * Displays a formatted summary box with operation results:
 * === SCAN RESULTS ===
 * Scanned: 500 coins | Found: 12 setups | Filtered: 488
 * Top Setup: BTC at $45,200 (89% confidence)
 * Execution: 8.3 seconds
 */
export const ResultSummaryBox: React.FC<ResultSummaryProps> = ({
  summary,
  bordered = true,
  title,
}) => {
  const { operation, found, total, filtered, executionTime, topResult, context } = summary;
  const displayTitle = title ?? `${operation.toUpperCase()} RESULTS`;

  const content = (
    <Box flexDirection="column" gap={1}>
      <TicketCard
        eyebrow="Summary"
        title={displayTitle}
        subtitle={`${formatExecutionTime(executionTime)} execution time`}
        tone={found > 0 ? "success" : "info"}
      >
        <Box gap={1}>
          {total !== undefined && (
            <>
              <Text color={COLORS.DIM}>Scanned:</Text>
              <Text color={COLORS.WHITE}>{total.toLocaleString()}</Text>
              <Text color={COLORS.DIM}>|</Text>
            </>
          )}
          <Text color={COLORS.DIM}>Found:</Text>
          <Text color={found > 0 ? COLORS.GREEN : COLORS.WHITE} bold>
            {found.toLocaleString()}
          </Text>
          {filtered !== undefined && (
            <>
              <Text color={COLORS.DIM}>|</Text>
              <Text color={COLORS.DIM}>Filtered:</Text>
              <Text color={COLORS.WHITE}>{filtered.toLocaleString()}</Text>
            </>
          )}
        </Box>

        {topResult && (
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>Top: </Text>
            <Text color={COLORS.HIGHLIGHT} bold>
              {topResult}
            </Text>
          </Box>
        )}

        {context && (
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>{context}</Text>
          </Box>
        )}
      </TicketCard>
    </Box>
  );

  if (bordered) {
    return (
      <Box marginY={1}>
        <DeskPanel eyebrow="Result" title={operation} subtitle="Operational output at a glance." tone="brand">
        {content}
        </DeskPanel>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      {content}
    </Box>
  );
};

// ============================================================================
// Timing Utilities
// ============================================================================

/**
 * Track operation timing
 */
export class OperationTimer {
  private startTime: number;
  private endTime: number | null = null;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Mark the operation as complete
   */
  stop(): number {
    this.endTime = Date.now();
    return this.elapsed();
  }

  /**
   * Get elapsed time in milliseconds
   */
  elapsed(): number {
    const end = this.endTime ?? Date.now();
    return end - this.startTime;
  }

  /**
   * Get formatted elapsed time string
   */
  formatted(): string {
    return formatExecutionTime(this.elapsed());
  }
}

/**
 * Create a timer and execute a function, returning result with timing
 */
export async function withTiming<T>(
  fn: () => Promise<T>
): Promise<{ result: T; executionTime: number }> {
  const timer = new OperationTimer();
  const result = await fn();
  return {
    result,
    executionTime: timer.stop(),
  };
}

/**
 * Synchronous version of withTiming
 */
export function withTimingSync<T>(
  fn: () => T
): { result: T; executionTime: number } {
  const timer = new OperationTimer();
  const result = fn();
  return {
    result,
    executionTime: timer.stop(),
  };
}

// ============================================================================
// Summary Builders
// ============================================================================

/**
 * Build a scan result summary
 */
export function buildScanSummary(
  coinsScanned: number,
  opportunitiesFound: number,
  executionTime: number,
  topSetup?: { symbol: string; price: number; confidence: number }
): ResultSummary {
  return {
    operation: "Market Scan",
    found: opportunitiesFound,
    total: coinsScanned,
    filtered: coinsScanned - opportunitiesFound,
    executionTime,
    topResult: topSetup
      ? `${topSetup.symbol} at ${formatCurrency(topSetup.price)} (${Math.round(topSetup.confidence * 100)}% confidence)`
      : undefined,
  };
}

/**
 * Build an analysis result summary
 */
export function buildAnalysisSummary(
  symbol: string,
  setupDetected: boolean,
  confidence: number,
  executionTime: number,
  trend?: string
): ResultSummary {
  return {
    operation: "Analysis",
    found: setupDetected ? 1 : 0,
    executionTime,
    topResult: setupDetected
      ? `Setup detected (${Math.round(confidence * 100)}% confidence)`
      : "No setup detected",
    context: trend ? `Trend: ${trend}` : undefined,
  };
}

/**
 * Build a backtest result summary
 */
export function buildBacktestSummary(
  strategyName: string,
  totalTrades: number,
  winRate: number,
  totalReturn: number,
  executionTime: number
): ResultSummary {
  return {
    operation: "Backtest",
    found: totalTrades,
    executionTime,
    topResult: `${strategyName}: ${formatPercent(totalReturn)} return, ${formatPercent(winRate * 100)} win rate`,
  };
}

/**
 * Build a portfolio summary
 */
export function buildPortfolioSummary(
  holdingsCount: number,
  totalValue: number,
  executionTime: number,
  topHolding?: { asset: string; value: number; allocation: number }
): ResultSummary {
  return {
    operation: "Portfolio",
    found: holdingsCount,
    executionTime,
    topResult: topHolding
      ? `${topHolding.asset}: ${formatCurrency(topHolding.value)} (${topHolding.allocation.toFixed(1)}%)`
      : `Total: ${formatCurrency(totalValue)}`,
  };
}

/**
 * Build a strategy comparison summary
 */
export function buildComparisonSummary(
  strategiesCompared: number,
  bestStrategy: string,
  bestReturn: number,
  executionTime: number
): ResultSummary {
  return {
    operation: "Strategy Comparison",
    found: strategiesCompared,
    executionTime,
    topResult: `Best: ${bestStrategy} (${formatPercent(bestReturn)})`,
  };
}

export default ResultSummaryBox;

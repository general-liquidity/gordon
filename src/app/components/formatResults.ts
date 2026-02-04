/**
 * Result Formatting Utilities
 * Text-based formatting for operation results
 *
 * These functions generate formatted text output for:
 * - Market scan results
 * - Coin analysis
 * - Backtest results
 * - Portfolio views
 * - Strategy comparisons
 *
 * Use these when React components aren't available (e.g., in tool outputs)
 */

import type { ResultSummary } from "./ResultSummary.tsx";
import { formatExecutionTime, formatCurrency, formatPercent, formatNumber } from "./ResultSummary.tsx";

// Re-export formatting helpers for convenience
export { formatExecutionTime, formatCurrency, formatPercent, formatNumber };

// ============================================================================
// Summary Formatting
// ============================================================================

/**
 * Format a ResultSummary as a text block
 */
export function formatResultSummary(summary: ResultSummary): string {
  const { operation, found, total, filtered, executionTime, topResult, context } = summary;
  const lines: string[] = [];

  lines.push(`=== ${operation.toUpperCase()} RESULTS ===`);

  // Stats line
  const statsParts: string[] = [];
  if (total !== undefined) {
    statsParts.push(`Scanned: ${total.toLocaleString()}`);
  }
  statsParts.push(`Found: ${found.toLocaleString()}`);
  if (filtered !== undefined) {
    statsParts.push(`Filtered: ${filtered.toLocaleString()}`);
  }
  lines.push(statsParts.join(" | "));

  // Top result
  if (topResult) {
    lines.push(`Top: ${topResult}`);
  }

  // Context
  if (context) {
    lines.push(context);
  }

  // Execution time
  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);

  return lines.join("\n");
}

// ============================================================================
// Scan Result Formatting
// ============================================================================

export interface ScanResultFormatOptions {
  coinsScanned: number;
  opportunities: Array<{
    symbol: string;
    price: number;
    change24h: number;
    setupConfidence: number;
    bias: string;
    risk: string;
  }>;
  executionTime: number;
  maxRows?: number;
}

/**
 * Format market scan results as a text table
 */
export function formatScanResults(options: ScanResultFormatOptions): string {
  const { coinsScanned, opportunities, executionTime, maxRows = 10 } = options;
  const lines: string[] = [];

  // Summary header
  lines.push("=== SCAN RESULTS ===");
  lines.push(`Scanned: ${coinsScanned} coins | Found: ${opportunities.length} setups | Filtered: ${coinsScanned - opportunities.length}`);

  if (opportunities.length > 0) {
    const topSetup = opportunities[0]!;
    lines.push(`Top Setup: ${topSetup.symbol} at ${formatCurrency(topSetup.price)} (${Math.round(topSetup.setupConfidence * 100)}% confidence)`);
  }

  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);
  lines.push("");

  // Table
  if (opportunities.length > 0) {
    lines.push("| Symbol     | Price       | 24h%     | Conf%  | Bias     | Risk   |");
    lines.push("|------------|-------------|----------|--------|----------|--------|");

    const displayOps = opportunities.slice(0, maxRows);
    for (const op of displayOps) {
      const symbol = op.symbol.padEnd(10);
      const price = formatCurrency(op.price).padStart(11);
      const change = formatPercent(op.change24h).padStart(8);
      const conf = `${Math.round(op.setupConfidence * 100)}%`.padStart(6);
      const bias = op.bias.padEnd(8);
      const risk = op.risk.padEnd(6);
      lines.push(`| ${symbol} | ${price} | ${change} | ${conf} | ${bias} | ${risk} |`);
    }

    if (opportunities.length > maxRows) {
      lines.push(`\n...and ${opportunities.length - maxRows} more opportunities`);
    }
  } else {
    lines.push("No opportunities detected.");
  }

  return lines.join("\n");
}

// ============================================================================
// Analysis Result Formatting
// ============================================================================

export interface AnalysisResultFormatOptions {
  symbol: string;
  price: number;
  trend: string;
  setupDetected: boolean;
  setupConfidence: number;
  indicators: {
    rsi: number | null;
    macdState?: string;
    volumeTrend?: string;
  };
  supports: Array<{ price: number; strength: number }>;
  resistances: Array<{ price: number; strength: number }>;
  executionTime: number;
}

/**
 * Format coin analysis results as text
 */
export function formatAnalysisResults(options: AnalysisResultFormatOptions): string {
  const {
    symbol,
    price,
    trend,
    setupDetected,
    setupConfidence,
    indicators,
    supports,
    resistances,
    executionTime,
  } = options;
  const lines: string[] = [];

  // Header
  lines.push(`=== ANALYSIS: ${symbol} ===`);
  lines.push(`Price: ${formatCurrency(price)} | Trend: ${trend}`);

  // Setup status
  if (setupDetected) {
    lines.push(`Setup: DETECTED (${Math.round(setupConfidence * 100)}% confidence)`);
  } else {
    lines.push("Setup: Not detected");
  }

  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);
  lines.push("");

  // Indicators
  lines.push("--- Indicators ---");
  if (indicators.rsi !== null) {
    const rsiStatus = indicators.rsi < 30 ? "(Oversold)" : indicators.rsi > 70 ? "(Overbought)" : "";
    lines.push(`RSI: ${indicators.rsi.toFixed(1)} ${rsiStatus}`);
  }
  if (indicators.macdState) {
    lines.push(`MACD: ${indicators.macdState}`);
  }
  if (indicators.volumeTrend) {
    lines.push(`Volume: ${indicators.volumeTrend}`);
  }
  lines.push("");

  // Support levels
  if (supports.length > 0) {
    lines.push("--- Support Levels ---");
    for (const level of supports.slice(0, 3)) {
      const strength = "=".repeat(Math.round(level.strength * 5));
      lines.push(`${formatCurrency(level.price)} [${strength}] ${Math.round(level.strength * 100)}%`);
    }
    lines.push("");
  }

  // Resistance levels
  if (resistances.length > 0) {
    lines.push("--- Resistance Levels ---");
    for (const level of resistances.slice(0, 3)) {
      const strength = "=".repeat(Math.round(level.strength * 5));
      lines.push(`${formatCurrency(level.price)} [${strength}] ${Math.round(level.strength * 100)}%`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Backtest Result Formatting
// ============================================================================

export interface BacktestResultFormatOptions {
  strategyName: string;
  symbol: string;
  timeframe: string;
  days: number;
  metrics: {
    totalReturn: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    profitFactor: number;
    totalTrades: number;
    averageWin: number;
    averageLoss: number;
    expectancy: number;
  };
  executionTime: number;
}

/**
 * Format backtest results as text
 */
export function formatBacktestResults(options: BacktestResultFormatOptions): string {
  const { strategyName, symbol, timeframe, days, metrics, executionTime } = options;
  const lines: string[] = [];

  // Header
  lines.push(`=== BACKTEST RESULTS ===`);
  lines.push(`Strategy: ${strategyName}`);
  lines.push(`${symbol} | ${timeframe} | ${days} days`);
  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);
  lines.push("");

  // Performance metrics table
  lines.push("| Metric           | Value        | Rating |");
  lines.push("|------------------|--------------|--------|");

  // Total Return
  const returnRating = metrics.totalReturn > 20 ? "[OK]" : metrics.totalReturn < 0 ? "[!]" : "";
  lines.push(`| Total Return     | ${formatPercent(metrics.totalReturn).padStart(12)} | ${returnRating.padEnd(6)} |`);

  // Win Rate
  const winRateRating = metrics.winRate > 0.5 ? "[OK]" : metrics.winRate < 0.35 ? "[!]" : "";
  lines.push(`| Win Rate         | ${formatPercent(metrics.winRate * 100).padStart(12)} | ${winRateRating.padEnd(6)} |`);

  // Sharpe Ratio
  const sharpeRating = metrics.sharpeRatio > 1.5 ? "[OK]" : metrics.sharpeRatio < 0.5 ? "[!]" : "";
  lines.push(`| Sharpe Ratio     | ${formatNumber(metrics.sharpeRatio).padStart(12)} | ${sharpeRating.padEnd(6)} |`);

  // Max Drawdown
  const ddRating = Math.abs(metrics.maxDrawdown) < 15 ? "[OK]" : Math.abs(metrics.maxDrawdown) > 30 ? "[!]" : "";
  lines.push(`| Max Drawdown     | ${formatPercent(-Math.abs(metrics.maxDrawdown)).padStart(12)} | ${ddRating.padEnd(6)} |`);

  // Profit Factor
  const pfRating = metrics.profitFactor > 1.5 ? "[OK]" : metrics.profitFactor < 1 ? "[!]" : "";
  lines.push(`| Profit Factor    | ${formatNumber(metrics.profitFactor).padStart(12)} | ${pfRating.padEnd(6)} |`);

  // Total Trades
  const tradesRating = metrics.totalTrades >= 30 ? "[OK]" : metrics.totalTrades < 10 ? "[!]" : "";
  lines.push(`| Total Trades     | ${metrics.totalTrades.toString().padStart(12)} | ${tradesRating.padEnd(6)} |`);

  lines.push("");
  lines.push("--- Trade Statistics ---");
  lines.push(`Average Win:  ${formatCurrency(metrics.averageWin)}`);
  lines.push(`Average Loss: ${formatCurrency(metrics.averageLoss)}`);
  lines.push(`Expectancy:   ${formatCurrency(metrics.expectancy)} per trade`);

  return lines.join("\n");
}

// ============================================================================
// Portfolio Formatting
// ============================================================================

export interface PortfolioFormatOptions {
  totalValue: number;
  availableCash: number;
  holdings: Array<{
    asset: string;
    total: number;
    usdValue: number;
    wallet?: string;
    note?: string;
  }>;
  executionTime: number;
  maxRows?: number;
}

/**
 * Format portfolio view as text
 */
export function formatPortfolioResults(options: PortfolioFormatOptions): string {
  const { totalValue, availableCash, holdings, executionTime, maxRows = 10 } = options;
  const lines: string[] = [];

  // Header
  lines.push("=== PORTFOLIO ===");
  lines.push(`Total Value: ${formatCurrency(totalValue)} | Cash: ${formatCurrency(availableCash)}`);
  lines.push(`Holdings: ${holdings.length} assets`);
  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);
  lines.push("");

  // Holdings table
  if (holdings.length > 0) {
    lines.push("| Asset    | Amount        | Value (USD)  | Alloc% | Wallet |");
    lines.push("|----------|---------------|--------------|--------|--------|");

    const displayHoldings = holdings.slice(0, maxRows);
    for (const h of displayHoldings) {
      const allocation = totalValue > 0 ? (h.usdValue / totalValue) * 100 : 0;
      const asset = h.asset.padEnd(8);
      const amount = formatNumber(h.total, 4).padStart(13);
      const value = (h.note ? h.note : formatCurrency(h.usdValue)).padStart(12);
      const alloc = `${allocation.toFixed(1)}%`.padStart(6);
      const wallet = (h.wallet ?? "-").padEnd(6);
      lines.push(`| ${asset} | ${amount} | ${value} | ${alloc} | ${wallet} |`);
    }

    if (holdings.length > maxRows) {
      lines.push(`\n...and ${holdings.length - maxRows} more assets`);
    }
  } else {
    lines.push("No holdings found.");
  }

  return lines.join("\n");
}

// ============================================================================
// Strategy Comparison Formatting
// ============================================================================

export interface ComparisonFormatOptions {
  symbol: string;
  timeframe: string;
  strategies: Array<{
    name: string;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
  }>;
  executionTime: number;
}

/**
 * Format strategy comparison as text
 */
export function formatComparisonResults(options: ComparisonFormatOptions): string {
  const { symbol, timeframe, strategies, executionTime } = options;
  const lines: string[] = [];

  // Sort by total return
  const sorted = [...strategies].sort((a, b) => b.totalReturn - a.totalReturn);
  const best = sorted[0];

  // Header
  lines.push("=== STRATEGY COMPARISON ===");
  lines.push(`${symbol} | ${timeframe}`);
  if (best) {
    lines.push(`Best: ${best.name} (${formatPercent(best.totalReturn)})`);
  }
  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);
  lines.push("");

  // Comparison table
  lines.push("| # | Strategy         | Return   | Sharpe | MaxDD    | WinRate | Trades |");
  lines.push("|---|------------------|----------|--------|----------|---------|--------|");

  sorted.forEach((s, index) => {
    const rank = `${index + 1}`.padStart(1);
    const name = s.name.slice(0, 16).padEnd(16);
    const ret = formatPercent(s.totalReturn).padStart(8);
    const sharpe = formatNumber(s.sharpeRatio).padStart(6);
    const dd = formatPercent(-Math.abs(s.maxDrawdown)).padStart(8);
    const winRate = formatPercent(s.winRate * 100).padStart(7);
    const trades = s.totalTrades.toString().padStart(6);
    const marker = index === 0 ? " [BEST]" : "";
    lines.push(`| ${rank} | ${name} | ${ret} | ${sharpe} | ${dd} | ${winRate} | ${trades} |${marker}`);
  });

  return lines.join("\n");
}

// ============================================================================
// Export all formatters
// ============================================================================

export default {
  formatResultSummary,
  formatScanResults,
  formatAnalysisResults,
  formatBacktestResults,
  formatPortfolioResults,
  formatComparisonResults,
};

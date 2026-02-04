/**
 * Standard Column Definitions
 * Predefined column sets for common data types in Gordon CLI
 *
 * These standardize table output across the application for:
 * - Market data (scan results)
 * - Portfolio holdings
 * - Backtest results
 * - Strategy comparisons
 */

import type { TableColumn } from "./RichTable.tsx";

// ============================================================================
// Market Data Columns
// ============================================================================

/**
 * Standard columns for market scan results
 * Columns: Symbol, Price, 24h%, Volume, Confidence, Bias, Risk
 */
export const MARKET_SCAN_COLUMNS: TableColumn[] = [
  { key: "symbol", header: "Symbol", type: "text", width: 12 },
  { key: "price", header: "Price", type: "currency", width: 12 },
  { key: "change24h", header: "24h%", type: "change", width: 10 },
  { key: "volume24h", header: "Volume", type: "currency", width: 12 },
  { key: "setupConfidence", header: "Conf%", type: "percent", width: 8 },
  { key: "bias", header: "Bias", type: "text", width: 10 },
  { key: "risk", header: "Risk", type: "text", width: 8 },
];

/**
 * Compact market scan columns (fewer columns for narrow terminals)
 */
export const MARKET_SCAN_COLUMNS_COMPACT: TableColumn[] = [
  { key: "symbol", header: "Symbol", type: "text", width: 10 },
  { key: "price", header: "Price", type: "currency", width: 10 },
  { key: "change24h", header: "24h%", type: "change", width: 8 },
  { key: "setupConfidence", header: "Conf", type: "percent", width: 6 },
  { key: "bias", header: "Bias", type: "text", width: 8 },
];

/**
 * Columns for trending tokens display
 */
export const TRENDING_COLUMNS: TableColumn[] = [
  { key: "symbol", header: "Symbol", type: "text", width: 12 },
  { key: "price", header: "Price", type: "currency", width: 12 },
  { key: "priceChangePercent", header: "24h%", type: "change", width: 10 },
  { key: "volume", header: "Volume", type: "currency", width: 14 },
  { key: "quoteVolume", header: "Quote Vol", type: "currency", width: 14 },
];

/**
 * Columns for coin analysis results
 */
export const ANALYSIS_COLUMNS: TableColumn[] = [
  { key: "metric", header: "Metric", type: "text", width: 18 },
  { key: "value", header: "Value", type: "text", width: 20 },
  { key: "signal", header: "Signal", type: "text", width: 12 },
];

// ============================================================================
// Portfolio Columns
// ============================================================================

/**
 * Standard portfolio holdings columns
 * Columns: Asset, Amount, Value(USD), Allocation%, Change%
 */
export const PORTFOLIO_COLUMNS: TableColumn[] = [
  { key: "asset", header: "Asset", type: "text", width: 10 },
  { key: "total", header: "Amount", type: "number", width: 14 },
  { key: "usdValue", header: "Value (USD)", type: "currency", width: 14 },
  { key: "allocation", header: "Alloc%", type: "percent", width: 10 },
  { key: "change24h", header: "24h%", type: "change", width: 10 },
];

/**
 * Compact portfolio columns
 */
export const PORTFOLIO_COLUMNS_COMPACT: TableColumn[] = [
  { key: "asset", header: "Asset", type: "text", width: 8 },
  { key: "total", header: "Amount", type: "number", width: 12 },
  { key: "usdValue", header: "USD", type: "currency", width: 12 },
  { key: "allocation", header: "Alloc%", type: "percent", width: 8 },
];

/**
 * Detailed portfolio columns with free/locked breakdown
 */
export const PORTFOLIO_COLUMNS_DETAILED: TableColumn[] = [
  { key: "asset", header: "Asset", type: "text", width: 10 },
  { key: "free", header: "Free", type: "number", width: 12 },
  { key: "locked", header: "Locked", type: "number", width: 12 },
  { key: "total", header: "Total", type: "number", width: 12 },
  { key: "usdValue", header: "Value (USD)", type: "currency", width: 14 },
  { key: "allocation", header: "Alloc%", type: "percent", width: 10 },
  { key: "wallet", header: "Wallet", type: "text", width: 8 },
];

// ============================================================================
// Backtest Columns
// ============================================================================

/**
 * Standard backtest result columns
 * Columns: Strategy, WinRate%, ProfitFactor, MaxDD%, Sharpe, Trades
 */
export const BACKTEST_COLUMNS: TableColumn[] = [
  { key: "strategyName", header: "Strategy", type: "text", width: 18 },
  { key: "totalReturn", header: "Return%", type: "change", width: 10 },
  { key: "winRate", header: "WinRate%", type: "percent", width: 10 },
  { key: "profitFactor", header: "PF", type: "number", width: 8 },
  { key: "maxDrawdown", header: "MaxDD%", type: "percent", width: 10 },
  { key: "sharpeRatio", header: "Sharpe", type: "number", width: 8 },
  { key: "totalTrades", header: "Trades", type: "number", width: 8 },
];

/**
 * Compact backtest columns
 */
export const BACKTEST_COLUMNS_COMPACT: TableColumn[] = [
  { key: "strategyName", header: "Strategy", type: "text", width: 16 },
  { key: "totalReturn", header: "Return", type: "change", width: 10 },
  { key: "winRate", header: "Win%", type: "percent", width: 8 },
  { key: "sharpeRatio", header: "Sharpe", type: "number", width: 8 },
  { key: "totalTrades", header: "Trades", type: "number", width: 8 },
];

/**
 * Detailed backtest metrics columns
 */
export const BACKTEST_METRICS_COLUMNS: TableColumn[] = [
  { key: "metric", header: "Metric", type: "text", width: 22 },
  { key: "value", header: "Value", type: "text", width: 16 },
  { key: "rating", header: "Rating", type: "text", width: 12 },
];

/**
 * Trade history columns for backtest
 */
export const BACKTEST_TRADES_COLUMNS: TableColumn[] = [
  { key: "entryTime", header: "Entry", type: "text", width: 12 },
  { key: "entryPrice", header: "Entry $", type: "currency", width: 12 },
  { key: "exitPrice", header: "Exit $", type: "currency", width: 12 },
  { key: "pnlPercent", header: "PnL%", type: "change", width: 10 },
  { key: "pnl", header: "PnL $", type: "currency", width: 12 },
  { key: "exitReason", header: "Reason", type: "text", width: 10 },
];

// ============================================================================
// Strategy Comparison Columns
// ============================================================================

/**
 * Strategy comparison columns
 */
export const STRATEGY_COMPARISON_COLUMNS: TableColumn[] = [
  { key: "rank", header: "#", type: "number", width: 4 },
  { key: "strategyName", header: "Strategy", type: "text", width: 18 },
  { key: "totalReturn", header: "Return", type: "change", width: 10 },
  { key: "sharpeRatio", header: "Sharpe", type: "number", width: 8 },
  { key: "maxDrawdown", header: "MaxDD", type: "percent", width: 10 },
  { key: "winRate", header: "WinRate", type: "percent", width: 10 },
  { key: "totalTrades", header: "Trades", type: "number", width: 8 },
];

/**
 * Strategy list columns
 */
export const STRATEGY_LIST_COLUMNS: TableColumn[] = [
  { key: "id", header: "ID", type: "text", width: 20 },
  { key: "name", header: "Name", type: "text", width: 24 },
  { key: "tier", header: "Tier", type: "number", width: 6 },
  { key: "description", header: "Description", type: "text", width: 40 },
];

// ============================================================================
// Order & Position Columns
// ============================================================================

/**
 * Open orders columns
 */
export const ORDERS_COLUMNS: TableColumn[] = [
  { key: "symbol", header: "Symbol", type: "text", width: 12 },
  { key: "side", header: "Side", type: "text", width: 6 },
  { key: "type", header: "Type", type: "text", width: 10 },
  { key: "price", header: "Price", type: "currency", width: 12 },
  { key: "quantity", header: "Qty", type: "number", width: 12 },
  { key: "status", header: "Status", type: "text", width: 10 },
  { key: "time", header: "Time", type: "text", width: 12 },
];

/**
 * Positions columns
 */
export const POSITIONS_COLUMNS: TableColumn[] = [
  { key: "symbol", header: "Symbol", type: "text", width: 12 },
  { key: "side", header: "Side", type: "text", width: 6 },
  { key: "entryPrice", header: "Entry", type: "currency", width: 12 },
  { key: "currentPrice", header: "Current", type: "currency", width: 12 },
  { key: "quantity", header: "Qty", type: "number", width: 12 },
  { key: "pnl", header: "PnL", type: "currency", width: 12 },
  { key: "pnlPercent", header: "PnL%", type: "change", width: 10 },
];

/**
 * Trade history columns
 */
export const TRADE_HISTORY_COLUMNS: TableColumn[] = [
  { key: "symbol", header: "Symbol", type: "text", width: 12 },
  { key: "side", header: "Side", type: "text", width: 6 },
  { key: "price", header: "Price", type: "currency", width: 12 },
  { key: "quantity", header: "Qty", type: "number", width: 12 },
  { key: "quoteQty", header: "Value", type: "currency", width: 12 },
  { key: "commission", header: "Fee", type: "currency", width: 10 },
  { key: "time", header: "Time", type: "text", width: 12 },
];

// ============================================================================
// Earn/Staking Columns
// ============================================================================

/**
 * Earn positions columns
 */
export const EARN_COLUMNS: TableColumn[] = [
  { key: "asset", header: "Asset", type: "text", width: 10 },
  { key: "amount", header: "Amount", type: "number", width: 14 },
  { key: "apy", header: "APY%", type: "percent", width: 10 },
  { key: "type", header: "Type", type: "text", width: 12 },
  { key: "status", header: "Status", type: "text", width: 10 },
  { key: "redeemable", header: "Redeemable", type: "text", width: 12 },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get appropriate column set based on terminal width
 */
export function getResponsiveColumns(
  fullColumns: TableColumn[],
  compactColumns: TableColumn[],
  terminalWidth: number
): TableColumn[] {
  // Calculate total width needed for full columns
  const fullWidth = fullColumns.reduce((sum, col) => sum + (col.width ?? 12), 0);

  // Use compact columns if terminal is too narrow
  if (terminalWidth < fullWidth + 10) {
    return compactColumns;
  }
  return fullColumns;
}

/**
 * Add calculated allocation column to portfolio data
 */
export function addAllocationColumn(
  holdings: Array<{ usdValue: number; [key: string]: unknown }>,
  totalValue: number
): Array<{ allocation: number; [key: string]: unknown }> {
  return holdings.map((holding) => ({
    ...holding,
    allocation: totalValue > 0 ? (holding.usdValue / totalValue) * 100 : 0,
  }));
}

/**
 * Transform scan confidence to percentage for display
 */
export function transformScanDataForDisplay(
  scanResults: Array<{ setupConfidence: number; [key: string]: unknown }>
): Array<{ setupConfidence: number; [key: string]: unknown }> {
  return scanResults.map((result) => ({
    ...result,
    setupConfidence: result.setupConfidence * 100,
  }));
}

/**
 * Transform backtest metrics for display (multiply win rate by 100)
 */
export function transformBacktestDataForDisplay(
  results: Array<{ winRate: number; maxDrawdown: number; [key: string]: unknown }>
): Array<{ winRate: number; maxDrawdown: number; [key: string]: unknown }> {
  return results.map((result) => ({
    ...result,
    winRate: result.winRate * 100,
    maxDrawdown: Math.abs(result.maxDrawdown),
  }));
}

export default {
  MARKET_SCAN_COLUMNS,
  MARKET_SCAN_COLUMNS_COMPACT,
  TRENDING_COLUMNS,
  ANALYSIS_COLUMNS,
  PORTFOLIO_COLUMNS,
  PORTFOLIO_COLUMNS_COMPACT,
  PORTFOLIO_COLUMNS_DETAILED,
  BACKTEST_COLUMNS,
  BACKTEST_COLUMNS_COMPACT,
  BACKTEST_METRICS_COLUMNS,
  BACKTEST_TRADES_COLUMNS,
  STRATEGY_COMPARISON_COLUMNS,
  STRATEGY_LIST_COLUMNS,
  ORDERS_COLUMNS,
  POSITIONS_COLUMNS,
  TRADE_HISTORY_COLUMNS,
  EARN_COLUMNS,
};

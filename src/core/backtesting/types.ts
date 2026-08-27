/**
 * Playbook Backtest Types
 *
 * Type definitions for backtesting playbooks against historical data.
 * Uses Zod schemas for runtime validation.
 */

import { z } from "zod";

// ============================================================================
// Backtest Configuration
// ============================================================================

export const PlaybookBacktestConfigSchema = z.object({
  /** Which playbook to test (by ID) */
  playbook_name: z.string(),
  /** Trading pair, e.g., "BTCUSDT" */
  symbol: z.string(),
  /** Candle timeframe: "1h", "4h", "1d" */
  timeframe: z.string(),
  /** Backtest period start (ISO datetime) */
  start_date: z.string(),
  /** Backtest period end (ISO datetime) */
  end_date: z.string(),
  /** Starting capital in quote currency */
  initial_capital: z.number().default(10000),
  /** Trading fee per side as percentage */
  fee_percent: z.number().default(0.1),
  /** Slippage per side as percentage */
  slippage_percent: z.number().default(0.05),
});
export type PlaybookBacktestConfig = z.infer<typeof PlaybookBacktestConfigSchema>;

// ============================================================================
// Backtest Trade
// ============================================================================

export const PlaybookBacktestTradeSchema = z.object({
  entry_time: z.string(),
  entry_price: z.number(),
  exit_time: z.string(),
  exit_price: z.number(),
  side: z.enum(["long", "short"]),
  size: z.number(),
  pnl: z.number(),
  pnl_percent: z.number(),
  fees: z.number(),
  exit_reason: z.enum([
    "stop_loss",
    "take_profit",
    "trailing_stop",
    "time_stop",
    "signal_exit",
    "end_of_data",
  ]),
  duration_hours: z.number(),
  max_favorable: z.number(),
  max_adverse: z.number(),
});
export type PlaybookBacktestTrade = z.infer<typeof PlaybookBacktestTradeSchema>;

// ============================================================================
// Backtest Result
// ============================================================================

export const PlaybookBacktestResultSchema = z.object({
  config: PlaybookBacktestConfigSchema,
  playbook_name: z.string(),

  // Summary stats
  total_trades: z.number(),
  winning_trades: z.number(),
  losing_trades: z.number(),
  win_rate: z.number(),

  // Returns
  total_return_percent: z.number(),
  annualized_return_percent: z.number(),
  profit_factor: z.number(),

  // Risk metrics
  max_drawdown_percent: z.number(),
  sharpe_ratio: z.number(),
  sortino_ratio: z.number(),
  calmar_ratio: z.number(),

  // Trade stats
  avg_win_percent: z.number(),
  avg_loss_percent: z.number(),
  avg_hold_duration_hours: z.number(),
  largest_win_percent: z.number(),
  largest_loss_percent: z.number(),
  max_consecutive_wins: z.number(),
  max_consecutive_losses: z.number(),

  // Equity curve (sampled)
  equity_curve: z.array(
    z.object({
      timestamp: z.string(),
      equity: z.number(),
      drawdown_percent: z.number(),
    }),
  ),

  // Individual trades
  trades: z.array(PlaybookBacktestTradeSchema),

  // Metadata
  ran_at: z.string(),
  duration_ms: z.number(),
});
export type PlaybookBacktestResult = z.infer<typeof PlaybookBacktestResultSchema>;

// ============================================================================
// Candle Type (local)
// ============================================================================

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

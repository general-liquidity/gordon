/**
 * Playbook Backtest Result Formatter
 *
 * Formats PlaybookBacktestResult into readable markdown text for agent output.
 * Provides summary, trade list, equity curve, and comparison views.
 */

import type { PlaybookBacktestResult, PlaybookBacktestTrade } from "./types.ts";

// ============================================================================
// Summary Formatter
// ============================================================================

/**
 * Format a full summary of a single backtest result.
 */
export function formatBacktestSummary(result: PlaybookBacktestResult): string {
  const lines: string[] = [];

  lines.push(`## Backtest: ${result.playbook_name}`);
  lines.push("");
  lines.push(`**Symbol:** ${result.config.symbol} | **Timeframe:** ${result.config.timeframe}`);
  lines.push(
    `**Period:** ${formatDate(result.config.start_date)} to ${formatDate(result.config.end_date)}`
  );
  lines.push(
    `**Capital:** $${result.config.initial_capital.toLocaleString()} | **Fees:** ${result.config.fee_percent}% | **Slippage:** ${result.config.slippage_percent}%`
  );
  lines.push("");

  // Performance
  lines.push("### Performance");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Return | ${sign(result.total_return_percent)}% |`);
  lines.push(`| Annualized Return | ${sign(result.annualized_return_percent)}% |`);
  lines.push(`| Profit Factor | ${result.profit_factor} |`);
  lines.push(`| Sharpe Ratio | ${result.sharpe_ratio} |`);
  lines.push(`| Sortino Ratio | ${result.sortino_ratio} |`);
  lines.push(`| Calmar Ratio | ${result.calmar_ratio} |`);
  lines.push(`| Max Drawdown | ${result.max_drawdown_percent}% |`);
  lines.push("");

  // Trade Stats
  lines.push("### Trade Statistics");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Trades | ${result.total_trades} |`);
  lines.push(`| Win Rate | ${result.win_rate}% (${result.winning_trades}W / ${result.losing_trades}L) |`);
  lines.push(`| Avg Win | ${sign(result.avg_win_percent)}% |`);
  lines.push(`| Avg Loss | ${sign(result.avg_loss_percent)}% |`);
  lines.push(`| Largest Win | ${sign(result.largest_win_percent)}% |`);
  lines.push(`| Largest Loss | ${sign(result.largest_loss_percent)}% |`);
  lines.push(`| Avg Hold Duration | ${formatDuration(result.avg_hold_duration_hours)} |`);
  lines.push(`| Max Consecutive Wins | ${result.max_consecutive_wins} |`);
  lines.push(`| Max Consecutive Losses | ${result.max_consecutive_losses} |`);
  lines.push("");

  // Warnings
  const warnings = generateWarnings(result);
  if (warnings.length > 0) {
    lines.push("### Warnings");
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  lines.push(`*Ran at ${formatDate(result.ran_at)} in ${result.duration_ms}ms*`);

  return lines.join("\n");
}

// ============================================================================
// Trade List Formatter
// ============================================================================

/**
 * Format the trade list as a markdown table.
 * Shows at most `maxTrades` trades.
 */
export function formatTradeList(
  trades: PlaybookBacktestTrade[],
  maxTrades: number = 20
): string {
  if (trades.length === 0) {
    return "No trades executed.";
  }

  const lines: string[] = [];
  lines.push("### Trade List");
  lines.push("");
  lines.push("| # | Side | Entry | Exit | PnL % | Exit Reason | Duration |");
  lines.push("|---|------|-------|------|-------|-------------|----------|");

  const show = trades.slice(0, maxTrades);
  for (let i = 0; i < show.length; i++) {
    const t = show[i]!;
    lines.push(
      `| ${i + 1} | ${t.side.toUpperCase()} | $${t.entry_price} | $${t.exit_price} | ${sign(t.pnl_percent)}% | ${formatExitReason(t.exit_reason)} | ${formatDuration(t.duration_hours)} |`
    );
  }

  if (trades.length > maxTrades) {
    lines.push(`| ... | *${trades.length - maxTrades} more trades omitted* | | | | | |`);
  }

  return lines.join("\n");
}

// ============================================================================
// Equity Curve Formatter
// ============================================================================

/**
 * Format equity curve as a simplified ASCII sparkline.
 * Shows sampled equity values.
 */
export function formatEquityCurve(
  equityCurve: PlaybookBacktestResult["equity_curve"],
  width: number = 40
): string {
  if (equityCurve.length === 0) {
    return "No equity curve data.";
  }

  const lines: string[] = [];
  lines.push("### Equity Curve");
  lines.push("");

  const equities = equityCurve.map((p) => p.equity);
  const min = Math.min(...equities);
  const max = Math.max(...equities);
  const range = max - min || 1;

  // Sample down to width points
  const step = Math.max(1, Math.floor(equityCurve.length / width));
  const sampled: number[] = [];
  for (let i = 0; i < equityCurve.length; i += step) {
    sampled.push(equities[i]!);
  }
  // Ensure last point is included
  if (sampled[sampled.length - 1] !== equities[equities.length - 1]) {
    sampled.push(equities[equities.length - 1]!);
  }

  // Build sparkline
  const chars = " ▁▂▃▄▅▆▇█";
  const sparkline = sampled
    .map((v) => {
      const normalized = (v - min) / range;
      const idx = Math.min(Math.floor(normalized * (chars.length - 1)), chars.length - 1);
      return chars[idx];
    })
    .join("");

  lines.push(`\`${sparkline}\``);
  lines.push(
    `Low: $${min.toLocaleString(undefined, { maximumFractionDigits: 2 })} | High: $${max.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  );
  lines.push(
    `Start: ${formatDate(equityCurve[0]!.timestamp)} | End: ${formatDate(equityCurve[equityCurve.length - 1]!.timestamp)}`
  );

  return lines.join("\n");
}

// ============================================================================
// Comparison Formatter
// ============================================================================

/**
 * Format a comparison of multiple backtest results side by side.
 */
export function formatBacktestComparison(results: PlaybookBacktestResult[]): string {
  if (results.length === 0) {
    return "No results to compare.";
  }
  if (results.length === 1) {
    return formatBacktestSummary(results[0]!);
  }

  const lines: string[] = [];
  lines.push("## Playbook Backtest Comparison");
  lines.push("");

  // Header row
  const headers = ["Metric", ...results.map((r) => r.playbook_name)];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "------").join(" | ")} |`);

  // Data rows
  const metrics: [string, (r: PlaybookBacktestResult) => string][] = [
    ["Symbol", (r) => r.config.symbol],
    ["Timeframe", (r) => r.config.timeframe],
    ["Total Return", (r) => `${sign(r.total_return_percent)}%`],
    ["Annual Return", (r) => `${sign(r.annualized_return_percent)}%`],
    ["Sharpe Ratio", (r) => String(r.sharpe_ratio)],
    ["Sortino Ratio", (r) => String(r.sortino_ratio)],
    ["Max Drawdown", (r) => `${r.max_drawdown_percent}%`],
    ["Win Rate", (r) => `${r.win_rate}%`],
    ["Profit Factor", (r) => String(r.profit_factor)],
    ["Total Trades", (r) => String(r.total_trades)],
    ["Avg Win", (r) => `${sign(r.avg_win_percent)}%`],
    ["Avg Loss", (r) => `${sign(r.avg_loss_percent)}%`],
    ["Avg Hold", (r) => formatDuration(r.avg_hold_duration_hours)],
  ];

  for (const [label, getter] of metrics) {
    const row = [label, ...results.map(getter)];
    lines.push(`| ${row.join(" | ")} |`);
  }

  lines.push("");

  // Determine winner
  const best = results.reduce((a, b) =>
    a.sharpe_ratio > b.sharpe_ratio ? a : b
  );
  lines.push(
    `**Best by Sharpe Ratio:** ${best.playbook_name} (${best.sharpe_ratio})`
  );

  return lines.join("\n");
}

// ============================================================================
// Helpers
// ============================================================================

function sign(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

function formatExitReason(reason: string): string {
  const map: Record<string, string> = {
    stop_loss: "Stop Loss",
    take_profit: "Take Profit",
    trailing_stop: "Trail Stop",
    time_stop: "Time Stop",
    signal_exit: "Signal Exit",
    end_of_data: "End of Data",
  };
  return map[reason] ?? reason;
}

function generateWarnings(result: PlaybookBacktestResult): string[] {
  const warnings: string[] = [];

  if (result.total_trades < 10) {
    warnings.push(
      `Low trade count (${result.total_trades}). Results may not be statistically significant.`
    );
  }

  if (result.max_drawdown_percent > 25) {
    warnings.push(
      `High max drawdown (${result.max_drawdown_percent}%). Consider tighter risk management.`
    );
  }

  if (result.profit_factor > 0 && result.profit_factor < 1) {
    warnings.push(
      `Profit factor below 1 (${result.profit_factor}). Strategy is unprofitable.`
    );
  }

  if (result.win_rate < 30) {
    warnings.push(
      `Low win rate (${result.win_rate}%). Ensure reward/risk ratio compensates.`
    );
  }

  if (result.max_consecutive_losses >= 5) {
    warnings.push(
      `${result.max_consecutive_losses} consecutive losses recorded. Watch for psychological impact.`
    );
  }

  const periodDays =
    (new Date(result.config.end_date).getTime() -
      new Date(result.config.start_date).getTime()) /
    (1000 * 60 * 60 * 24);
  if (periodDays < 30) {
    warnings.push(
      `Short backtest period (${Math.round(periodDays)} days). Results may not be representative.`
    );
  }

  return warnings;
}

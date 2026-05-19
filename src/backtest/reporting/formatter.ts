/**
 * Backtest Result Formatter
 *
 * Formats backtest results, optimization results, and comparison results
 * into human-readable markdown tables for display.
 */

import { assessBacktestCredibility } from "../../infra/trading/ops/backtestCredibility.ts";
import {
  isVolatilityDragEnabled,
  geometricFromArithmetic,
  volatilityDrag,
} from "../../infra/trading/ops/volatilityDrag.ts";
import {
  isHurstExponentEnabled,
  calculateHurst,
} from "../../infra/trading/ops/hurstExponent.ts";
import {
  isPerformanceDecompositionEnabled,
  decomposeReturns,
} from "../../infra/trading/ops/performanceDecomposition.ts";
import {
  isEdgeDecayEnabled,
  evaluateDecay,
} from "../../infra/trading/ops/edgeDecayMonitor.ts";
import {
  isOperatorEquationEnabled,
  evaluateOperatorEquation,
} from "../../infra/trading/ops/operatorEquation.ts";
import {
  isEmpiricalKellyEnabled,
  empiricalKelly,
} from "../../infra/trading/quant/empiricalKelly.ts";
import {
  isBacktestTaxEnabled,
  applyBacktestTax,
  expectedRAfterTax,
} from "../../infra/trading/ops/backtestTax.ts";
import type {
  BacktestResult,
  OptimizationResult,
  ComparisonResult,
  BacktestMetrics,
  ParameterSet,
} from "../types.ts";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a number with specified decimal places
 */
function formatNumber(value: number, decimals = 2): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "N/A";
  }
  return value.toFixed(decimals);
}

/**
 * Format a percentage value
 */
function formatPercent(value: number, decimals = 2): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "N/A";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Format a currency value
 */
function formatCurrency(value: number, decimals = 2): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "N/A";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toFixed(decimals)}`;
}

/**
 * Format duration in hours to human readable string
 */
function formatDuration(hours: number): string {
  if (hours === undefined || hours === null || isNaN(hours)) {
    return "N/A";
  }
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

/**
 * Get risk level indicator based on metrics
 */
function getRiskLevel(metrics: BacktestMetrics): "LOW" | "MEDIUM" | "HIGH" | "EXTREME" {
  const { maxDrawdown, sharpeRatio, winRate } = metrics;

  // High drawdown or low sharpe = high risk
  if (maxDrawdown > 30 || sharpeRatio < 0) {
    return "EXTREME";
  }
  if (maxDrawdown > 20 || sharpeRatio < 0.5) {
    return "HIGH";
  }
  if (maxDrawdown > 10 || sharpeRatio < 1 || winRate < 0.4) {
    return "MEDIUM";
  }
  return "LOW";
}

/**
 * Get color indicator for a metric value
 */
function getMetricIndicator(value: number, thresholds: { good: number; bad: number }, higherIsBetter = true): string {
  if (value === undefined || value === null || isNaN(value)) {
    return "";
  }
  if (higherIsBetter) {
    if (value >= thresholds.good) return " [OK]";
    if (value <= thresholds.bad) return " [!]";
  } else {
    if (value <= thresholds.good) return " [OK]";
    if (value >= thresholds.bad) return " [!]";
  }
  return "";
}

// ============================================================================
// Format Backtest Result
// ============================================================================

/**
 * Format a backtest result into a markdown-formatted string
 *
 * @param result - The backtest result to format
 * @returns Markdown-formatted string with:
 *   - Strategy name, symbol, timeframe, period
 *   - Key metrics table
 *   - Trade summary
 *   - Risk warnings if applicable
 */
export function formatBacktestResult(result: BacktestResult): string {
  const { config, metrics, trades, startDate, endDate, executionTime, warnings } = result;
  const lines: string[] = [];

  // Header
  lines.push(`## Backtest Results: ${result.strategyName}`);
  lines.push("");

  // Configuration Summary
  lines.push("### Configuration");
  lines.push(`| Parameter | Value |`);
  lines.push(`|-----------|-------|`);
  lines.push(`| Symbol | ${config.symbol} |`);
  lines.push(`| Timeframe | ${config.timeframe} |`);
  lines.push(`| Period | ${startDate} to ${endDate} (${config.days} days) |`);
  lines.push(`| Initial Capital | $${formatNumber(config.initialCapital)} |`);
  lines.push(`| Position Size | ${config.positionSizePercent}% |`);
  lines.push(`| Fees | ${config.feePercent}% |`);
  lines.push(`| Slippage | ${config.slippagePercent}% |`);
  lines.push("");

  // Key Performance Metrics
  lines.push("### Performance Metrics");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Return | ${formatPercent(metrics.totalReturn)}${getMetricIndicator(metrics.totalReturn, { good: 10, bad: 0 })} |`);
  lines.push(`| Net Profit | ${formatCurrency(metrics.netProfit)} |`);
  lines.push(`| Final Equity | $${formatNumber(metrics.finalValue)} |`);
  lines.push(`| CAGR | ${formatPercent(metrics.cagr)} |`);
  lines.push(`| Max Drawdown | ${formatPercent(Math.abs(metrics.maxDrawdown) * -1)}${getMetricIndicator(metrics.maxDrawdown, { good: 10, bad: 25 }, false)} |`);
  lines.push(`| Sharpe Ratio | ${formatNumber(metrics.sharpeRatio)}${getMetricIndicator(metrics.sharpeRatio, { good: 1.5, bad: 0.5 })} |`);
  lines.push(`| Sortino Ratio | ${formatNumber(metrics.sortinoRatio)} |`);
  lines.push(`| Calmar Ratio | ${formatNumber(metrics.calmarRatio)} |`);
  lines.push(`| Volatility | ${formatPercent(metrics.volatility)} |`);
  lines.push("");

  // Trade Statistics
  lines.push("### Trade Statistics");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Trades | ${metrics.totalTrades} |`);
  lines.push(`| Win Rate | ${formatPercent(metrics.winRate * 100)}${getMetricIndicator(metrics.winRate * 100, { good: 50, bad: 35 })} |`);
  lines.push(`| Winning Trades | ${metrics.winningTrades} |`);
  lines.push(`| Losing Trades | ${metrics.losingTrades} |`);
  lines.push(`| Profit Factor | ${formatNumber(metrics.profitFactor)}${getMetricIndicator(metrics.profitFactor, { good: 1.5, bad: 1 })} |`);
  lines.push(`| Average Trade | ${formatCurrency(metrics.averageTrade)} |`);
  lines.push(`| Average Win | ${formatCurrency(metrics.averageWin)} |`);
  lines.push(`| Average Loss | ${formatCurrency(metrics.averageLoss)} |`);
  lines.push(`| Expectancy | ${formatCurrency(metrics.expectancy)} |`);
  lines.push(`| Avg Duration | ${formatDuration(metrics.avgTradeDuration)} |`);
  lines.push(`| Max Consecutive Wins | ${metrics.maxConsecutiveWins} |`);
  lines.push(`| Max Consecutive Losses | ${metrics.maxConsecutiveLosses}${getMetricIndicator(metrics.maxConsecutiveLosses, { good: 3, bad: 7 }, false)} |`);
  lines.push(`| Total Fees | ${formatCurrency(metrics.totalFees * -1)} |`);
  lines.push("");

  // Risk Assessment
  const riskLevel = getRiskLevel(metrics);
  lines.push("### Risk Assessment");
  lines.push(`**Risk Level: ${riskLevel}**`);
  lines.push("");

  if (riskLevel === "HIGH" || riskLevel === "EXTREME") {
    lines.push("> **Warning:** This strategy shows elevated risk characteristics.");
    if (metrics.maxDrawdown > 20) {
      lines.push(`> - Maximum drawdown of ${formatPercent(metrics.maxDrawdown)} exceeds safe threshold`);
    }
    if (metrics.sharpeRatio < 0.5) {
      lines.push(`> - Sharpe ratio of ${formatNumber(metrics.sharpeRatio)} indicates poor risk-adjusted returns`);
    }
    if (metrics.maxConsecutiveLosses > 6) {
      lines.push(`> - ${metrics.maxConsecutiveLosses} consecutive losses could deplete capital quickly`);
    }
    lines.push("");
  }

  // Trade Summary (last 5 trades)
  if (trades.length > 0) {
    lines.push("### Recent Trades");
    lines.push(`| Entry Time | Entry Price | Exit Price | PnL | Exit Reason |`);
    lines.push(`|------------|-------------|------------|-----|-------------|`);
    const recentTrades = trades.slice(-5);
    for (const trade of recentTrades) {
      lines.push(
        `| ${trade.entryTime.slice(0, 10)} | $${formatNumber(trade.entryPrice)} | $${formatNumber(trade.exitPrice)} | ${formatPercent(trade.pnlPercent)} | ${trade.exitReason} |`
      );
    }
    lines.push("");
  }

  // Warnings
  if (warnings.length > 0) {
    lines.push("### Warnings");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  // Footer
  lines.push(`---`);
  lines.push(`*Backtest completed in ${executionTime}ms*`);

  return lines.join("\n");
}

// ============================================================================
// Format Optimization Result
// ============================================================================

/**
 * Format an optimization result into a markdown-formatted string
 *
 * @param result - The optimization result to format
 * @returns Markdown-formatted string with:
 *   - Best parameters found
 *   - Top 5 parameter combinations
 *   - Performance comparison
 */
export function formatOptimizationResult(result: OptimizationResult): string {
  const { strategyId, symbol, timeframe, bestParameters, bestMetrics, topCombinations, totalCombinations, executionTime } = result;
  const lines: string[] = [];

  // Header
  lines.push(`## Optimization Results: ${strategyId}`);
  lines.push("");
  lines.push(`Tested ${totalCombinations} parameter combinations on ${symbol} (${timeframe})`);
  lines.push("");

  // Best Parameters
  lines.push("### Best Parameters");
  lines.push(`| Parameter | Value |`);
  lines.push(`|-----------|-------|`);
  for (const [param, value] of Object.entries(bestParameters)) {
    lines.push(`| ${param} | ${formatNumber(value, 4)} |`);
  }
  lines.push("");

  // Best Metrics
  lines.push("### Best Performance");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Return | ${formatPercent(bestMetrics.totalReturn)} |`);
  lines.push(`| Sharpe Ratio | ${formatNumber(bestMetrics.sharpeRatio)} |`);
  lines.push(`| Max Drawdown | ${formatPercent(bestMetrics.maxDrawdown * -1)} |`);
  lines.push(`| Win Rate | ${formatPercent(bestMetrics.winRate * 100)} |`);
  lines.push(`| Profit Factor | ${formatNumber(bestMetrics.profitFactor)} |`);
  lines.push(`| Total Trades | ${bestMetrics.totalTrades} |`);
  lines.push("");

  // Top 5 Combinations
  lines.push("### Top 5 Parameter Combinations");

  // Build header row with parameter names
  const paramNames = Object.keys(bestParameters);
  const headerRow = ["Rank", ...paramNames, "Return", "Sharpe", "Win Rate"].join(" | ");
  const separatorRow = ["----", ...paramNames.map(() => "------"), "------", "------", "--------"].join(" | ");

  lines.push(`| ${headerRow} |`);
  lines.push(`| ${separatorRow} |`);

  const top5 = topCombinations.slice(0, 5);
  for (const combo of top5) {
    const paramValues = paramNames.map((name) => formatNumber(combo.parameters[name] ?? 0, 2));
    const row = [
      `#${combo.rank}`,
      ...paramValues,
      formatPercent(combo.metrics.totalReturn),
      formatNumber(combo.metrics.sharpeRatio),
      formatPercent(combo.metrics.winRate * 100),
    ].join(" | ");
    lines.push(`| ${row} |`);
  }
  lines.push("");

  // Recommendations
  lines.push("### Recommendations");
  lines.push("");
  lines.push("Before using these optimized parameters:");
  lines.push("1. **Validate on out-of-sample data** - Test on data not used in optimization");
  lines.push("2. **Check for overfitting** - Large parameter deviations from defaults may overfit");
  lines.push("3. **Forward test** - Paper trade with these settings before going live");
  lines.push("");

  // Footer
  lines.push(`---`);
  lines.push(`*Optimization completed in ${(executionTime / 1000).toFixed(1)}s*`);

  return lines.join("\n");
}

// ============================================================================
// Format Comparison Result
// ============================================================================

/**
 * Format a comparison result into a markdown-formatted string
 *
 * @param result - The comparison result to format
 * @returns Markdown-formatted string with:
 *   - Comparison table with each strategy as a row
 *   - Metrics as columns
 *   - Highlighted best performer
 */
export function formatComparisonResult(result: ComparisonResult): string {
  const { symbol, timeframe, period, results, rankings, bestOverall } = result;
  const lines: string[] = [];

  // Header
  lines.push(`## Strategy Comparison: ${symbol}`);
  lines.push("");
  lines.push(`Period: ${period.startDate} to ${period.endDate} | Timeframe: ${timeframe}`);
  lines.push("");

  // Main Comparison Table
  lines.push("### Performance Comparison");
  lines.push("| Strategy | Return | Sharpe | Max DD | Win Rate | Trades | Profit Factor |");
  lines.push("|----------|--------|--------|--------|----------|--------|---------------|");

  for (const backtest of results) {
    const m = backtest.metrics;
    const isBest = backtest.config.strategyId === bestOverall;
    const prefix = isBest ? "**" : "";
    const suffix = isBest ? "** [BEST]" : "";

    lines.push(
      `| ${prefix}${backtest.strategyName}${suffix} | ${formatPercent(m.totalReturn)} | ${formatNumber(m.sharpeRatio)} | ${formatPercent(m.maxDrawdown * -1)} | ${formatPercent(m.winRate * 100)} | ${m.totalTrades} | ${formatNumber(m.profitFactor)} |`
    );
  }
  lines.push("");

  // Rankings by metric
  lines.push("### Rankings");
  lines.push("");

  // By Return
  lines.push("**By Total Return:**");
  for (const rank of rankings.byReturn) {
    lines.push(`${rank.rank}. ${rank.strategyName}: ${formatPercent(rank.value)}`);
  }
  lines.push("");

  // By Sharpe
  lines.push("**By Sharpe Ratio:**");
  for (const rank of rankings.bySharpe) {
    lines.push(`${rank.rank}. ${rank.strategyName}: ${formatNumber(rank.value)}`);
  }
  lines.push("");

  // By Win Rate
  lines.push("**By Win Rate:**");
  for (const rank of rankings.byWinRate) {
    lines.push(`${rank.rank}. ${rank.strategyName}: ${formatPercent(rank.value * 100)}`);
  }
  lines.push("");

  // By Drawdown (lower is better)
  lines.push("**By Max Drawdown (lower is better):**");
  for (const rank of rankings.byDrawdown) {
    lines.push(`${rank.rank}. ${rank.strategyName}: ${formatPercent(rank.value * -1)}`);
  }
  lines.push("");

  // Best Overall
  const bestResult = results.find((r) => r.config.strategyId === bestOverall);
  if (bestResult) {
    lines.push("### Recommendation");
    lines.push("");
    lines.push(`**${bestResult.strategyName}** is the best overall performer based on a balanced score of:`);
    lines.push(`- Return: ${formatPercent(bestResult.metrics.totalReturn)}`);
    lines.push(`- Sharpe: ${formatNumber(bestResult.metrics.sharpeRatio)}`);
    lines.push(`- Max DD: ${formatPercent(bestResult.metrics.maxDrawdown * -1)}`);
    lines.push(`- Win Rate: ${formatPercent(bestResult.metrics.winRate * 100)}`);
    lines.push("");
  }

  // Footer
  lines.push(`---`);
  lines.push(`*Comparison generated at ${result.createdAt}*`);

  return lines.join("\n");
}

// ============================================================================
// Format Parameters (utility)
// ============================================================================

/**
 * Format a parameter set into a readable string
 *
 * @param params - The parameter set to format
 * @returns Formatted string representation
 */
export function formatParameters(params: ParameterSet): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${formatNumber(value, 4)}`)
    .join(", ");
}

// ============================================================================
// Format Quick Summary
// ============================================================================

/**
 * Format a quick one-line summary of backtest results
 *
 * @param result - The backtest result to summarize
 * @returns One-line summary string
 */
export function formatBacktestSummary(result: BacktestResult): string {
  const { metrics, config } = result;
  const base = `${result.strategyName} on ${config.symbol} (${config.timeframe}): ${formatPercent(metrics.totalReturn)} return, ${formatPercent(metrics.winRate * 100)} win rate, Sharpe ${formatNumber(metrics.sharpeRatio)}, Max DD ${formatPercent(metrics.maxDrawdown * -1)}`;

  // Surface backtest credibility (PSR / DSR / minTRL) when at least
  // a handful of trades exist. Sharpe alone is the leaderboard number;
  // PSR + DSR are the "is this real?" answer.
  let extra = "";
  try {
    if (result.trades && result.trades.length >= 10) {
      const returns: number[] = result.trades.map((t) => {
        if (t.entryPrice <= 0) return 0;
        const raw = (t.exitPrice - t.entryPrice) / t.entryPrice;
        return t.side === "LONG" ? raw : -raw;
      });
      const credibility = assessBacktestCredibility(returns, 1, 365);
      const psr = `${(credibility.psr * 100).toFixed(0)}% ${credibility.psrSignificant ? "✓" : "✗"}`;
      const dsr = `${(credibility.deflatedSharpe * 100).toFixed(0)}% ${credibility.dsrSignificant ? "✓" : "✗"}`;
      const verdict = credibility.credible ? "credible" : "NOT credible";
      extra += `\n  Credibility: PSR ${psr}, DSR ${dsr}, ${verdict}`;

      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance =
        returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / returns.length;
      const sigma = Math.sqrt(variance);

      if (isVolatilityDragEnabled()) {
        const periodsPerYear = 365;
        const arith = mean * periodsPerYear;
        const annualizedSigma = sigma * Math.sqrt(periodsPerYear);
        const drag = volatilityDrag(annualizedSigma);
        const geo = geometricFromArithmetic(arith, annualizedSigma);
        extra += `\n  Drag: arith ${(arith * 100).toFixed(1)}% → geo ${(geo * 100).toFixed(1)}% (σ=${(annualizedSigma * 100).toFixed(1)}%, drag ${(drag * 100).toFixed(1)}%)`;
      }

      if (isHurstExponentEnabled() && returns.length >= 64) {
        const h = calculateHurst(returns);
        extra += `\n  Hurst: ${h.hurst.toFixed(3)} → ${h.regime}${h.reliable ? "" : " (low confidence)"}`;
      }

      if (isPerformanceDecompositionEnabled()) {
        const marketReturn = Number(process.env.GORDON_BENCHMARK_RETURN ?? "NaN");
        const marketBeta = Number(process.env.GORDON_PORTFOLIO_BETA ?? "NaN");
        if (Number.isFinite(marketReturn) && Number.isFinite(marketBeta)) {
          const d = decomposeReturns({
            totalReturn: metrics.totalReturn / 100,
            marketReturn,
            marketBeta,
            factors: [],
          });
          extra += `\n  Decomposition: beta ${(d.betaContribution * 100).toFixed(1)}% + factors ${(d.factorTotal * 100).toFixed(1)}% + alpha ${(d.alpha * 100).toFixed(1)}% → ${d.verdict}`;
        }
      }

      if (isEdgeDecayEnabled() && returns.length >= 60) {
        const rMultiples = returns.map((r) => r / Math.max(sigma, 1e-6));
        const decay = evaluateDecay({ setupId: result.strategyName, rMultiples });
        extra += `\n  Edge decay: recent ${decay.recentExpectancy.toFixed(2)}R vs baseline ${decay.baselineExpectancy.toFixed(2)}R → ${decay.state}`;
      }

      if (isOperatorEquationEnabled()) {
        const evR = mean / Math.max(sigma, 1e-6);
        const exposure = Number(process.env.GORDON_BASE_RISK_PCT ?? 0.01);
        const frictionR = Number(process.env.GORDON_FRICTION_R ?? 0.001);
        const r = evaluateOperatorEquation({
          expectedValueR: evR,
          optimalExposureFraction: exposure,
          frictionR,
        });
        extra += `\n  Operator equation: EV ${r.expectedValueR.toFixed(2)}R × exp ${(r.optimalExposureFraction * 100).toFixed(2)}% − fric ${r.frictionR.toFixed(3)}R = ${r.performanceR.toFixed(4)}R (${r.failureMode})`;
      }

      if (isBacktestTaxEnabled() && metrics.totalTrades > 0) {
        const wins = metrics.winningTrades;
        const losses = metrics.losingTrades;
        const winRate = wins / Math.max(wins + losses, 1);
        const payoff = metrics.averageWin > 0 && metrics.averageLoss !== 0
          ? metrics.averageWin / Math.abs(metrics.averageLoss)
          : 0;
        if (winRate > 0 && payoff > 0) {
          const taxed = applyBacktestTax({ stats: { winRate, payoffRatio: payoff } });
          const evAfter = expectedRAfterTax(taxed);
          extra += `\n  Backtest tax: win ${(taxed.rawWinRate * 100).toFixed(1)}%→${(taxed.winRate * 100).toFixed(1)}%, payoff ${taxed.rawPayoffRatio.toFixed(2)}→${taxed.payoffRatio.toFixed(2)}, taxed EV ${evAfter.toFixed(3)}R`;
        }
      }

      if (isEmpiricalKellyEnabled() && metrics.totalTrades >= 10) {
        const wins = metrics.winningTrades;
        const losses = metrics.losingTrades;
        const winRate = wins / Math.max(wins + losses, 1);
        const payoff = metrics.averageWin > 0 && metrics.averageLoss !== 0
          ? metrics.averageWin / Math.abs(metrics.averageLoss)
          : 0;
        if (winRate > 0 && payoff > 0) {
          const ek = empiricalKelly({
            winRate,
            payoffRatio: payoff,
            historicalReturns: returns,
            bootstrapSamples: Math.min(5000, returns.length * 100),
          });
          extra += `\n  Empirical Kelly: f_kelly ${(ek.fKelly * 100).toFixed(2)}% → f_empirical ${(ek.fEmpirical * 100).toFixed(2)}% (CV ${Number.isFinite(ek.cvEdge) ? ek.cvEdge.toFixed(2) : "∞"}, uncertainty ${ek.edgeUncertainty})`;
        }
      }
    }
  } catch {
    // credibility / drag helpers can throw on degenerate input — never break the summary
  }

  return extra ? `${base}${extra}` : base;
}

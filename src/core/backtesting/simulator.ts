/**
 * Playbook Backtest Simulator
 *
 * Core backtest loop that runs a playbook's rules against historical candle data.
 * Handles position sizing, entry/exit execution, fee/slippage modeling,
 * equity curve tracking, and final metric calculation.
 */

import type { Playbook } from "../playbooks/types.ts";
import type {
  PlaybookBacktestConfig,
  PlaybookBacktestResult,
  PlaybookBacktestTrade,
  Candle,
} from "./types.ts";
import { PlaybookRuleEngine } from "./rule-engine.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("playbook-simulator");

// ============================================================================
// Position State
// ============================================================================

interface OpenPosition {
  entry_price: number;
  entry_time: number;
  side: "long" | "short";
  size: number;
  highest_since_entry: number;
  lowest_since_entry: number;
  /** Max favorable excursion (%) */
  max_favorable: number;
  /** Max adverse excursion (%) */
  max_adverse: number;
}

// ============================================================================
// BacktestSimulator
// ============================================================================

export class BacktestSimulator {
  /**
   * Run a playbook backtest against historical candle data.
   *
   * @param config - Backtest configuration (capital, fees, dates, etc.)
   * @param candles - Historical OHLCV candle data sorted by timestamp ascending
   * @param playbook - The parsed Playbook to test
   * @returns Complete backtest result with trades, metrics, and equity curve
   */
  run(
    config: PlaybookBacktestConfig,
    candles: Candle[],
    playbook: Playbook,
  ): PlaybookBacktestResult {
    const startMs = Date.now();

    if (candles.length < 60) {
      logger.warn("Insufficient candle data for meaningful backtest", {
        count: String(candles.length),
      });
      return this.emptyResult(config, playbook, startMs);
    }

    const engine = new PlaybookRuleEngine(playbook);
    const riskPercent = engine.getRiskPercent();
    const stopPercent = engine.getStopLossPercent();
    const feeRate = config.fee_percent / 100;
    const slippageRate = config.slippage_percent / 100;

    let capital = config.initial_capital;
    let position: OpenPosition | null = null;
    const trades: PlaybookBacktestTrade[] = [];
    const equityCurve: { timestamp: string; equity: number; drawdown_percent: number }[] = [];

    let peakEquity = capital;
    let sampleCounter = 0;
    const sampleInterval = Math.max(1, Math.floor(candles.length / 200));

    // ========================================================================
    // Main Loop
    // ========================================================================

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i]!;

      // Track equity curve at intervals
      sampleCounter++;
      if (sampleCounter >= sampleInterval || i === 0 || i === candles.length - 1) {
        sampleCounter = 0;
        const currentEquity = this.markToMarket(capital, position, candle);
        if (currentEquity > peakEquity) peakEquity = currentEquity;
        const dd = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
        equityCurve.push({
          timestamp: new Date(candle.timestamp).toISOString(),
          equity: round2(currentEquity),
          drawdown_percent: round2(dd),
        });
      }

      // Update position tracking
      if (position) {
        if (candle.high > position.highest_since_entry) {
          position.highest_since_entry = candle.high;
        }
        if (candle.low < position.lowest_since_entry) {
          position.lowest_since_entry = candle.low;
        }
        // MFE/MAE
        if (position.side === "long") {
          const favPct = ((candle.high - position.entry_price) / position.entry_price) * 100;
          const advPct = ((position.entry_price - candle.low) / position.entry_price) * 100;
          if (favPct > position.max_favorable) position.max_favorable = favPct;
          if (advPct > position.max_adverse) position.max_adverse = advPct;
        } else {
          const favPct = ((position.entry_price - candle.low) / position.entry_price) * 100;
          const advPct = ((candle.high - position.entry_price) / position.entry_price) * 100;
          if (favPct > position.max_favorable) position.max_favorable = favPct;
          if (advPct > position.max_adverse) position.max_adverse = advPct;
        }
      }

      // Check exit first (before entry, to avoid same-bar entry+exit on new positions)
      if (position) {
        const exitSignal = engine.checkExit(candles, i, {
          entry_price: position.entry_price,
          side: position.side,
          entry_time: position.entry_time,
          highest_since_entry: position.highest_since_entry,
          lowest_since_entry: position.lowest_since_entry,
        });

        if (exitSignal.triggered) {
          const trade = this.closeTrade(position, candle, exitSignal.reason, feeRate, slippageRate);
          capital += trade.pnl - trade.fees;
          trades.push(trade);
          position = null;
        }
      }

      // Check entry (only if flat)
      if (!position && i < candles.length - 1) {
        const entrySignal = engine.checkEntry(candles, i);
        if (entrySignal.triggered) {
          position = this.openTrade(
            candle,
            entrySignal.side,
            capital,
            riskPercent,
            stopPercent,
            feeRate,
            slippageRate,
          );
        }
      }
    }

    // Close open position at end of data
    if (position && candles.length > 0) {
      const lastCandle = candles[candles.length - 1]!;
      const trade = this.closeTrade(position, lastCandle, "end_of_data", feeRate, slippageRate);
      capital += trade.pnl - trade.fees;
      trades.push(trade);
    }

    // ========================================================================
    // Calculate Metrics
    // ========================================================================

    return this.buildResult(config, playbook, capital, trades, equityCurve, startMs);
  }

  // ============================================================================
  // Position Management
  // ============================================================================

  private openTrade(
    candle: Candle,
    side: "long" | "short",
    capital: number,
    riskPercent: number,
    stopPercent: number,
    _feeRate: number,
    slippageRate: number,
  ): OpenPosition {
    // Risk-based position sizing: risk X% of capital
    const riskAmount = capital * (riskPercent / 100);
    const stopDistance = candle.close * (stopPercent / 100);
    const rawSize = stopDistance > 0 ? riskAmount / stopDistance : 0;
    // Apply slippage to entry
    const slippage = candle.close * slippageRate;
    const entryPrice = side === "long" ? candle.close + slippage : candle.close - slippage;
    // Cap size to available capital (no leverage)
    const maxSize = capital / entryPrice;
    const size = Math.min(rawSize, maxSize * 0.95); // Leave 5% buffer for fees

    return {
      entry_price: entryPrice,
      entry_time: candle.timestamp,
      side,
      size: Math.max(0, size),
      highest_since_entry: candle.high,
      lowest_since_entry: candle.low,
      max_favorable: 0,
      max_adverse: 0,
    };
  }

  private closeTrade(
    position: OpenPosition,
    candle: Candle,
    exitReason: PlaybookBacktestTrade["exit_reason"],
    feeRate: number,
    slippageRate: number,
  ): PlaybookBacktestTrade {
    // Apply slippage to exit
    const slippage = candle.close * slippageRate;
    const exitPrice = position.side === "long" ? candle.close - slippage : candle.close + slippage;

    // Calculate PnL
    let rawPnl: number;
    if (position.side === "long") {
      rawPnl = (exitPrice - position.entry_price) * position.size;
    } else {
      rawPnl = (position.entry_price - exitPrice) * position.size;
    }

    // Calculate fees (entry + exit)
    const entryNotional = position.entry_price * position.size;
    const exitNotional = exitPrice * position.size;
    const totalFees = (entryNotional + exitNotional) * feeRate;

    const netPnl = rawPnl - totalFees;
    const pnlPercent = entryNotional > 0 ? (netPnl / entryNotional) * 100 : 0;

    const durationMs = candle.timestamp - position.entry_time;
    const durationHours = durationMs / (1000 * 60 * 60);

    return {
      entry_time: new Date(position.entry_time).toISOString(),
      entry_price: round4(position.entry_price),
      exit_time: new Date(candle.timestamp).toISOString(),
      exit_price: round4(exitPrice),
      side: position.side,
      size: round6(position.size),
      pnl: round2(netPnl),
      pnl_percent: round2(pnlPercent),
      fees: round2(totalFees),
      exit_reason: exitReason,
      duration_hours: round2(durationHours),
      max_favorable: round2(position.max_favorable),
      max_adverse: round2(position.max_adverse),
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private markToMarket(capital: number, position: OpenPosition | null, candle: Candle): number {
    if (!position) return capital;
    if (position.side === "long") {
      return capital + (candle.close - position.entry_price) * position.size;
    } else {
      return capital + (position.entry_price - candle.close) * position.size;
    }
  }

  private buildResult(
    config: PlaybookBacktestConfig,
    playbook: Playbook,
    finalCapital: number,
    trades: PlaybookBacktestTrade[],
    equityCurve: { timestamp: string; equity: number; drawdown_percent: number }[],
    startMs: number,
  ): PlaybookBacktestResult {
    const initial = config.initial_capital;
    const totalReturn = initial > 0 ? ((finalCapital - initial) / initial) * 100 : 0;

    // Duration in days
    const startDate = new Date(config.start_date).getTime();
    const endDate = new Date(config.end_date).getTime();
    const days = Math.max(1, (endDate - startDate) / (1000 * 60 * 60 * 24));
    const years = days / 365;

    // Annualized return
    const annualized =
      years > 0 && totalReturn > -100 ? ((1 + totalReturn / 100) ** (1 / years) - 1) * 100 : 0;

    // Trade classification
    const winningTrades = trades.filter((t) => t.pnl > 0);
    const losingTrades = trades.filter((t) => t.pnl <= 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

    // Profit factor
    const grossProfit = winningTrades.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Max drawdown
    const maxDrawdown =
      equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.drawdown_percent)) : 0;

    // Daily returns for Sharpe/Sortino
    const dailyReturns = this.computeDailyReturns(equityCurve);
    const sharpe = this.computeSharpe(dailyReturns);
    const sortino = this.computeSortino(dailyReturns);
    const calmar = maxDrawdown > 0 ? annualized / maxDrawdown : 0;

    // Trade stats
    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((s, t) => s + t.pnl_percent, 0) / winningTrades.length
        : 0;
    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((s, t) => s + t.pnl_percent, 0) / losingTrades.length
        : 0;
    const avgHold =
      trades.length > 0 ? trades.reduce((s, t) => s + t.duration_hours, 0) / trades.length : 0;
    const largestWin =
      winningTrades.length > 0 ? Math.max(...winningTrades.map((t) => t.pnl_percent)) : 0;
    const largestLoss =
      losingTrades.length > 0 ? Math.min(...losingTrades.map((t) => t.pnl_percent)) : 0;

    // Consecutive streaks
    const { maxWins, maxLosses } = this.computeStreaks(trades);

    return {
      config,
      playbook_name: playbook.name,
      total_trades: trades.length,
      winning_trades: winningTrades.length,
      losing_trades: losingTrades.length,
      win_rate: round2(winRate),
      total_return_percent: round2(totalReturn),
      annualized_return_percent: round2(annualized),
      profit_factor: round2(Number.isFinite(profitFactor) ? profitFactor : 0),
      max_drawdown_percent: round2(maxDrawdown),
      sharpe_ratio: round2(Number.isFinite(sharpe) ? sharpe : 0),
      sortino_ratio: round2(Number.isFinite(sortino) ? sortino : 0),
      calmar_ratio: round2(Number.isFinite(calmar) ? calmar : 0),
      avg_win_percent: round2(avgWin),
      avg_loss_percent: round2(avgLoss),
      avg_hold_duration_hours: round2(avgHold),
      largest_win_percent: round2(largestWin),
      largest_loss_percent: round2(largestLoss),
      max_consecutive_wins: maxWins,
      max_consecutive_losses: maxLosses,
      equity_curve: equityCurve,
      trades,
      ran_at: new Date().toISOString(),
      duration_ms: Date.now() - startMs,
    };
  }

  private computeDailyReturns(
    equityCurve: { timestamp: string; equity: number; drawdown_percent: number }[],
  ): number[] {
    if (equityCurve.length < 2) return [];
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1]!.equity;
      const curr = equityCurve[i]!.equity;
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }
    return returns;
  }

  private computeSharpe(returns: number[], riskFreeRate: number = 0.02): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const annMean = mean * 365;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const annVol = Math.sqrt(variance) * Math.sqrt(365);
    if (annVol === 0) return 0;
    return (annMean - riskFreeRate) / annVol;
  }

  private computeSortino(returns: number[], riskFreeRate: number = 0.02): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const annMean = mean * 365;
    const negatives = returns.filter((r) => r < 0);
    if (negatives.length === 0) return annMean > riskFreeRate ? 100 : 0;
    const downsideVariance = negatives.reduce((s, r) => s + r * r, 0) / returns.length;
    const annDownside = Math.sqrt(downsideVariance) * Math.sqrt(365);
    if (annDownside === 0) return 0;
    return (annMean - riskFreeRate) / annDownside;
  }

  private computeStreaks(trades: PlaybookBacktestTrade[]): { maxWins: number; maxLosses: number } {
    let maxWins = 0;
    let maxLosses = 0;
    let curWins = 0;
    let curLosses = 0;
    for (const t of trades) {
      if (t.pnl > 0) {
        curWins++;
        curLosses = 0;
        if (curWins > maxWins) maxWins = curWins;
      } else {
        curLosses++;
        curWins = 0;
        if (curLosses > maxLosses) maxLosses = curLosses;
      }
    }
    return { maxWins, maxLosses };
  }

  private emptyResult(
    config: PlaybookBacktestConfig,
    playbook: Playbook,
    startMs: number,
  ): PlaybookBacktestResult {
    return {
      config,
      playbook_name: playbook.name,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      win_rate: 0,
      total_return_percent: 0,
      annualized_return_percent: 0,
      profit_factor: 0,
      max_drawdown_percent: 0,
      sharpe_ratio: 0,
      sortino_ratio: 0,
      calmar_ratio: 0,
      avg_win_percent: 0,
      avg_loss_percent: 0,
      avg_hold_duration_hours: 0,
      largest_win_percent: 0,
      largest_loss_percent: 0,
      max_consecutive_wins: 0,
      max_consecutive_losses: 0,
      equity_curve: [],
      trades: [],
      ran_at: new Date().toISOString(),
      duration_ms: Date.now() - startMs,
    };
  }
}

// ============================================================================
// Rounding Helpers
// ============================================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}

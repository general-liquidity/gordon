/**
 * Backtest Engine
 *
 * Core backtesting engine that runs strategies against historical OHLC data.
 * Handles position management, commission/slippage, and equity tracking.
 */

import type { Strategy } from "../strategies/types.ts";
import type {
  OHLC,
  Signal,
  IndicatorState,
  BacktestParams,
  BacktestEngineResult,
  Position,
  Trade,
  EquityPointExtended,
  BacktestMetrics,
  ParameterSet,
} from "./types.ts";
import { DEFAULT_BACKTEST_PARAMS } from "./types.ts";
import { calculateMetricsFromTrades } from "./metrics.ts";
import { walkBookFill } from "./fill-model.ts";
import type { BookFill, BookFillConfig, FillRecord } from "./fill-model.ts";

// Import indicator calculation functions
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateBollingerBands,
  calculateATR,
  calculateMACD,
} from "../core/indicators/index.ts";
import type { Candle } from "../core/indicators/types.ts";

// ============================================================================
// Indicator Arrays Interface
// ============================================================================

interface IndicatorArrays {
  sma20: (number | null)[];
  sma50: (number | null)[];
  sma200: (number | null)[];
  ema9: (number | null)[];
  ema21: (number | null)[];
  rsi14: (number | null)[];
  bbUpper: (number | null)[];
  bbMiddle: (number | null)[];
  bbLower: (number | null)[];
  bbWidth: (number | null)[];
  atr14: (number | null)[];
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  macdHistogram: (number | null)[];
}

// ============================================================================
// Backtest Strategy Adapter
// ============================================================================

/**
 * Where a protective order triggers, and where it fills once slippage is
 * charged. Every arm moves the same direction: against the position.
 *
 *   stop:  triggers EARLY, the bar only has to come within slippage of it,
 *          and fills BEYOND it (a worse price than the stop asked for)
 *   TP:    triggers LATE, the bar has to trade THROUGH it by slippage, and
 *          fills SHORT of it (a worse price than the limit asked for)
 *
 * Split out of four inline expressions because the sign convention is the
 * entire content of the calculation, and inline it was inverted on both
 * take-profit arms: a long TP triggered at `limit * (1 - slippage)`, below
 * the limit, then filled at `limit * (1 + slippage)`, above it. A limit exit
 * that both fires early and fills better than its own limit is free money on
 * both legs, and the comment above it claimed the opposite behaviour.
 */
export function protectiveOrderPrices(
  side: "LONG" | "SHORT",
  limitPrice: number,
  slippage: number,
): { triggerPrice: number; fillPrice: number } {
  // Longs are hurt by lower prices, shorts by higher ones.
  const adverse = side === "LONG" ? -1 : 1;
  // The fill always lands on the adverse side of the limit. The trigger
  // always lands on the favourable side, and one sign covers both kinds: for
  // a long, a stop firing early and a TP firing late are both "the trigger
  // sits above the limit"; for a short, both sit below it. Which comparison
  // to make against it (low <= for a long stop, high >= for a long TP) is the
  // call site's business.
  return {
    triggerPrice: limitPrice * (1 - adverse * slippage),
    fillPrice: limitPrice * (1 + adverse * slippage),
  };
}

/**
 * Adapter interface for strategies used in backtesting.
 * Allows both full Strategy interface and simplified backtest-only strategies.
 */
interface BacktestableStrategy {
  id: string;
  name: string;
  generateSignal(
    bar: OHLC,
    indicators: IndicatorState,
    position: Position | null
  ): Signal | null;
  kellyParams?: {
    winRate: number;
    avgWin: number;
    avgLoss: number;
  };
}

// ============================================================================
// Engine Parameters
// ============================================================================

/**
 * Engine parameters, extending the persisted `BacktestParams` with runtime-only
 * options that carry callbacks and so cannot live in a serializable param set.
 */
export interface BacktestEngineParams extends BacktestParams {
  /**
   * Opt-in book-aware fills. Left unset (the default) the engine prices every
   * fill exactly as it always has, so numbers from previously recorded runs do
   * not move underneath their authors. This switch is deliberately off by
   * default for that reason and no other.
   */
  fillModel?: BookFillConfig;
}

// ============================================================================
// BacktestEngine Class
// ============================================================================

/**
 * Core backtesting engine.
 *
 * Features:
 * - Pre-calculates common indicators for entire dataset
 * - Handles position sizing (fixed amount, fixed percent, Kelly, all-in)
 * - Applies realistic slippage and commission
 * - Tracks equity curve with drawdown
 * - Supports long and short positions
 */
export class BacktestEngine {
  private params: BacktestParams;
  private capital: number;
  private position: Position | null = null;
  private trades: Trade[] = [];
  private equityCurve: EquityPointExtended[] = [];
  private tradeCounter: number = 0;
  private peakEquity: number;
  private currentBarIndex: number = 0;
  private indicators: IndicatorArrays | null = null;
  private reachedMaxDrawdown = false;
  private pendingSignals: Array<{ signal: Signal; executeAtBar: number }> = [];

  // Grid/DCA position tracking — multiple concurrent positions
  private gridPositions: Position[] = [];
  private maxGridPositions: number = 1;

  private fillConfig: BookFillConfig | null = null;
  private fillLog: FillRecord[] = [];

  constructor(params: BacktestEngineParams) {
    this.params = { ...DEFAULT_BACKTEST_PARAMS, ...params };
    this.capital = this.params.initialCapital;
    this.peakEquity = this.capital;
    this.fillConfig = params.fillModel ?? null;
  }

  /**
   * Every fill priced by the book model, in execution order. Empty unless
   * `fillModel` was supplied. Read `estimated` before trusting a run: a result
   * that silently mixes book-priced and rate-estimated fills is unreadable.
   */
  getFillLog(): readonly FillRecord[] {
    return this.fillLog;
  }

  /**
   * Run the backtest with a strategy against OHLC data.
   *
   * @param strategy - Strategy to test (can be full Strategy or BacktestableStrategy)
   * @param data - Array of OHLC bars
   * @returns Complete backtest result with metrics
   */
  run(
    strategy: BacktestableStrategy | Strategy,
    data: OHLC[],
    strategyParams?: ParameterSet
  ): BacktestEngineResult {
    const adjustedStrategy = this.applyStrategyParams(strategy, strategyParams);
    // Reset state for fresh run
    this.reset();

    if (data.length === 0) {
      return this.buildResult(strategy.id, data);
    }

    // Pre-calculate all indicators
    this.indicators = this.precalculateIndicators(data);

    // Process each bar
    for (let i = 0; i < data.length; i++) {
      this.currentBarIndex = i;
      const bar = data[i];
      if (!bar) continue;

      // Stop processing new signals after max drawdown breach
      if (this.reachedMaxDrawdown) {
        this.flushPendingSignals(bar);
        this.updateEquityCurve(bar);
        continue;
      }
      const indicatorState = this.getIndicatorState(i);

      // Check for stop loss / take profit hits first (using high/low)
      // Covers both single position and grid positions
      if (this.position || this.gridPositions.length > 0) {
        this.checkStopTakeProfit(bar);
      }

      this.flushPendingSignals(bar);

      // Only process signals when there's no single position OR we're in grid mode
      if (!this.position || this.gridPositions.length > 0) {
        // Get signal from strategy
        const signal = this.getStrategySignal(adjustedStrategy, bar, i, data, indicatorState);

        // Execute signal if non-null and non-HOLD
        if (signal && signal.type !== "HOLD") {
          this.queueOrExecuteSignal(signal, bar);
        }
      }

      // Update unrealized P&L if we have any positions (single or grid)
      if (this.position || this.gridPositions.length > 0) {
        this.updateUnrealizedPnL(bar.close);
      }

      // Update equity curve
      this.updateEquityCurve(bar);
    }

    // Close any remaining positions at end of backtest (single + grid)
    let finalPositionClosed = false;
    if (data.length > 0) {
      const lastBar = data[data.length - 1];
      if (lastBar) {
        // Close single position
        if (this.position) {
          this.closePosition(lastBar.close, lastBar, "END_OF_BACKTEST");
          finalPositionClosed = true;
        }

        // Close all remaining grid positions
        if (this.gridPositions.length > 0) {
          const gridSnapshot = [...this.gridPositions];
          for (const pos of gridSnapshot) {
            this.closeGridPosition(pos, lastBar.close, lastBar, "END_OF_BACKTEST");
          }
          finalPositionClosed = true;
        }
      }
    }

    return this.buildResult(strategy.id, data, finalPositionClosed);
  }

  // ============================================================================
  // Private Methods - Signal Processing
  // ============================================================================

  /**
   * Get signal from strategy, adapting for different strategy interfaces.
   */
  private getStrategySignal(
    strategy: BacktestableStrategy | Strategy,
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState
  ): Signal {
    if ("generateSignal" in strategy && typeof strategy.generateSignal === "function") {
      const generator = strategy.generateSignal as (...args: unknown[]) => Signal | null;
      let signal: Signal | null;

      if (generator.length >= 4) {
        signal = generator(bar, index, data, indicators);
      } else {
        signal = generator(bar, indicators, this.position);
      }

      if (signal) {
        return signal;
      }
    }

    return {
      type: "HOLD",
      price: bar.close,
      timestamp: bar.timestamp,
      reason: "No signal",
    };
  }

  /**
   * Process a bar and generate/execute signals.
   */
  private processBar(bar: OHLC, index: number, indicators: IndicatorState): void {
    this.currentBarIndex = index;

    // Check stops first
    if (this.position) {
      this.checkStopTakeProfit(bar);
    }

    // Get and execute signal
    // Note: This is called from run() which handles signal generation
  }

  /**
   * Execute a trading signal.
   * Supports both single-position (classic) and multi-position (grid/DCA) modes.
   * Grid mode activates when signal.gridLevel is defined.
   */
  private executeSignal(signal: Signal, bar: OHLC): void {
    const signalType = signal.type;
    const isGridSignal = signal.gridLevel !== undefined;

    if (isGridSignal) {
      this.executeGridSignal(signal, bar);
      return;
    }

    // Classic single-position path (unchanged behavior)
    if (signalType === "BUY") {
      // If we have a short position, close it first
      if (this.position && this.position.side === "SHORT") {
        this.closePosition(signal.price || bar.close, bar, "SIGNAL_REVERSAL");
      }

      // Open long if no position
      if (!this.position) {
        this.openPosition("LONG", signal.price || bar.close, bar);
      }
    } else if (signalType === "SELL") {
      // If we have a long position, close it
      if (this.position && this.position.side === "LONG") {
        this.closePosition(signal.price || bar.close, bar, "SIGNAL_EXIT");
      }

      // Open short if allowed and no position
      if (!this.position && this.params.allowShorts) {
        this.openPosition("SHORT", signal.price || bar.close, bar);
      }
    }
  }

  private queueOrExecuteSignal(signal: Signal, bar: OHLC): void {
    const lagBars = Math.max(0, this.params.executionLagBars ?? 0);
    if (lagBars === 0) {
      this.executeSignal(signal, bar);
      return;
    }

    this.pendingSignals.push({
      signal,
      executeAtBar: this.currentBarIndex + lagBars,
    });
  }

  private flushPendingSignals(bar: OHLC): void {
    if (this.pendingSignals.length === 0) return;

    const dueSignals = this.pendingSignals.filter((pending) => pending.executeAtBar <= this.currentBarIndex);
    if (dueSignals.length === 0) return;

    this.pendingSignals = this.pendingSignals.filter((pending) => pending.executeAtBar > this.currentBarIndex);
    for (const pending of dueSignals) {
      const executionSignal: Signal = {
        ...pending.signal,
        price: bar.open,
        timestamp: bar.timestamp,
        reason: pending.signal.reason
          ? `${pending.signal.reason} (lagged ${Math.max(0, this.params.executionLagBars ?? 0)} bar)`
          : `Lagged execution (${Math.max(0, this.params.executionLagBars ?? 0)} bar)`,
      };
      this.executeSignal(executionSignal, bar);
    }
  }

  /**
   * Execute a grid/DCA signal that supports multiple concurrent positions.
   */
  private executeGridSignal(signal: Signal, bar: OHLC): void {
    const maxPos = signal.maxPositions ?? this.maxGridPositions;
    // Update engine-level max so other methods (equity, stops) know we're in grid mode
    if (maxPos > this.maxGridPositions) {
      this.maxGridPositions = maxPos;
    }

    if (signal.type === "BUY") {
      // Close any short grid positions on reversal
      const shortGridPositions = this.gridPositions.filter(p => p.side === "SHORT");
      for (const pos of shortGridPositions) {
        this.closeGridPosition(pos, signal.price || bar.close, bar, "SIGNAL_REVERSAL");
      }

      // Check if we already have a position at this exact grid level
      const existingAtLevel = this.gridPositions.find(
        p => p.gridLevel === signal.gridLevel && p.side === "LONG"
      );
      if (existingAtLevel) {
        return; // Already have this grid level filled
      }

      // Check if we've reached max grid positions
      const longGridCount = this.gridPositions.filter(p => p.side === "LONG").length;
      if (longGridCount >= maxPos) {
        return; // At capacity
      }

      this.openGridPosition("LONG", signal.price || bar.close, bar, signal.gridLevel!);
    } else if (signal.type === "SELL") {
      if (signal.gridLevel !== undefined) {
        // Close the specific grid level if it exists
        const matchingPos = this.gridPositions.find(
          p => p.gridLevel === signal.gridLevel && p.side === "LONG"
        );
        if (matchingPos) {
          this.closeGridPosition(matchingPos, signal.price || bar.close, bar, "SIGNAL_EXIT");
        }
      } else {
        // No specific grid level — close ALL long grid positions
        const longGridPositions = [...this.gridPositions.filter(p => p.side === "LONG")];
        for (const pos of longGridPositions) {
          this.closeGridPosition(pos, signal.price || bar.close, bar, "SIGNAL_EXIT");
        }
      }

      // Open short grid positions if allowed
      if (this.params.allowShorts && signal.gridLevel !== undefined) {
        const shortGridCount = this.gridPositions.filter(p => p.side === "SHORT").length;
        if (shortGridCount < maxPos) {
          this.openGridPosition("SHORT", signal.price || bar.close, bar, signal.gridLevel!);
        }
      }
    }
  }

  // ============================================================================
  // Private Methods - Grid Position Management
  // ============================================================================

  /**
   * Open a new grid position at a specific grid level.
   */
  private openGridPosition(
    side: "LONG" | "SHORT",
    price: number,
    bar: OHLC,
    gridLevel: number
  ): void {
    // Apply slippage (book-walked when a fill model is configured).
    // Position size divides equally among max grid positions so total exposure
    // across all levels stays within sizing limits.
    const entry = this.resolveEntryFill(
      price,
      side === "LONG" ? "BUY" : "SELL",
      bar,
      (p) => this.calculatePositionSize(p) / this.maxGridPositions
    );
    if (!entry) {
      return; // Book held no liquidity for this side
    }
    const slippedPrice = entry.price;
    const perGridValue = entry.value;

    if (perGridValue <= 0) {
      return; // Insufficient capital
    }

    const quantity = perGridValue / slippedPrice;

    // Apply entry commission
    const commission = this.applyCommission(perGridValue);

    // Check if we can afford this position
    if (perGridValue + commission > this.capital) {
      const availableForPosition = this.capital - commission;
      if (availableForPosition <= 0) {
        return;
      }
      const adjustedQuantity = availableForPosition / slippedPrice;
      const adjustedValue = adjustedQuantity * slippedPrice;
      const adjustedCommission = this.applyCommission(adjustedValue);

      this.capital -= adjustedValue + adjustedCommission;

      this.gridPositions.push({
        id: `trade_${++this.tradeCounter}`,
        side,
        entryPrice: slippedPrice,
        entryTime: bar.timestamp,
        entryBarIndex: this.currentBarIndex,
        quantity: adjustedQuantity,
        entryCommission: adjustedCommission,
        unrealizedPnL: 0,
        gridLevel,
      });
    } else {
      this.capital -= perGridValue + commission;

      this.gridPositions.push({
        id: `trade_${++this.tradeCounter}`,
        side,
        entryPrice: slippedPrice,
        entryTime: bar.timestamp,
        entryBarIndex: this.currentBarIndex,
        quantity,
        entryCommission: commission,
        unrealizedPnL: 0,
        gridLevel,
      });
    }
  }

  /**
   * Close a specific grid position.
   */
  private closeGridPosition(
    pos: Position,
    price: number,
    bar: OHLC,
    reason: string
  ): void {
    // Apply slippage (opposite direction, book-walked when a fill model is configured)
    const exitSide = pos.side === "LONG" ? "SELL" : "BUY";
    const exitFill = this.bookFill(price, exitSide, pos.quantity, bar, "estimate");
    const slippedPrice = exitFill && !exitFill.estimated
      ? exitFill.price
      : this.applySlippage(price, exitSide);

    // Calculate P&L
    const positionValue = pos.quantity * slippedPrice;
    const entryValue = pos.quantity * pos.entryPrice;

    let grossPnL: number;
    if (pos.side === "LONG") {
      grossPnL = positionValue - entryValue;
    } else {
      grossPnL = entryValue - positionValue;
    }

    // Apply exit commission
    const exitCommission = this.applyCommission(positionValue);
    const totalCommission = pos.entryCommission + exitCommission;
    // Both legs. The entry leg was already deducted from `capital` at open, so
    // netting only the exit leg left `capital` correct while every per-trade
    // statistic derived from netPnL (win rate, expectancy, profit factor,
    // Monte Carlo) was optimistic by exactly one commission.
    const netPnL = grossPnL - totalCommission;

    // Add proceeds back to capital
    if (pos.side === "LONG") {
      this.capital += positionValue - exitCommission;
    } else {
      this.capital += entryValue + grossPnL - exitCommission;
    }

    // Calculate return percentage
    const returnPct = (netPnL / entryValue) * 100;

    // Create trade record
    const trade: Trade = {
      id: pos.id,
      side: pos.side,
      entryPrice: pos.entryPrice,
      entryTime: pos.entryTime,
      exitPrice: slippedPrice,
      exitTime: bar.timestamp,
      quantity: pos.quantity,
      grossPnL,
      commission: totalCommission,
      netPnL,
      returnPct,
      holdingPeriod: this.currentBarIndex - pos.entryBarIndex,
      exitReason: reason,
      gridLevel: pos.gridLevel,
    };

    this.trades.push(trade);

    // Remove from gridPositions array
    const idx = this.gridPositions.indexOf(pos);
    if (idx !== -1) {
      this.gridPositions.splice(idx, 1);
    }
  }

  // ============================================================================
  // Private Methods - Position Management
  // ============================================================================

  /**
   * Open a new position.
   */
  private openPosition(side: "LONG" | "SHORT", price: number, bar: OHLC): void {
    // Apply slippage (book-walked when a fill model is configured)
    const entry = this.resolveEntryFill(price, side === "LONG" ? "BUY" : "SELL", bar, (p) =>
      this.calculatePositionSize(p)
    );
    if (!entry) {
      return; // Book held no liquidity for this side
    }
    const slippedPrice = entry.price;

    // Calculate position size
    const positionValue = entry.value;

    if (positionValue <= 0) {
      return; // Insufficient capital
    }

    const quantity = positionValue / slippedPrice;

    // Apply entry commission
    const commission = this.applyCommission(positionValue);

    // Deduct from capital (position value + commission)
    if (positionValue + commission > this.capital) {
      // Reduce position to fit available capital
      const availableForPosition = this.capital - commission;
      if (availableForPosition <= 0) {
        return; // Can't afford even commission
      }
      // Recalculate with reduced position
      const adjustedQuantity = availableForPosition / slippedPrice;
      const adjustedValue = adjustedQuantity * slippedPrice;
      const adjustedCommission = this.applyCommission(adjustedValue);

      this.capital -= adjustedValue + adjustedCommission;

      this.position = {
        id: `trade_${++this.tradeCounter}`,
        side,
        entryPrice: slippedPrice,
        entryTime: bar.timestamp,
        entryBarIndex: this.currentBarIndex,
        quantity: adjustedQuantity,
        entryCommission: adjustedCommission,
        unrealizedPnL: 0,
      };
    } else {
      this.capital -= positionValue + commission;

      this.position = {
        id: `trade_${++this.tradeCounter}`,
        side,
        entryPrice: slippedPrice,
        entryTime: bar.timestamp,
        entryBarIndex: this.currentBarIndex,
        quantity,
        entryCommission: commission,
        unrealizedPnL: 0,
      };
    }
  }

  /**
   * Close the current position.
   */
  private closePosition(price: number, bar: OHLC, reason: string): void {
    if (!this.position) {
      return;
    }

    // Apply slippage (opposite direction, book-walked when a fill model is configured)
    const exitSide = this.position.side === "LONG" ? "SELL" : "BUY";
    const exitFill = this.bookFill(price, exitSide, this.position.quantity, bar, "estimate");
    const slippedPrice = exitFill && !exitFill.estimated
      ? exitFill.price
      : this.applySlippage(price, exitSide);

    // Calculate P&L
    const positionValue = this.position.quantity * slippedPrice;
    const entryValue = this.position.quantity * this.position.entryPrice;

    let grossPnL: number;
    if (this.position.side === "LONG") {
      grossPnL = positionValue - entryValue;
    } else {
      grossPnL = entryValue - positionValue;
    }

    // Apply exit commission
    const exitCommission = this.applyCommission(positionValue);
    const totalCommission = this.position.entryCommission + exitCommission;
    // Both legs; see closeGridPosition. `capital` already carries the entry
    // leg, so netting only the exit leg overstated every per-trade statistic.
    const netPnL = grossPnL - totalCommission;

    // Add proceeds back to capital
    if (this.position.side === "LONG") {
      this.capital += positionValue - exitCommission;
    } else {
      // For shorts, we get back our entry value plus/minus PnL
      this.capital += entryValue + grossPnL - exitCommission;
    }

    // Calculate return percentage
    const returnPct = (netPnL / entryValue) * 100;

    // Create trade record
    const trade: Trade = {
      id: this.position.id,
      side: this.position.side,
      entryPrice: this.position.entryPrice,
      entryTime: this.position.entryTime,
      exitPrice: slippedPrice,
      exitTime: bar.timestamp,
      quantity: this.position.quantity,
      grossPnL,
      commission: totalCommission,
      netPnL,
      returnPct,
      holdingPeriod: this.currentBarIndex - this.position.entryBarIndex,
      exitReason: reason,
    };

    this.trades.push(trade);
    this.position = null;
  }

  /**
   * Check if stop loss or take profit has been hit.
   * Handles both single position and grid positions.
   */
  private checkStopTakeProfit(bar: OHLC): void {
    const slippage = this.getExecutionRate();
    if (this.position) {
      const side = this.position.side;
      if (this.position.stopLoss) {
        const sl = protectiveOrderPrices(side, this.position.stopLoss, slippage);
        if (side === "LONG" ? bar.low <= sl.triggerPrice : bar.high >= sl.triggerPrice) {
          this.closePosition(sl.fillPrice, bar, "STOP_LOSS");
          return;
        }
      }
      if (this.position.takeProfit) {
        const tp = protectiveOrderPrices(side, this.position.takeProfit, slippage);
        if (side === "LONG" ? bar.high >= tp.triggerPrice : bar.low <= tp.triggerPrice) {
          this.closePosition(tp.fillPrice, bar, "TAKE_PROFIT");
          return;
        }
      }
    }

    // Check each grid position individually
    // Snapshot ensures we iterate over a stable copy while closeGridPosition mutates this.gridPositions
    const gridSnapshot = [...this.gridPositions];
    for (const pos of gridSnapshot) {
      if (pos.stopLoss) {
        const sl = protectiveOrderPrices(pos.side, pos.stopLoss, slippage);
        if (pos.side === "LONG" ? bar.low <= sl.triggerPrice : bar.high >= sl.triggerPrice) {
          this.closeGridPosition(pos, sl.fillPrice, bar, "STOP_LOSS");
          continue;
        }
      }
      if (pos.takeProfit) {
        const tp = protectiveOrderPrices(pos.side, pos.takeProfit, slippage);
        if (pos.side === "LONG" ? bar.high >= tp.triggerPrice : bar.low <= tp.triggerPrice) {
          this.closeGridPosition(pos, tp.fillPrice, bar, "TAKE_PROFIT");
          continue;
        }
      }
    }
  }

  /**
   * Update unrealized P&L for current position and all grid positions.
   */
  private updateUnrealizedPnL(currentPrice: number): void {
    // Update single position (classic path)
    if (this.position) {
      const currentValue = this.position.quantity * currentPrice;
      const entryValue = this.position.quantity * this.position.entryPrice;

      if (this.position.side === "LONG") {
        this.position.unrealizedPnL = currentValue - entryValue;
      } else {
        this.position.unrealizedPnL = entryValue - currentValue;
      }
    }

    // Update each grid position
    for (const pos of this.gridPositions) {
      const currentValue = pos.quantity * currentPrice;
      const entryValue = pos.quantity * pos.entryPrice;

      if (pos.side === "LONG") {
        pos.unrealizedPnL = currentValue - entryValue;
      } else {
        pos.unrealizedPnL = entryValue - currentValue;
      }
    }
  }

  // ============================================================================
  // Private Methods - Position Sizing
  // ============================================================================

  /**
   * Calculate position size based on sizing mode.
   */
  private calculatePositionSize(price: number): number {
    switch (this.params.positionSizing) {
      case "FIXED_AMOUNT":
        return Math.min(
          this.params.fixedAmount || 1000,
          this.capital * 0.95 // Never use more than 95%
        );

      case "FIXED_PERCENT":
        const percent = this.params.fixedPercent || 0.1;
        return this.capital * percent;

      case "KELLY":
        return this.calculateKellySize();

      case "ALL_IN":
        return this.capital * 0.95;

      default:
        return this.capital * 0.1;
    }
  }

  /**
   * Calculate Kelly criterion position size.
   */
  private calculateKellySize(): number {
    const kelly = this.params.kelly;
    if (!kelly) {
      // Fallback to 10% if no Kelly params
      return this.capital * 0.1;
    }

    const { winRate, avgWin, avgLoss, fractionMultiplier = 0.5 } = kelly;

    if (avgLoss === 0) {
      return this.capital * 0.1;
    }

    // Kelly formula: f = (bp - q) / b
    // where b = avgWin/avgLoss, p = winRate, q = 1 - winRate
    const b = avgWin / avgLoss;
    const p = winRate;
    const q = 1 - winRate;

    const kellyFraction = (b * p - q) / b;

    // Apply fraction multiplier (half-Kelly is safer)
    const adjustedFraction = Math.max(0, Math.min(kellyFraction * fractionMultiplier, 0.95));

    return this.capital * adjustedFraction;
  }

  // ============================================================================
  // Private Methods - Costs
  // ============================================================================

  /**
   * Apply slippage to a price.
   */
  private applySlippage(price: number, side: "BUY" | "SELL"): number {
    const slippage = this.getExecutionRate();

    if (side === "BUY") {
      // Buying: price moves up (worse for buyer)
      return price * (1 + slippage);
    } else {
      // Selling: price moves down (worse for seller)
      return price * (1 - slippage);
    }
  }

  /**
   * Resolve entry price and notional for one position.
   *
   * With no fill model this is the flat-rate arithmetic the engine has always
   * done. With one, size is a function of price and the book price is a function
   * of size, so the flat-rate price seeds the size the book is then walked with,
   * and the notional is capped at what the book actually absorbed.
   *
   * Returns null when the book cannot absorb any quantity at all.
   */
  private resolveEntryFill(
    referencePrice: number,
    side: "BUY" | "SELL",
    bar: OHLC,
    sizeAt: (price: number) => number
  ): { price: number; value: number } | null {
    const flatPrice = this.applySlippage(referencePrice, side);
    if (!this.fillConfig) {
      return { price: flatPrice, value: sizeAt(flatPrice) };
    }

    const provisionalValue = sizeAt(flatPrice);
    if (provisionalValue <= 0) {
      return { price: flatPrice, value: provisionalValue };
    }

    const fill = this.bookFill(referencePrice, side, provisionalValue / flatPrice, bar, "fill");
    if (!fill || fill.filledQuantity <= 0) {
      return null;
    }
    return { price: fill.price, value: Math.min(sizeAt(fill.price), fill.filledQuantity * fill.price) };
  }

  /**
   * Price a fill against the bar's book instead of the flat rate.
   *
   * Returns null when no fill model is configured, which is the signal to the
   * caller to keep the untouched flat-rate path.
   *
   * `partialPolicy` decides what a book that runs dry means for this call site.
   * "fill" is for entries, where order size is a free variable and taking only
   * what the book holds is what a venue would do. "estimate" is for exits, where
   * the quantity is fixed by the open position and a partial fill would leave a
   * residual the bar loop does not model; those price at the flat rate and are
   * flagged `estimated` rather than being invented at the last level.
   */
  private bookFill(
    referencePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
    bar: OHLC,
    partialPolicy: "fill" | "estimate"
  ): BookFill | null {
    if (!this.fillConfig) return null;

    const flatPrice = this.applySlippage(referencePrice, side);
    const depth = this.fillConfig.depth(bar, this.currentBarIndex);

    let fill: BookFill;
    if (!depth) {
      fill = {
        price: flatPrice,
        requestedQuantity: quantity,
        filledQuantity: quantity,
        levelsConsumed: 0,
        source: "estimated",
        estimated: true,
      };
    } else {
      fill = walkBookFill(depth, side, quantity, this.fillConfig.maxLevels);
      if (fill.source === "book_partial" && partialPolicy === "estimate") {
        fill = { ...fill, price: flatPrice, filledQuantity: quantity, estimated: true };
      }
    }

    this.fillLog.push({
      ...fill,
      barIndex: this.currentBarIndex,
      timestamp: bar.timestamp,
      side,
      referencePrice: flatPrice,
    });
    return fill;
  }

  /**
   * Calculate commission for a trade value.
   */
  private applyCommission(value: number): number {
    return value * this.params.commissionRate;
  }

  private getExecutionRate(): number {
    return (this.params.slippageRate ?? 0)
      + ((this.params.spreadRate ?? 0) / 2)
      + (this.params.marketImpactRate ?? 0);
  }

  // ============================================================================
  // Private Methods - Equity Tracking
  // ============================================================================

  /**
   * Update the equity curve with current bar.
   * Accounts for both single position and all grid positions.
   */
  private updateEquityCurve(bar: OHLC): void {
    // Calculate total equity (cash + unrealized P&L from all positions)
    let equity = this.capital;

    // Add single position value (classic path)
    if (this.position) {
      const positionValue = this.position.quantity * bar.close;
      if (this.position.side === "LONG") {
        equity += positionValue;
      } else {
        // For short, we have entry value locked, plus/minus unrealized P&L
        equity += this.position.quantity * this.position.entryPrice + this.position.unrealizedPnL;
      }
    }

    // Add all grid positions' value (subtract entry commission like the single-position path)
    for (const pos of this.gridPositions) {
      const positionValue = pos.quantity * bar.close;
      if (pos.side === "LONG") {
        equity += positionValue - pos.entryCommission;
      } else {
        equity += pos.quantity * pos.entryPrice + pos.unrealizedPnL - pos.entryCommission;
      }
    }

    // Track peak for drawdown
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }

    const drawdown = this.peakEquity - equity;
    const drawdownPct = this.peakEquity > 0 ? (drawdown / this.peakEquity) * 100 : 0;

    this.equityCurve.push({
      timestamp: bar.timestamp,
      equity,
      drawdown,
      drawdownPct,
    });

    // Enforce max drawdown limit — close all open positions and halt trading
    if (this.params.maxDrawdown && drawdownPct / 100 >= this.params.maxDrawdown) {
      if (this.position) {
        this.closePosition(bar.close, bar, "MAX_DRAWDOWN");
      }
      // Close all grid positions on max drawdown
      const gridSnapshot = [...this.gridPositions];
      for (const pos of gridSnapshot) {
        this.closeGridPosition(pos, bar.close, bar, "MAX_DRAWDOWN");
      }
      this.reachedMaxDrawdown = true;
    }
  }

  // ============================================================================
  // Private Methods - Indicators
  // ============================================================================

  /**
   * Pre-calculate all common indicators for the entire dataset.
   */
  private precalculateIndicators(data: OHLC[]): IndicatorArrays {
    const closes = data.map(bar => bar.close);

    // Convert OHLC to Candle format for ATR
    const candles: Candle[] = data.map(bar => ({
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      openTime: bar.timestamp,
    }));

    // Calculate SMAs
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const sma200 = calculateSMA(closes, 200);

    // Calculate EMAs
    const ema9Result = calculateEMA(closes, 9);
    const ema21Result = calculateEMA(closes, 21);

    // Calculate RSI
    const rsi14Result = calculateRSI(closes, 14);

    // Calculate Bollinger Bands
    const bbResult = calculateBollingerBands(closes, 20, 2);

    // Calculate ATR
    const atr14Result = calculateATR(candles, 14);

    // Calculate MACD
    const macdResult = calculateMACD(closes, 12, 26, 9);

    return {
      sma20,
      sma50,
      sma200,
      ema9: ema9Result.values,
      ema21: ema21Result.values,
      rsi14: rsi14Result.values,
      bbUpper: bbResult.upper,
      bbMiddle: bbResult.middle,
      bbLower: bbResult.lower,
      bbWidth: bbResult.bandwidth,
      atr14: atr14Result.values,
      macdLine: macdResult.macd,
      macdSignal: macdResult.signal,
      macdHistogram: macdResult.histogram,
    };
  }

  /**
   * Get indicator state for a specific bar index.
   */
  private getIndicatorState(index: number): IndicatorState {
    if (!this.indicators) {
      return {};
    }

    return {
      sma20: this.indicators.sma20[index],
      sma50: this.indicators.sma50[index],
      sma200: this.indicators.sma200[index],
      ema9: this.indicators.ema9[index],
      ema21: this.indicators.ema21[index],
      rsi14: this.indicators.rsi14[index],
      bbUpper: this.indicators.bbUpper[index],
      bbMiddle: this.indicators.bbMiddle[index],
      bbLower: this.indicators.bbLower[index],
      bbWidth: this.indicators.bbWidth[index],
      atr14: this.indicators.atr14[index],
      macdLine: this.indicators.macdLine[index],
      macdSignal: this.indicators.macdSignal[index],
      macdHistogram: this.indicators.macdHistogram[index],
    };
  }

  // ============================================================================
  // Private Methods - Utility
  // ============================================================================

  /**
   * Reset engine state for a fresh run.
   */
  private reset(): void {
    this.capital = this.params.initialCapital;
    this.position = null;
    this.trades = [];
    this.equityCurve = [];
    this.tradeCounter = 0;
    this.peakEquity = this.capital;
    this.currentBarIndex = 0;
    this.indicators = null;
    this.reachedMaxDrawdown = false;
    this.pendingSignals = [];
    this.gridPositions = [];
    this.maxGridPositions = 1;
    this.fillLog = [];
  }

  /**
   * Apply optional strategy parameters before running.
   */
  private applyStrategyParams(
    strategy: BacktestableStrategy | Strategy,
    params?: ParameterSet
  ): BacktestableStrategy | Strategy {
    if (!params || Object.keys(params).length === 0) {
      return strategy;
    }

    const paramStrategy = strategy as Strategy & {
      withParams?: (values: ParameterSet) => Strategy;
      setParams?: (values: ParameterSet) => void;
      params?: ParameterSet;
    };

    if (typeof paramStrategy.withParams === "function") {
      return paramStrategy.withParams(params);
    }

    if (typeof paramStrategy.setParams === "function") {
      paramStrategy.setParams(params);
      return paramStrategy;
    }

    if ("params" in paramStrategy) {
      paramStrategy.params = { ...(paramStrategy.params ?? {}), ...params };
    }

    return paramStrategy;
  }

  /**
   * Build the final backtest result.
   */
  private buildResult(
    strategyId: string,
    data: OHLC[],
    finalPositionClosed: boolean = false
  ): BacktestEngineResult {
    // Calculate final capital from equity curve
    const lastEquityPoint = this.equityCurve[this.equityCurve.length - 1];
    const finalCapital = this.equityCurve.length > 0 && lastEquityPoint
      ? lastEquityPoint.equity
      : this.params.initialCapital;

    // Calculate metrics
    const metrics = this.calculateMetrics(finalCapital);

    const firstBar = data[0];
    const lastBar = data[data.length - 1];

    return {
      strategyId,
      params: this.params,
      metrics,
      trades: this.trades,
      equityCurve: this.equityCurve,
      finalCapital,
      startDate: firstBar?.timestamp ?? 0,
      endDate: lastBar?.timestamp ?? 0,
      totalBars: data.length,
      finalPositionClosed,
    };
  }

  /**
   * Calculate all performance metrics.
   */
  private calculateMetrics(finalCapital: number): BacktestMetrics {
    return calculateMetricsFromTrades(this.trades, this.equityCurve, this.params);
  }
}

// ============================================================================
// Helper Function
// ============================================================================

/**
 * Convenience function to run a backtest with default or partial params.
 *
 * @param strategy - Strategy to test
 * @param data - OHLC data array
 * @param params - Optional partial params (merged with defaults)
 * @returns Complete backtest result
 *
 * @example
 * ```ts
 * const result = runBacktest(myStrategy, ohlcData, {
 *   initialCapital: 50000,
 *   commissionRate: 0.0005,
 * });
 * ```
 */
export function runBacktest(
  strategy: BacktestableStrategy | Strategy,
  data: OHLC[],
  params?: Partial<BacktestParams>,
  strategyParams?: ParameterSet
): BacktestEngineResult {
  const fullParams: BacktestParams = {
    ...DEFAULT_BACKTEST_PARAMS,
    ...params,
  };

  const engine = new BacktestEngine(fullParams);
  return engine.run(strategy, data, strategyParams);
}

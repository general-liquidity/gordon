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

  // Grid/DCA position tracking — multiple concurrent positions
  private gridPositions: Position[] = [];
  private maxGridPositions: number = 1;

  constructor(params: BacktestParams) {
    this.params = { ...DEFAULT_BACKTEST_PARAMS, ...params };
    this.capital = this.params.initialCapital;
    this.peakEquity = this.capital;
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
        this.updateEquityCurve(bar);
        continue;
      }
      const indicatorState = this.getIndicatorState(i);

      // Check for stop loss / take profit hits first (using high/low)
      // Covers both single position and grid positions
      if (this.position || this.gridPositions.length > 0) {
        this.checkStopTakeProfit(bar);
      }

      // Only process signals when there's no single position OR we're in grid mode
      if (!this.position || this.gridPositions.length > 0) {
        // Get signal from strategy
        const signal = this.getStrategySignal(adjustedStrategy, bar, i, data, indicatorState);

        // Execute signal if non-null and non-HOLD
        if (signal && signal.type !== "HOLD") {
          this.executeSignal(signal, bar);
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
    // Apply slippage
    const slippedPrice = this.applySlippage(price, side === "LONG" ? "BUY" : "SELL");

    // Calculate position size — divide equally among max grid positions
    // so total exposure across all levels stays within sizing limits
    const fullPositionValue = this.calculatePositionSize(slippedPrice);
    const perGridValue = fullPositionValue / this.maxGridPositions;

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
    // Apply slippage (opposite direction)
    const slippedPrice = this.applySlippage(
      price,
      pos.side === "LONG" ? "SELL" : "BUY"
    );

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
    const netPnL = grossPnL - exitCommission;

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
    // Apply slippage
    const slippedPrice = this.applySlippage(price, side === "LONG" ? "BUY" : "SELL");

    // Calculate position size
    const positionValue = this.calculatePositionSize(slippedPrice);

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

    // Apply slippage (opposite direction)
    const slippedPrice = this.applySlippage(
      price,
      this.position.side === "LONG" ? "SELL" : "BUY"
    );

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
    const netPnL = grossPnL - exitCommission;

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
    // Check single position (classic path)
    // Apply slippage to trigger prices for more realistic fills:
    // Longs: stop triggers slightly early (worse), TP triggers slightly late (worse)
    // Shorts: stop triggers slightly early (worse), TP triggers slightly late (worse)
    const slippage = this.params.slippageRate;
    if (this.position) {
      if (this.position.side === "LONG") {
        if (this.position.stopLoss && bar.low <= this.position.stopLoss * (1 + slippage)) {
          this.closePosition(this.position.stopLoss * (1 - slippage), bar, "STOP_LOSS");
          return;
        }
        if (this.position.takeProfit && bar.high >= this.position.takeProfit * (1 - slippage)) {
          this.closePosition(this.position.takeProfit * (1 + slippage), bar, "TAKE_PROFIT");
          return;
        }
      } else {
        if (this.position.stopLoss && bar.high >= this.position.stopLoss * (1 - slippage)) {
          this.closePosition(this.position.stopLoss * (1 + slippage), bar, "STOP_LOSS");
          return;
        }
        if (this.position.takeProfit && bar.low <= this.position.takeProfit * (1 + slippage)) {
          this.closePosition(this.position.takeProfit * (1 - slippage), bar, "TAKE_PROFIT");
          return;
        }
      }
    }

    // Check each grid position individually
    // Snapshot ensures we iterate over a stable copy while closeGridPosition mutates this.gridPositions
    const gridSnapshot = [...this.gridPositions];
    for (const pos of gridSnapshot) {
      if (pos.side === "LONG") {
        if (pos.stopLoss && bar.low <= pos.stopLoss * (1 + slippage)) {
          this.closeGridPosition(pos, pos.stopLoss * (1 - slippage), bar, "STOP_LOSS");
          continue;
        }
        if (pos.takeProfit && bar.high >= pos.takeProfit * (1 - slippage)) {
          this.closeGridPosition(pos, pos.takeProfit * (1 + slippage), bar, "TAKE_PROFIT");
          continue;
        }
      } else {
        if (pos.stopLoss && bar.high >= pos.stopLoss * (1 - slippage)) {
          this.closeGridPosition(pos, pos.stopLoss * (1 + slippage), bar, "STOP_LOSS");
          continue;
        }
        if (pos.takeProfit && bar.low <= pos.takeProfit * (1 + slippage)) {
          this.closeGridPosition(pos, pos.takeProfit * (1 - slippage), bar, "TAKE_PROFIT");
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
    const slippage = this.params.slippageRate;

    if (side === "BUY") {
      // Buying: price moves up (worse for buyer)
      return price * (1 + slippage);
    } else {
      // Selling: price moves down (worse for seller)
      return price * (1 - slippage);
    }
  }

  /**
   * Calculate commission for a trade value.
   */
  private applyCommission(value: number): number {
    return value * this.params.commissionRate;
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
    this.gridPositions = [];
    this.maxGridPositions = 1;
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

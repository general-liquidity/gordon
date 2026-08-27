/**
 * Opening Range Breakout — 5-minute ORB (GORDON_OPENING_RANGE_BREAKOUT).
 *
 * Port of Zarattini, Barbon, Aziz (Feb 2024), "A Profitable Day Trading
 * Strategy For The U.S. Equity Market" (Concretum Research / Swiss
 * Finance Institute / St. Gallen / Peak Capital), SSRN 4729284.
 *
 * 5-minute Opening Range Breakout (Toby Crabel 1990 lineage). The first
 * 5-minute candle's direction CONSTRAINS the trade side:
 *   - Bullish 5-min candle (close > open) → only LONG, stop-order at 5-min HIGH
 *   - Bearish 5-min candle (close < open) → only SHORT, stop-order at 5-min LOW
 *   - Doji (open == close)              → no trade
 *
 * This direction-locked variant matters: a long position is NOT taken on
 * a high-break if the open bar was bearish, even if price breaks the high
 * later. The paper's previous QQQ/TQQQ work [23] established this rule.
 *
 * Eligibility filter (daily, all three required):
 *   - Open price > $5
 *   - 14-day average daily volume >= 1,000,000 shares
 *   - 14-day ATR > $0.50
 *
 * Risk management:
 *   - Stop loss: 10% of daily ATR from entry
 *   - Exit: end of day if stop not hit (paper uses EoD; no profit target)
 *   - Position size: 1% of capital at risk per trade, with max 4x leverage
 *
 * Headline result from the paper:
 *   - Base strategy across all ~7000 US stocks 2016-2023: 3.2% annual return,
 *     0.48 Sharpe, 13% max drawdown (underperformed S&P 500 buy-and-hold).
 *   - Restricted to top 20 "Stocks in Play" (high relative volume): 1600%
 *     total return, 2.81 Sharpe, 36% annualised alpha.
 *
 * The "Stocks in Play" filter is left to the caller — it's an external
 * universe-selection step (rank by relative volume vs 14-day average,
 * take top N). This primitive returns the per-stock per-day ORB signal +
 * simulation; the caller wraps it with universe selection.
 *
 * Two pure functions:
 *   1. `evaluateORBSetup` — given the first 5-min bar + daily ATR +
 *      eligibility inputs, returns the trade signal (side, entry, stop)
 *      or {eligible: false}.
 *   2. `simulateORBTrade` — given the signal + intraday bars from 9:35
 *      onwards, returns the trade outcome (filled, fillPrice, exitPrice,
 *      exitReason, R multiple).
 *
 * Pure compute. No I/O. Deterministic.
 */

export interface OHLCBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ORBSetupInput {
  /** The first 5-minute candle (9:30–9:35 ET). */
  openingRangeBar: OHLCBar;
  /** 14-day average true range, in $ per share. */
  dailyATR: number;
  /** Daily opening price (typically the open of the openingRangeBar). */
  openPrice: number;
  /** Average daily volume over the prior 14 sessions, in shares. */
  avg14dVolume: number;
  /** Capital available for this trade, in $. Used for position-size calc. */
  capital: number;
  /**
   * Stop-loss as a fraction of daily ATR. Paper default 0.10 (10%).
   */
  stopLossAtrFraction?: number;
  /**
   * Risk fraction of capital per trade. Paper default 0.01 (1%).
   */
  riskFraction?: number;
  /**
   * Max leverage (paper default 4 per FINRA Reg-T). Caps share count when
   * notional would exceed `capital * maxLeverage`.
   */
  maxLeverage?: number;
}

export type ORBSide = "long" | "short" | "none";

export interface ORBSignal {
  /** Whether the stock passes the eligibility filter (open>$5, vol>1M, ATR>$0.50). */
  eligible: boolean;
  /** Long if bullish opening bar; short if bearish; none if doji or ineligible. */
  side: ORBSide;
  /** Stop-order trigger price (= 5-min high for long, 5-min low for short). NaN if no trade. */
  entryStop: number;
  /** Stop-loss price once filled. NaN if no trade. */
  stopLossPrice: number;
  /** Number of shares to trade. 0 if no trade. */
  positionShares: number;
  /** Dollars at risk if stop hits exactly. */
  riskDollars: number;
  /** Reasons the setup was rejected, if any. */
  rejections: string[];
  /** Stop distance in $ per share (= stopLossAtrFraction × ATR). */
  riskPerShare: number;
  reasoning: string;
}

export interface ORBTradeOutcome {
  /** Whether the stop-order entry was triggered intraday. */
  filled: boolean;
  /** Bar index at which entry filled (0 = first post-opening-range bar). -1 if never. */
  fillBarIndex: number;
  /** Fill price (= entryStop assuming stop-order semantics). NaN if not filled. */
  fillPrice: number;
  /** Final exit price (stop-loss hit or end-of-day close). NaN if not filled. */
  exitPrice: number;
  /** Bar index at exit. -1 if not filled. */
  exitBarIndex: number;
  /** "stop_loss" | "end_of_day" | "not_filled". */
  exitReason: "stop_loss" | "end_of_day" | "not_filled";
  /** P&L in $ per share (signed: positive = profit on long or short). */
  pnlPerShare: number;
  /** P&L in R units (P&L / riskPerShare). NaN if not filled. */
  rMultiple: number;
  /** Total dollar P&L = pnlPerShare × shares. NaN if not filled. */
  pnlDollars: number;
}

const MIN_OPEN_PRICE = 5;
const MIN_AVG_VOLUME = 1_000_000;
const MIN_ATR = 0.5;

export function evaluateORBSetup(input: ORBSetupInput): ORBSignal {
  const stopFrac = input.stopLossAtrFraction ?? 0.1;
  const riskFrac = input.riskFraction ?? 0.01;
  const maxLev = input.maxLeverage ?? 4;

  if (stopFrac <= 0 || stopFrac >= 1) {
    throw new Error("stopLossAtrFraction must lie in (0, 1)");
  }
  if (riskFrac <= 0 || riskFrac >= 1) {
    throw new Error("riskFraction must lie in (0, 1)");
  }
  if (maxLev <= 0) throw new Error("maxLeverage must be positive");

  const rejections: string[] = [];
  if (input.openPrice <= MIN_OPEN_PRICE) {
    rejections.push(`open ${input.openPrice.toFixed(2)} <= $${MIN_OPEN_PRICE}`);
  }
  if (input.avg14dVolume < MIN_AVG_VOLUME) {
    rejections.push(`avg 14d volume ${input.avg14dVolume.toFixed(0)} < ${MIN_AVG_VOLUME}`);
  }
  if (input.dailyATR <= MIN_ATR) {
    rejections.push(`ATR ${input.dailyATR.toFixed(2)} <= $${MIN_ATR}`);
  }
  if (input.capital <= 0) {
    rejections.push(`capital ${input.capital} must be positive`);
  }

  const bar = input.openingRangeBar;
  if (
    !Number.isFinite(bar.open) ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low) ||
    !Number.isFinite(bar.close)
  ) {
    rejections.push("opening range bar has non-finite values");
  }
  if (bar.high < bar.low) {
    rejections.push(`opening range bar has high < low`);
  }

  const eligible = rejections.length === 0;

  if (!eligible) {
    return {
      eligible: false,
      side: "none",
      entryStop: NaN,
      stopLossPrice: NaN,
      positionShares: 0,
      riskDollars: 0,
      riskPerShare: NaN,
      rejections,
      reasoning: `INELIGIBLE: ${rejections.join("; ")}`,
    };
  }

  // Direction-locked entry per paper §2
  let side: ORBSide;
  let entryStop: number;
  if (bar.close > bar.open) {
    side = "long";
    entryStop = bar.high;
  } else if (bar.close < bar.open) {
    side = "short";
    entryStop = bar.low;
  } else {
    // Doji
    return {
      eligible: true,
      side: "none",
      entryStop: NaN,
      stopLossPrice: NaN,
      positionShares: 0,
      riskDollars: 0,
      riskPerShare: NaN,
      rejections: ["opening range bar is a doji (open == close)"],
      reasoning: "DOJI: no trade taken",
    };
  }

  const riskPerShare = stopFrac * input.dailyATR;
  const stopLossPrice = side === "long" ? entryStop - riskPerShare : entryStop + riskPerShare;

  // Position size: shares such that worst-case loss = riskFrac × capital
  const riskDollarsTarget = riskFrac * input.capital;
  let shares = Math.floor(riskDollarsTarget / riskPerShare);

  // Cap by max leverage: notional <= capital × maxLeverage
  const notionalCap = (input.capital * maxLev) / entryStop;
  if (shares > notionalCap) {
    shares = Math.floor(notionalCap);
  }
  if (shares < 0) shares = 0;

  const riskDollars = shares * riskPerShare;

  const reasoning =
    `ORB ${side.toUpperCase()}: entry stop ${entryStop.toFixed(2)}, ` +
    `SL ${stopLossPrice.toFixed(2)} (${(stopFrac * 100).toFixed(1)}% ATR = ` +
    `$${riskPerShare.toFixed(2)}), ` +
    `shares=${shares}, $@risk=${riskDollars.toFixed(2)}`;

  return {
    eligible: true,
    side,
    entryStop,
    stopLossPrice,
    positionShares: shares,
    riskDollars,
    riskPerShare,
    rejections: [],
    reasoning,
  };
}

export interface ORBSimulationInput {
  /** Signal from evaluateORBSetup. */
  signal: ORBSignal;
  /** Intraday bars AFTER the opening range (9:35 onwards through close). */
  intradayBars: ReadonlyArray<OHLCBar>;
}

export function simulateORBTrade(input: ORBSimulationInput): ORBTradeOutcome {
  const sig = input.signal;
  const bars = input.intradayBars;

  if (sig.side === "none" || !sig.eligible || sig.positionShares === 0) {
    return {
      filled: false,
      fillBarIndex: -1,
      fillPrice: NaN,
      exitPrice: NaN,
      exitBarIndex: -1,
      exitReason: "not_filled",
      pnlPerShare: 0,
      rMultiple: NaN,
      pnlDollars: 0,
    };
  }

  // Search for entry trigger
  let fillBarIndex = -1;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (sig.side === "long" && b.high >= sig.entryStop) {
      fillBarIndex = i;
      break;
    }
    if (sig.side === "short" && b.low <= sig.entryStop) {
      fillBarIndex = i;
      break;
    }
  }

  if (fillBarIndex < 0) {
    return {
      filled: false,
      fillBarIndex: -1,
      fillPrice: NaN,
      exitPrice: NaN,
      exitBarIndex: -1,
      exitReason: "not_filled",
      pnlPerShare: 0,
      rMultiple: NaN,
      pnlDollars: 0,
    };
  }

  const fillPrice = sig.entryStop;

  // After fill, search forward for stop-loss hit
  // Standard backtest convention: skip the fill bar itself when checking
  // SL. Intrabar order of fill vs SL is ambiguous without tick data;
  // pessimistic same-bar matching would silently kill breakouts that ran
  // through both prices in one bar. Caller should treat results as the
  // "ran-with-the-breakout, then stopped on a subsequent bar" envelope.
  let exitPrice = NaN;
  let exitBarIndex = -1;
  let exitReason: "stop_loss" | "end_of_day" = "end_of_day";
  for (let i = fillBarIndex + 1; i < bars.length; i++) {
    const b = bars[i]!;
    if (sig.side === "long" && b.low <= sig.stopLossPrice) {
      exitPrice = sig.stopLossPrice;
      exitBarIndex = i;
      exitReason = "stop_loss";
      break;
    }
    if (sig.side === "short" && b.high >= sig.stopLossPrice) {
      exitPrice = sig.stopLossPrice;
      exitBarIndex = i;
      exitReason = "stop_loss";
      break;
    }
  }

  if (exitBarIndex < 0) {
    // End of day exit at last bar's close
    const last = bars[bars.length - 1]!;
    exitPrice = last.close;
    exitBarIndex = bars.length - 1;
    exitReason = "end_of_day";
  }

  const pnlPerShare = sig.side === "long" ? exitPrice - fillPrice : fillPrice - exitPrice;
  const rMultiple = pnlPerShare / sig.riskPerShare;
  const pnlDollars = pnlPerShare * sig.positionShares;

  return {
    filled: true,
    fillBarIndex,
    fillPrice,
    exitPrice,
    exitBarIndex,
    exitReason,
    pnlPerShare,
    rMultiple,
    pnlDollars,
  };
}

export function openingRangeBreakoutToPayload(
  signal: ORBSignal,
  outcome?: ORBTradeOutcome,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: "opening_range_breakout.computed",
    eligible: signal.eligible,
    side: signal.side,
    entryStop: Number.isFinite(signal.entryStop) ? Number(signal.entryStop.toFixed(4)) : null,
    stopLossPrice: Number.isFinite(signal.stopLossPrice)
      ? Number(signal.stopLossPrice.toFixed(4))
      : null,
    positionShares: signal.positionShares,
    riskDollars: Number(signal.riskDollars.toFixed(2)),
    riskPerShare: Number.isFinite(signal.riskPerShare)
      ? Number(signal.riskPerShare.toFixed(4))
      : null,
    rejections: signal.rejections,
  };
  if (outcome) {
    base.outcome = {
      filled: outcome.filled,
      fillPrice: Number.isFinite(outcome.fillPrice) ? Number(outcome.fillPrice.toFixed(4)) : null,
      exitPrice: Number.isFinite(outcome.exitPrice) ? Number(outcome.exitPrice.toFixed(4)) : null,
      exitReason: outcome.exitReason,
      pnlPerShare: Number(outcome.pnlPerShare.toFixed(4)),
      rMultiple: Number.isFinite(outcome.rMultiple) ? Number(outcome.rMultiple.toFixed(3)) : null,
      pnlDollars: Number(outcome.pnlDollars.toFixed(2)),
    };
  }
  return base;
}

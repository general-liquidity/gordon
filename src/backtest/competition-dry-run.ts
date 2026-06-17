/**
 * Competition money-path dry-run — walk a bar series through the Model to Market
 * risk preset and score the judged metrics, BEFORE the live Syphonix venue lands.
 *
 * This is the keystone rehearsal: it proves the full money-path Gordon will run
 * in the contest — signal → `sizeCompetitionTrade` (survive-and-compound sizing)
 * → fills → stop/target exits → daily-loss-kill + exposure-cap enforcement →
 * equity curve → annualization-correct Sharpe/Sortino/max-drawdown. When the
 * Syphonix API is wired, the live loop swaps the venue; the sizing + scoring path
 * validated here is unchanged, so the swap carries no money-path risk.
 *
 * Pure: the caller supplies the bars (real FX/metals/crypto history or synthetic)
 * and a strategy callback. No I/O, no venue, no LLM — deterministic and testable.
 * Alpha selection lives in the strategy callback (Track B); this harness owns the
 * sizing/risk/scoring spine that every strategy shares.
 */

import {
  sizeCompetitionTrade,
  type CompetitionRiskParams,
} from "../core/risk-management/competition-risk-preset.ts";
import type { BindingConstraint } from "../core/risk-management/competition-risk-preset.ts";
import {
  computeReturn,
  computeMaxDrawdown,
  computeNonAnnualizedSharpe,
} from "../core/risk-management/competition-scoring.ts";
import type { EquityPoint } from "./types.ts";
import {
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateVolatility,
  calculateMaxDrawdown,
} from "./metrics.ts";

export type Side = "long" | "short";

export interface DryRunBar {
  symbol: string;
  /** ms epoch — drives day-boundary detection for the daily-loss-kill reset. */
  time: number;
  close: number;
  /** Annualized volatility of the instrument at this bar (fraction; caller derives from history). */
  volAnnual: number;
}

export interface DryRunSignal {
  side: Side;
  /** Price distance from entry to the protective stop (> 0). */
  stopDistance: number;
  /** Price distance from entry to the take-profit (> 0). Optional — without it a
   *  position only exits on the stop or an opposite signal. */
  targetDistance?: number;
  /** Optional edge for the Kelly cap in the sizing decision. */
  edge?: { winProb: number; payoffRatio: number };
}

/**
 * Strategy callback (Track B plugs in here). Return a signal to OPEN a position
 * on this bar's symbol, or null to do nothing. Only consulted when that symbol
 * is flat and the day is not halted. `history` is the same-symbol bars strictly
 * before this one, oldest-first.
 */
export type SignalFn = (bar: DryRunBar, history: DryRunBar[]) => DryRunSignal | null;

export interface CostModel {
  /** Full bid/ask spread as basis points of price — crossed once on every fill. Default 0. */
  spreadBps?: number;
  /** Adverse slippage / market impact as basis points of price, per fill. Default 0. */
  slippageBps?: number;
}

export interface CompetitionDryRunInput {
  /** Chronologically ordered bars across all symbols (interleave by time). */
  bars: DryRunBar[];
  signal: SignalFn;
  startingEquity: number;
  /** Execution model. "taker" (default) crosses the spread and PAYS cost on every
   *  fill — existing behavior. "maker" rests limit/post liquidity and EARNS half the
   *  spread (a rebate) but still pays slippage/impact, and entries are not guaranteed
   *  to fill. Omit for byte-for-byte-unchanged taker behavior. */
  execution?: "taker" | "maker";
  /** Execution friction. The competition charges NO commission; swap/financing is TBD per the
   *  final specs (confirm at login). This models spread + slippage + impact (add swap if it
   *  applies). Omit for a frictionless run. */
  costs?: CostModel;
  /** Bars per year for THIS series — drives annualization of the judged Sharpe
   *  (FX/metals ≈ 252 daily; crypto ≈ 365 daily; intraday = bars/year). */
  periodsPerYear: number;
  /** Risk-preset overrides; defaults to COMPETITION_RISK_DEFAULTS inside the sizer. */
  riskParams?: Partial<CompetitionRiskParams>;
  /** Annual risk-free rate for Sharpe/Sortino (default 0.02). */
  riskFreeRate?: number;
  /** Maker only: how many bars a resting limit order persists (including the signal
   *  bar) before it's cancelled unfilled. Default 4. Ignored in taker mode. */
  makerMaxRestBars?: number;
  /** Perf: cap the per-bar `history` passed to the signal to the last N bars for
   *  THIS symbol. The default (undefined) passes the full prior history — byte-for-byte
   *  unchanged. Set it ONLY when the signal provably reads a bounded trailing window
   *  (e.g. the alpha-search registry caps at 768): it turns the per-bar O(N) history
   *  copy into O(N_cap), removing an O(bars²) cost on long series. */
  maxSignalHistory?: number;
}

interface OpenPosition {
  symbol: string;
  side: Side;
  entryPrice: number;
  units: number;
  notional: number;
  stopPrice: number;
  targetPrice: number | null;
}

/** A maker limit order resting in the book, waiting for the market to reach `postPrice`.
 *  Sized once at signal time; persists across bars until filled, expired, or cancelled. */
interface RestingOrder {
  symbol: string;
  side: Side;
  postPrice: number;
  units: number;
  notional: number;
  stopPrice: number;
  targetPrice: number | null;
  /** Index into this symbol's history at placement — drives the rest-bar expiry count. */
  placedAtBarIndex: number;
  placedAtTime: number;
}

export interface DryRunTrade {
  symbol: string;
  side: Side;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  units: number;
  pnl: number;
  returnPct: number;
  exitReason: "stop" | "target" | "reverse" | "end";
  bindingConstraint: BindingConstraint;
}

export interface CompetitionDryRunReport {
  startingEquity: number;
  finalEquity: number;
  totalReturnPct: number;
  /** The headline judged metric. */
  sharpe: number;
  sortino: number;
  annualizedVol: number;
  maxDrawdownPct: number;
  tradeCount: number;
  winRate: number;
  /** Total execution friction paid (spread + slippage) over the run, in equity units.
   *  Can be NEGATIVE in "maker" mode when the earned spread-rebate exceeds slippage. */
  totalCostsPaid: number;
  /** Maker fill rate: maker entry fills / maker entry attempts. 1 for taker runs
   *  (taker entries always fill); 0 when there were no entry attempts. */
  makerFillRate: number;
  /** Days on which the daily-loss-kill halted new entries. */
  haltedDays: number;
  /** Peak gross exposure as a fraction of equity reached during the run. */
  peakExposurePct: number;
  /** How often each constraint was the binding one at sizing time. */
  bindingHistogram: Record<BindingConstraint, number>;
  trades: DryRunTrade[];
  equityCurve: EquityPoint[];
  /** The metrics scored exactly as the competition scores them (Section 12). Only
   *  meaningful when the bars are 15-minute (the official Sharpe interval). */
  competition: {
    returnPct: number;
    maxDrawdownPct: number;
    /** Non-annualized Mean/Std of consecutive-bar equity returns (the judged Sharpe). */
    sharpe15m: number;
    /** Valid interval returns — Sharpe Rank caps at 50 below 8 (Section 12.5). */
    sharpe15mObs: number;
  };
}

const dayKey = (msEpoch: number): number => Math.floor(msEpoch / 86_400_000);

function emptyHistogram(): Record<BindingConstraint, number> {
  return {
    risk_per_trade: 0,
    vol_target: 0,
    leverage: 0,
    kelly: 0,
    exposure_cap: 0,
    daily_loss_kill: 0,
    none: 0,
  };
}

/** Mark-to-market PnL of an open position at `price`. */
function unrealized(pos: OpenPosition, price: number): number {
  const dir = pos.side === "long" ? 1 : -1;
  return dir * (price - pos.entryPrice) * pos.units;
}

/** Did `bar` breach the stop/target for `pos`? Conservatively checks the stop
 *  first (worst-case fill at the level). */
function exitLevel(pos: OpenPosition, price: number): "stop" | "target" | null {
  if (pos.side === "long") {
    if (price <= pos.stopPrice) return "stop";
    if (pos.targetPrice !== null && price >= pos.targetPrice) return "target";
  } else {
    if (price >= pos.stopPrice) return "stop";
    if (pos.targetPrice !== null && price <= pos.targetPrice) return "target";
  }
  return null;
}

/**
 * Run the competition money-path over a bar series. One position per symbol at a
 * time; equity marks-to-market every bar; the daily-loss-kill and exposure cap
 * are enforced through the same `sizeCompetitionTrade` the live loop uses.
 */
export function runCompetitionDryRun(input: CompetitionDryRunInput): CompetitionDryRunReport {
  const { bars, signal, startingEquity, periodsPerYear } = input;
  const maxSignalHistory = input.maxSignalHistory;
  const riskFreeRate = input.riskFreeRate ?? 0.02;
  const isMaker = input.execution === "maker";
  const halfSpreadBps = (input.costs?.spreadBps ?? 0) / 2;
  const slippageBps = input.costs?.slippageBps ?? 0;
  // Adverse price move per fill, as a fraction of price.
  //   taker: cross half the spread (PAY it) plus slippage  → (spread/2 + slip)/1e4
  //   maker: rest the post, EARN half the spread (rebate)  → (slip − spread/2)/1e4
  // The maker rate can be negative (net rebate); it's applied in the same
  // adverse direction as the taker path, so a negative rate improves the fill.
  const costRate = (isMaker ? slippageBps - halfSpreadBps : halfSpreadBps + slippageBps) / 10_000;
  const makerMaxRestBars = Math.max(1, input.makerMaxRestBars ?? 4);
  let totalCostsPaid = 0;
  let makerAttempts = 0;
  let makerFills = 0;

  let cash = startingEquity; // realized equity; open PnL is added at mark time
  const open = new Map<string, OpenPosition>();
  // Maker only: at most one resting limit per symbol, mutually exclusive with an open position.
  const resting = new Map<string, RestingOrder>();
  const histBySymbol = new Map<string, DryRunBar[]>();
  const trades: DryRunTrade[] = [];
  const bindingHistogram = emptyHistogram();
  const equityCurve: EquityPoint[] = [];

  let currentDay = bars.length ? dayKey(bars[0]!.time) : 0;
  let dayStartEquity = startingEquity;
  let halted = false;
  const haltedDaySet = new Set<number>();
  let peakExposurePct = 0;

  const markEquity = (atTime: number): number => {
    let eq = cash;
    for (const pos of open.values()) {
      // Re-mark each open position at its symbol's latest seen price.
      const h = histBySymbol.get(pos.symbol);
      const last = h && h.length ? h[h.length - 1]!.close : pos.entryPrice;
      eq += unrealized(pos, last);
    }
    void atTime;
    return eq;
  };

  const closePosition = (
    pos: OpenPosition,
    exitPrice: number,
    exitTime: number,
    reason: DryRunTrade["exitReason"],
  ): void => {
    // Adverse exit fill: a long sells lower, a short buys higher.
    const sign = pos.side === "long" ? 1 : -1;
    const adv = exitPrice * costRate;
    const fill = exitPrice - sign * adv;
    totalCostsPaid += adv * pos.units;
    const pnl = unrealized(pos, fill);
    cash += pnl;
    trades.push({
      symbol: pos.symbol,
      side: pos.side,
      entryTime: histBySymbol.get(pos.symbol)?.[0]?.time ?? exitTime,
      exitTime,
      entryPrice: pos.entryPrice,
      exitPrice: fill,
      units: pos.units,
      pnl,
      returnPct: pos.notional > 0 ? pnl / pos.notional : 0,
      exitReason: reason,
      bindingConstraint: "none",
    });
    open.delete(pos.symbol);
  };

  for (const bar of bars) {
    const d = dayKey(bar.time);
    if (d !== currentDay) {
      currentDay = d;
      dayStartEquity = markEquity(bar.time);
      halted = false;
    }

    // 1) Mark-to-market & exits on this symbol's open position.
    const pos = open.get(bar.symbol);
    if (pos) {
      const lvl = exitLevel(pos, bar.close);
      if (lvl) {
        const fill = lvl === "stop" ? pos.stopPrice : (pos.targetPrice ?? bar.close);
        closePosition(pos, fill, bar.time, lvl);
      }
    }

    // 2) Append to this symbol's history (after exit checks; entry sees prior bars).
    const hist = histBySymbol.get(bar.symbol) ?? [];
    // Snapshot the prior history for the signal. When the caller declares a bounded
    // signal window, copy only the last N bars (O(N_cap)) instead of the whole
    // history (O(bars) per bar → O(bars²)); otherwise full copy (unchanged).
    const priorHistory =
      maxSignalHistory != null && hist.length > maxSignalHistory
        ? hist.slice(hist.length - maxSignalHistory)
        : hist.slice();
    hist.push(bar);
    histBySymbol.set(bar.symbol, hist);

    // 3) Current equity & day PnL.
    const equity = markEquity(bar.time);
    const dailyPnL = equity - dayStartEquity;
    if (!halted && dailyPnL <= -(input.riskParams?.dailyLossKillPct ?? 0.03) * equity) {
      halted = true;
      haltedDaySet.add(currentDay);
    }

    // Open this symbol's position from a resting order or a fresh fill. Re-checks the
    // halt + exposure cap at FILL time: a resting order placed under a clear book that
    // would now breach the kill or the cap is cancelled instead of filled.
    const fillResting = (ro: RestingOrder): boolean => {
      let openExposureNotional = 0;
      for (const p of open.values()) openExposureNotional += p.notional;
      const capPct = input.riskParams?.maxConcurrentExposurePct ?? 0.6;
      if (halted || openExposureNotional + ro.notional > capPct * equity + 1e-9) return false;
      // Adverse entry fill at the post: a long buys higher, a short sells lower. In
      // maker mode `costRate` can be negative → the post is FAVORABLE and earns the rebate.
      const entrySign = ro.side === "long" ? 1 : -1;
      const entryAdv = ro.postPrice * costRate;
      totalCostsPaid += entryAdv * ro.units;
      open.set(ro.symbol, {
        symbol: ro.symbol,
        side: ro.side,
        entryPrice: ro.postPrice,
        units: ro.units,
        notional: ro.notional,
        stopPrice: ro.stopPrice,
        targetPrice: ro.targetPrice,
      });
      return true;
    };
    // A resting limit fills only when the market reaches it. With close-only data we
    // approximate off the close: a long bid fills if close <= post, a short ask if
    // close >= post. Conservative — it can't see intrabar lows/highs.
    const restingReached = (ro: RestingOrder): boolean =>
      ro.side === "long" ? bar.close <= ro.postPrice : bar.close >= ro.postPrice;

    // 4a) Expire-then-fill an existing resting order on this symbol (maker only).
    // The order lives for `makerMaxRestBars` bars counting the signal bar: it gets a
    // fill attempt on the signal bar (at placement, 4b) plus the next maxRestBars−1
    // bars here. Once that budget is spent it's cancelled before any further attempt.
    const existingRest = resting.get(bar.symbol);
    if (existingRest) {
      if (hist.length - existingRest.placedAtBarIndex >= makerMaxRestBars) {
        // Expired unfilled → cancel (the attempt was already counted at placement).
        resting.delete(bar.symbol);
      } else if (restingReached(existingRest) && fillResting(existingRest)) {
        makerFills++;
        resting.delete(bar.symbol);
      }
    }

    // 4b) Entry — only when flat on this symbol AND no resting order, and not halted.
    if (!open.has(bar.symbol) && !resting.has(bar.symbol) && !halted) {
      const sig = signal(bar, priorHistory);
      if (sig) {
        let openExposureNotional = 0;
        for (const p of open.values()) openExposureNotional += p.notional;
        const sized = sizeCompetitionTrade({
          equity,
          price: bar.close,
          stopDistance: sig.stopDistance,
          instrumentVolAnnual: bar.volAnnual,
          openExposureNotional,
          dailyPnL,
          edge: sig.edge,
          params: input.riskParams,
        });
        bindingHistogram[sized.bindingConstraint]++;
        if (sized.verdict === "halt") {
          halted = true;
          haltedDaySet.add(currentDay);
        } else if (sized.verdict === "trade" && sized.sizeUnits > 0) {
          const entrySign = sig.side === "long" ? 1 : -1;
          const entryAdv = bar.close * costRate;
          const postPrice = bar.close + entrySign * entryAdv;
          const stopPrice =
            sig.side === "long" ? bar.close - sig.stopDistance : bar.close + sig.stopDistance;
          const targetPrice =
            sig.targetDistance === undefined
              ? null
              : sig.side === "long"
                ? bar.close + sig.targetDistance
                : bar.close - sig.targetDistance;

          if (!isMaker) {
            // Taker entries always fill at the post (the crossed price).
            totalCostsPaid += entryAdv * sized.sizeUnits;
            open.set(bar.symbol, {
              symbol: bar.symbol,
              side: sig.side,
              entryPrice: postPrice,
              units: sized.sizeUnits,
              notional: sized.sizeNotional,
              stopPrice,
              targetPrice,
            });
          } else {
            // Maker: place a resting limit. It counts as one attempt; it persists and
            // is checked on this and subsequent bars (4a), filling if/when reached.
            makerAttempts++;
            const ro: RestingOrder = {
              symbol: bar.symbol,
              side: sig.side,
              postPrice,
              units: sized.sizeUnits,
              notional: sized.sizeNotional,
              stopPrice,
              targetPrice,
              placedAtBarIndex: hist.length,
              placedAtTime: bar.time,
            };
            // Try an immediate same-bar fill (a rebate-favorable post is reached at once).
            if (restingReached(ro) && fillResting(ro)) {
              makerFills++;
            } else if (makerMaxRestBars <= 1) {
              // Single-bar life and it didn't fill → cancel without resting.
            } else {
              resting.set(bar.symbol, ro);
            }
          }
        }
      }
    }

    // 5) Record equity + peak exposure.
    const finalEquityThisBar = markEquity(bar.time);
    equityCurve.push({ timestamp: bar.time, equity: finalEquityThisBar });
    let grossExposure = 0;
    for (const p of open.values()) grossExposure += p.notional;
    if (finalEquityThisBar > 0) {
      peakExposurePct = Math.max(peakExposurePct, grossExposure / finalEquityThisBar);
    }
  }

  // Close any still-open positions at the last seen price for final accounting.
  for (const pos of [...open.values()]) {
    const h = histBySymbol.get(pos.symbol);
    const last = h && h.length ? h[h.length - 1]! : null;
    if (last) closePosition(pos, last.close, last.time, "end");
  }

  const finalEquity = cash;
  const barReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) barReturns.push(cur / prev - 1);
  }

  const wins = trades.filter((t) => t.pnl > 0).length;

  const equityValues = equityCurve.map((p) => p.equity);
  const compSharpe = computeNonAnnualizedSharpe(equityValues);

  return {
    startingEquity,
    finalEquity,
    totalReturnPct: startingEquity > 0 ? (finalEquity / startingEquity - 1) : 0,
    competition: {
      returnPct: computeReturn(finalEquity, startingEquity),
      maxDrawdownPct: computeMaxDrawdown(equityValues),
      sharpe15m: compSharpe.sharpe,
      sharpe15mObs: compSharpe.nObs,
    },
    sharpe: calculateSharpeRatio(barReturns, riskFreeRate, periodsPerYear),
    sortino: calculateSortinoRatio(barReturns, riskFreeRate, periodsPerYear),
    annualizedVol: calculateVolatility(barReturns, periodsPerYear),
    maxDrawdownPct: calculateMaxDrawdown(equityCurve),
    tradeCount: trades.length,
    winRate: trades.length ? wins / trades.length : 0,
    totalCostsPaid,
    makerFillRate: isMaker ? (makerAttempts > 0 ? makerFills / makerAttempts : 0) : 1,
    haltedDays: haltedDaySet.size,
    peakExposurePct,
    bindingHistogram,
    trades,
    equityCurve,
  };
}

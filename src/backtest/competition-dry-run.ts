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

export interface CompetitionDryRunInput {
  /** Chronologically ordered bars across all symbols (interleave by time). */
  bars: DryRunBar[];
  signal: SignalFn;
  startingEquity: number;
  /** Bars per year for THIS series — drives annualization of the judged Sharpe
   *  (FX/metals ≈ 252 daily; crypto ≈ 365 daily; intraday = bars/year). */
  periodsPerYear: number;
  /** Risk-preset overrides; defaults to COMPETITION_RISK_DEFAULTS inside the sizer. */
  riskParams?: Partial<CompetitionRiskParams>;
  /** Annual risk-free rate for Sharpe/Sortino (default 0.02). */
  riskFreeRate?: number;
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
  /** Days on which the daily-loss-kill halted new entries. */
  haltedDays: number;
  /** Peak gross exposure as a fraction of equity reached during the run. */
  peakExposurePct: number;
  /** How often each constraint was the binding one at sizing time. */
  bindingHistogram: Record<BindingConstraint, number>;
  trades: DryRunTrade[];
  equityCurve: EquityPoint[];
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
  const riskFreeRate = input.riskFreeRate ?? 0.02;

  let cash = startingEquity; // realized equity; open PnL is added at mark time
  const open = new Map<string, OpenPosition>();
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
    const pnl = unrealized(pos, exitPrice);
    cash += pnl;
    trades.push({
      symbol: pos.symbol,
      side: pos.side,
      entryTime: histBySymbol.get(pos.symbol)?.[0]?.time ?? exitTime,
      exitTime,
      entryPrice: pos.entryPrice,
      exitPrice,
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
    const priorHistory = hist.slice();
    hist.push(bar);
    histBySymbol.set(bar.symbol, hist);

    // 3) Current equity & day PnL.
    const equity = markEquity(bar.time);
    const dailyPnL = equity - dayStartEquity;
    if (!halted && dailyPnL <= -(input.riskParams?.dailyLossKillPct ?? 0.03) * equity) {
      halted = true;
      haltedDaySet.add(currentDay);
    }

    // 4) Entry — only when flat on this symbol and not halted.
    if (!open.has(bar.symbol) && !halted) {
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
          const stopPrice =
            sig.side === "long" ? bar.close - sig.stopDistance : bar.close + sig.stopDistance;
          const targetPrice =
            sig.targetDistance === undefined
              ? null
              : sig.side === "long"
                ? bar.close + sig.targetDistance
                : bar.close - sig.targetDistance;
          open.set(bar.symbol, {
            symbol: bar.symbol,
            side: sig.side,
            entryPrice: bar.close,
            units: sized.sizeUnits,
            notional: sized.sizeNotional,
            stopPrice,
            targetPrice,
          });
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

  return {
    startingEquity,
    finalEquity,
    totalReturnPct: startingEquity > 0 ? (finalEquity / startingEquity - 1) : 0,
    sharpe: calculateSharpeRatio(barReturns, riskFreeRate, periodsPerYear),
    sortino: calculateSortinoRatio(barReturns, riskFreeRate, periodsPerYear),
    annualizedVol: calculateVolatility(barReturns, periodsPerYear),
    maxDrawdownPct: calculateMaxDrawdown(equityCurve),
    tradeCount: trades.length,
    winRate: trades.length ? wins / trades.length : 0,
    haltedDays: haltedDaySet.size,
    peakExposurePct,
    bindingHistogram,
    trades,
    equityCurve,
  };
}

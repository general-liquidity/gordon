/**
 * Fee-Schedule Sensitivity Sweep.
 *
 * Re-scores a strategy's per-round-trip GROSS returns under multiple fee
 * schedules (maker/taker or flat round-trip bps) and flags which schedules
 * flip the strategy from profit to loss.
 *
 * This is the Minara/Lighter finding made checkable: for high-frequency
 * strategies, fee drag — not the signal — is usually what kills the edge.
 * A strategy whose gross per-trade edge sits at 10 bps survives a 9 bps fee
 * schedule and dies at 18 bps; the break-even fee level is the gross mean
 * edge expressed in bps, and any schedule above it flips net PnL negative.
 *
 * FEE-TIER complement to the capacity/cost sweep in marketImpact.ts. That
 * module sweeps ORDER SIZE against an impact model; this one sweeps the
 * exchange FEE SCHEDULE against a fixed set of gross per-trade results. The
 * two are orthogonal: capacity asks "how big can I trade before impact eats
 * the edge", fee-sensitivity asks "which fee tier eats the edge regardless
 * of size".
 *
 * Pure / venue-agnostic: input is per-trade gross return fractions, never an
 * equity curve or a venue handle. Sharpe and profit factor are computed
 * inline because metrics.ts annualizes against a fixed 365-day constant and
 * profit-factor there consumes ClosedTrade[]; here the unit is a per-trade
 * fraction with a caller-supplied periodsPerYear.
 */

import {
  mean as statsMean,
  sampleStd as statsSampleStd,
  profitFactor as statsProfitFactor,
} from "../../core/stats/index.ts";

/** A fee tier to sweep. Either a flat round-trip cost OR maker+taker legs. */
export interface FeeSchedule {
  /** Human-readable tier label, e.g. "VIP-0 taker/taker" or "maker rebate". */
  label: string;
  /** Round-trip cost in basis points (entry + exit combined). */
  roundTripBps?: number;
  /** Maker-leg cost in bps (combined with takerBps when roundTripBps absent). */
  makerBps?: number;
  /** Taker-leg cost in bps (combined with makerBps when roundTripBps absent). */
  takerBps?: number;
}

export interface FeeSensitivityInput {
  /**
   * Per-ROUND-TRIP gross return as a fraction (e.g. +0.02 = +2%), before fees.
   * One entry per closed trade.
   */
  grossReturns: number[];
  /** Fee tiers to sweep. */
  schedules: FeeSchedule[];
  /** Periods per year for Sharpe annualization. Default 252. */
  periodsPerYear?: number;
}

export interface FeeScheduleResult {
  label: string;
  /** Resolved round-trip cost for this schedule, in bps. */
  roundTripBps: number;
  /** Compounded net total return over all trades (fraction). */
  netTotalReturn: number;
  /** Net mean return per trade (fraction). */
  netMeanPerTrade: number;
  /** Annualized Sharpe of net per-trade returns (mean/std * sqrt(periodsPerYear)). */
  netSharpe: number;
  /** Net profit factor = gross net-profit / |gross net-loss|. */
  profitFactor: number;
  /** True when gross total > 0 but net total <= 0 — the edge was a fee artifact. */
  flippedToLoss: boolean;
}

export interface FeeSensitivityResult {
  tradeCount: number;
  /** Gross mean return per trade (fraction). */
  grossMeanPerTrade: number;
  /** Compounded gross total return (fraction). */
  grossTotalReturn: number;
  /**
   * Break-even round-trip cost in bps = gross mean edge per trade in bps.
   * A schedule whose round-trip cost exceeds this flips the strategy to loss.
   */
  breakEvenRoundTripBps: number;
  perSchedule: FeeScheduleResult[];
  interpretation: string;
}

/** Resolve a schedule's round-trip cost fraction (e.g. 0.0009 for 9 bps). */
function roundTripCostFraction(schedule: FeeSchedule): number {
  if (schedule.roundTripBps !== undefined) {
    return schedule.roundTripBps / 1e4;
  }
  const maker = schedule.makerBps ?? 0;
  const taker = schedule.takerBps ?? 0;
  return (maker + taker) / 1e4;
}

/** Compounded total return from a series of per-trade return fractions. */
function compoundTotalReturn(returns: number[]): number {
  let equity = 1;
  for (let i = 0; i < returns.length; i++) {
    equity = equity * (1 + (returns[i] ?? 0));
  }
  return equity - 1;
}

/**
 * Annualized Sharpe of a per-trade return series: mean/std * sqrt(periodsPerYear).
 * Sample (n-1) std. Returns 0 when fewer than 2 trades or zero dispersion.
 */
function annualizedSharpe(returns: number[], periodsPerYear: number): number {
  if (returns.length < 2) return 0;
  const std = statsSampleStd(returns);
  if (std === 0) return 0;
  return (statsMean(returns) / std) * Math.sqrt(periodsPerYear);
}

/**
 * Re-score per-trade gross returns under each fee schedule and flag flips.
 *
 * Returns null (never throws) when there are no trades or no schedules.
 */
export function runFeeSensitivitySweep(
  input: FeeSensitivityInput,
): FeeSensitivityResult | null {
  const { grossReturns, schedules } = input;
  if (!grossReturns || grossReturns.length === 0) return null;
  if (!schedules || schedules.length === 0) return null;

  const periodsPerYear = input.periodsPerYear ?? 252;

  const tradeCount = grossReturns.length;
  const grossMeanPerTrade = statsMean(grossReturns);
  const grossTotalReturn = compoundTotalReturn(grossReturns);

  // Break-even round-trip cost: the fee level at which the mean edge vanishes,
  // expressed in bps. Gross mean fraction * 1e4 = bps.
  const breakEvenRoundTripBps = grossMeanPerTrade * 1e4;

  const perSchedule: FeeScheduleResult[] = schedules.map((schedule) => {
    const costFraction = roundTripCostFraction(schedule);
    const netReturns = grossReturns.map((g) => g - costFraction);

    const netTotalReturn = compoundTotalReturn(netReturns);
    const netMeanPerTrade = statsMean(netReturns);
    const netSharpe = annualizedSharpe(netReturns, periodsPerYear);
    const pf = statsProfitFactor(netReturns);
    const flippedToLoss = grossTotalReturn > 0 && netTotalReturn <= 0;

    return {
      label: schedule.label,
      roundTripBps: parseFloat((costFraction * 1e4).toFixed(4)),
      netTotalReturn: parseFloat(netTotalReturn.toFixed(8)),
      netMeanPerTrade: parseFloat(netMeanPerTrade.toFixed(8)),
      netSharpe: parseFloat((Number.isFinite(netSharpe) ? netSharpe : 0).toFixed(4)),
      profitFactor: parseFloat((Number.isFinite(pf) ? pf : 0).toFixed(4)),
      flippedToLoss,
    };
  });

  const flippedCount = perSchedule.filter((s) => s.flippedToLoss).length;
  const interpretation = buildInterpretation(
    grossTotalReturn,
    breakEvenRoundTripBps,
    flippedCount,
    perSchedule,
  );

  return {
    tradeCount,
    grossMeanPerTrade: parseFloat(grossMeanPerTrade.toFixed(8)),
    grossTotalReturn: parseFloat(grossTotalReturn.toFixed(8)),
    breakEvenRoundTripBps: parseFloat(breakEvenRoundTripBps.toFixed(4)),
    perSchedule,
    interpretation,
  };
}

function buildInterpretation(
  grossTotalReturn: number,
  breakEvenRoundTripBps: number,
  flippedCount: number,
  perSchedule: FeeScheduleResult[],
): string {
  if (grossTotalReturn <= 0) {
    return `Strategy is unprofitable BEFORE fees (gross total ${(grossTotalReturn * 100).toFixed(2)}%). Fee schedules only deepen the loss — the problem is the signal, not the fee tier.`;
  }

  const be = breakEvenRoundTripBps.toFixed(2);
  if (flippedCount === 0) {
    return `Gross edge ${be} bps/trade survives all ${perSchedule.length} fee schedule(s); none flip the strategy to a loss. Edge is fee-robust at the tested tiers.`;
  }
  if (flippedCount === perSchedule.length) {
    return `Break-even round-trip cost is ${be} bps/trade, and ALL ${perSchedule.length} tested schedule(s) exceed it — every fee tier flips the strategy to a loss. Classic fee-drag death: the gross edge is too thin to clear costs.`;
  }
  const flippedLabels = perSchedule
    .filter((s) => s.flippedToLoss)
    .map((s) => `${s.label} (${s.roundTripBps} bps)`)
    .join(", ");
  return `Break-even round-trip cost is ${be} bps/trade. ${flippedCount}/${perSchedule.length} schedule(s) flip the strategy to a loss: ${flippedLabels}. Fee tier — not signal — is the deciding variable here.`;
}

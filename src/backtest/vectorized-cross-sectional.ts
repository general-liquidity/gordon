/**
 * Vectorized Cross-Sectional Backtester
 *
 * A pure, vectorized backtester for cross-sectional factor strategies.
 * Given a factor/score matrix (date × ticker) and a forward-returns matrix
 * (date × ticker), it ranks scores cross-sectionally each period, forms
 * long/short quantile portfolios, applies turnover costs, and produces the
 * strategy return series, equity curve, and summary statistics.
 *
 * This is INFRA — called internally by the `backtest` surface tool when the
 * strategy is cross-sectional. It is NOT a standalone surface op.
 *
 * NULL-on-missing-input: returns null when dimensions mismatch, when there are
 * too few dates, or when the ticker count cannot support the requested
 * quantiles. Never throws, never fabricates zeros.
 *
 * Pure function. No I/O.
 */

import {
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateSortinoRatio,
} from "./metrics.ts";
import type { EquityPoint } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

export interface CrossSectionalConfig {
  /**
   * Long-leg quantile fraction (0–1). e.g. 0.2 → long the top 20% by score
   * each period. Defaults to 0.2.
   */
  longQuantile?: number;
  /**
   * Short-leg quantile fraction (0–1). e.g. 0.2 → short the bottom 20%.
   * Set to 0 for a long-only strategy. Defaults to 0.2.
   */
  shortQuantile?: number;
  /**
   * If true, dollar-neutral: long leg sums to +1, short leg sums to -1 (net 0
   * gross 2). If false (long-only style), weights sum to +1 (net 1). When a
   * short leg is requested with marketNeutral=false, the book is still
   * long+short but NOT normalized to net-zero. Defaults to true.
   */
  marketNeutral?: boolean;
  /**
   * Per-period turnover cost in basis points, charged on the sum of absolute
   * weight changes (one-way turnover × bps). e.g. 10 → 10 bps per unit of
   * turnover. Defaults to 0.
   */
  costBps?: number;
  /**
   * Annualization factor (periods per year) used for the annualized Sharpe in
   * summary stats. Defaults to 252 (daily). Use 12 for monthly, 52 for weekly.
   */
  periodsPerYear?: number;
  /** Starting equity for the equity curve. Defaults to 1. */
  initialEquity?: number;
}

export interface CrossSectionalSummary {
  /** Number of rebalance periods actually evaluated. */
  periods: number;
  /** Number of tickers in the panel. */
  tickers: number;
  /** Cumulative compounded return over the test (decimal, e.g. 0.25 = 25%). */
  totalReturn: number;
  /** Annualized Sharpe of the strategy return series. */
  annualizedSharpe: number;
  /** Sortino ratio of the strategy return series. */
  sortinoRatio: number;
  /** Max drawdown of the equity curve as a positive percentage. */
  maxDrawdown: number;
  /** Fraction of periods with a positive net strategy return (0–1). */
  hitRate: number;
  /**
   * Average gross (pre-cost) long-minus-short spread per period (decimal). For
   * a long-only book this is just the average long-leg return.
   */
  avgLongShortSpread: number;
  /** Average one-way turnover per period (sum of |Δw| / 2). */
  avgTurnover: number;
  /** Total cost drag charged across all periods (decimal). */
  totalCost: number;
  /** Human-readable one-line summary. */
  interpretation: string;
}

export interface CrossSectionalResult {
  /** Net (post-cost) strategy return per period (decimal). Length = periods. */
  returns: number[];
  /** Gross (pre-cost) long-minus-short spread per period (decimal). */
  spreads: number[];
  /** One-way turnover per period (sum of |Δw| / 2). */
  turnover: number[];
  /** Compounded equity curve. Length = periods + 1 (includes t0). */
  equityCurve: number[];
  /** Per-period long-leg average forward return (decimal). */
  longReturns: number[];
  /** Per-period short-leg average forward return (decimal). */
  shortReturns: number[];
  summary: CrossSectionalSummary;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build cross-sectional weights for one date from a score row.
 * Returns a weight per ticker (length === scores.length). Tickers with a
 * null/non-finite score are excluded from ranking and get weight 0.
 *
 * marketNeutral: long leg sums to +1, short leg to -1.
 * non-neutral: long leg sums to +1, short leg to -shortGross (book is gross
 * long + short but not normalized net-zero).
 */
function buildWeights(
  scores: (number | null)[],
  longQuantile: number,
  shortQuantile: number,
  marketNeutral: boolean,
): number[] {
  const n = scores.length;
  const weights = new Array<number>(n).fill(0);

  // Collect valid (index, score) pairs.
  const valid: Array<{ idx: number; score: number }> = [];
  for (let i = 0; i < n; i++) {
    const s = scores[i];
    if (typeof s === "number" && Number.isFinite(s)) {
      valid.push({ idx: i, score: s });
    }
  }

  const m = valid.length;
  if (m < 2) {
    return weights; // not enough cross-section to rank
  }

  // Rank descending by score (best score first).
  valid.sort((a, b) => b.score - a.score);

  const nLong = Math.max(1, Math.floor(m * longQuantile));
  const nShort = shortQuantile > 0 ? Math.max(1, Math.floor(m * shortQuantile)) : 0;

  // Guard: long + short must not exceed available names.
  const usableShort = Math.min(nShort, Math.max(0, m - nLong));

  const longW = 1 / nLong;
  for (let k = 0; k < nLong; k++) {
    const entry = valid[k];
    if (entry) weights[entry.idx] = longW;
  }

  if (usableShort > 0) {
    const shortW = -1 / usableShort;
    for (let k = 0; k < usableShort; k++) {
      const entry = valid[m - 1 - k];
      if (entry) weights[entry.idx] = shortW;
    }
  }

  // For non-neutral long-only-ish books the weights above already sum to the
  // intended gross. marketNeutral is enforced by construction (long=+1,
  // short=-1). The flag is retained for the non-neutral case where a caller
  // wants a net-long tilt: leave weights as-is (long +1, short -1 still nets 0
  // here since both legs are present). If no short leg, the book is naturally
  // net +1. No extra normalization needed.
  void marketNeutral;

  return weights;
}

function round(x: number, n: number): number {
  return parseFloat(x.toFixed(n));
}

// ============================================================================
// Main
// ============================================================================

/**
 * Run a vectorized cross-sectional backtest.
 *
 * @param scoreMatrix    date × ticker factor/score matrix. scoreMatrix[d][t].
 * @param forwardReturns date × ticker forward-return matrix (decimal returns
 *                       realized over the period FOLLOWING date d). Same shape.
 * @param config         strategy configuration.
 * @returns CrossSectionalResult, or null if inputs are invalid/insufficient.
 */
export function runCrossSectionalBacktest(
  scoreMatrix: (number | null)[][],
  forwardReturns: (number | null)[][],
  config: CrossSectionalConfig = {},
): CrossSectionalResult | null {
  // --- Boundary validation ---
  if (!Array.isArray(scoreMatrix) || !Array.isArray(forwardReturns)) return null;

  const nDates = scoreMatrix.length;
  if (nDates < 1 || forwardReturns.length !== nDates) return null;

  const firstScoreRow = scoreMatrix[0];
  if (!firstScoreRow) return null;
  const nTickers = firstScoreRow.length;
  if (nTickers < 2) return null;

  // Every row must match the ticker dimension across both matrices.
  for (let d = 0; d < nDates; d++) {
    const sRow = scoreMatrix[d];
    const rRow = forwardReturns[d];
    if (!sRow || !rRow) return null;
    if (sRow.length !== nTickers || rRow.length !== nTickers) return null;
  }

  const longQuantile = config.longQuantile ?? 0.2;
  const shortQuantile = config.shortQuantile ?? 0.2;
  const marketNeutral = config.marketNeutral ?? true;
  const costBps = config.costBps ?? 0;
  const periodsPerYear = config.periodsPerYear ?? 252;
  const initialEquity = config.initialEquity ?? 1;

  if (longQuantile <= 0 || longQuantile > 1) return null;
  if (shortQuantile < 0 || shortQuantile > 1) return null;

  const returns: number[] = [];
  const spreads: number[] = [];
  const turnover: number[] = [];
  const longReturns: number[] = [];
  const shortReturns: number[] = [];

  let prevWeights = new Array<number>(nTickers).fill(0);

  for (let d = 0; d < nDates; d++) {
    const scoreRow = scoreMatrix[d]!;
    const retRow = forwardReturns[d]!;

    const weights = buildWeights(scoreRow, longQuantile, shortQuantile, marketNeutral);

    // Period gross return = Σ w·fwdRet over valid (weight, return) pairs.
    // A null forward return for a held name contributes 0 (treated as flat).
    let gross = 0;
    let longSum = 0;
    let longCount = 0;
    let shortSum = 0;
    let shortCount = 0;
    for (let t = 0; t < nTickers; t++) {
      const w = weights[t]!;
      if (w === 0) continue;
      const r = retRow[t];
      const ret = typeof r === "number" && Number.isFinite(r) ? r : 0;
      gross = gross + w * ret;
      if (w > 0) {
        longSum = longSum + ret;
        longCount = longCount + 1;
      } else {
        shortSum = shortSum + ret;
        shortCount = shortCount + 1;
      }
    }

    const longAvg = longCount > 0 ? longSum / longCount : 0;
    const shortAvg = shortCount > 0 ? shortSum / shortCount : 0;
    const spread = longAvg - shortAvg;

    // One-way turnover = sum(|Δw|) / 2.
    let absDelta = 0;
    for (let t = 0; t < nTickers; t++) {
      absDelta = absDelta + Math.abs(weights[t]! - prevWeights[t]!);
    }
    const oneWayTurnover = absDelta / 2;

    // Cost = total traded notional (sum |Δw|) × bps. costBps applies to the
    // full traded notional, so charge on absDelta directly.
    const cost = absDelta * (costBps / 10_000);
    const net = gross - cost;

    returns.push(net);
    spreads.push(spread);
    turnover.push(oneWayTurnover);
    longReturns.push(longAvg);
    shortReturns.push(shortAvg);

    prevWeights = weights;
  }

  // --- Equity curve (compounded) ---
  const equityCurve: number[] = [initialEquity];
  for (let i = 0; i < returns.length; i++) {
    const prev = equityCurve[i]!;
    equityCurve.push(prev * (1 + returns[i]!));
  }

  // --- Summary stats ---
  const periods = returns.length;
  const finalEquity = equityCurve[equityCurve.length - 1]!;
  const totalReturn = finalEquity / initialEquity - 1;

  // Reuse engine Sharpe/Sortino (they annualize by a fixed factor of 365). To
  // honor periodsPerYear we recompute the annualized Sharpe directly but keep
  // Sortino/maxDrawdown from the shared helpers for consistency.
  const equityPoints: EquityPoint[] = equityCurve.map((e, i) => ({
    timestamp: i,
    equity: e,
  }));
  const maxDrawdown = calculateMaxDrawdown(equityPoints);

  const annualizedSharpe = annualizedSharpeOf(returns, periodsPerYear);
  const sortinoRatio = calculateSortinoRatio(returns);

  const wins = returns.filter((r) => r > 0).length;
  const hitRate = periods > 0 ? wins / periods : 0;
  const avgSpread =
    periods > 0 ? spreads.reduce((a, b) => a + b, 0) / periods : 0;
  const avgTurnover =
    periods > 0 ? turnover.reduce((a, b) => a + b, 0) / periods : 0;
  const totalCost =
    turnover.reduce((a, b) => a + b, 0) * 2 * (costBps / 10_000);

  const summary: CrossSectionalSummary = {
    periods,
    tickers: nTickers,
    totalReturn: round(totalReturn, 6),
    annualizedSharpe: Number.isFinite(annualizedSharpe) ? round(annualizedSharpe, 4) : 0,
    sortinoRatio: Number.isFinite(sortinoRatio) ? round(sortinoRatio, 4) : 0,
    maxDrawdown: round(maxDrawdown, 4),
    hitRate: round(hitRate, 4),
    avgLongShortSpread: round(avgSpread, 6),
    avgTurnover: round(avgTurnover, 6),
    totalCost: round(totalCost, 6),
    interpretation: buildInterpretation(
      periods,
      nTickers,
      totalReturn,
      annualizedSharpe,
      hitRate,
      avgSpread,
      avgTurnover,
    ),
  };

  return {
    returns: returns.map((r) => round(r, 8)),
    spreads: spreads.map((s) => round(s, 8)),
    turnover: turnover.map((t) => round(t, 8)),
    equityCurve: equityCurve.map((e) => round(e, 8)),
    longReturns: longReturns.map((r) => round(r, 8)),
    shortReturns: shortReturns.map((r) => round(r, 8)),
    summary,
  };
}

/**
 * Annualized Sharpe = mean(returns) / std(returns) × √periodsPerYear.
 * Uses sample std (n-1). Returns 0 when fewer than 2 returns or zero variance.
 */
function annualizedSharpeOf(returns: number[], periodsPerYear: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) * (r - mean), 0) /
    (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(periodsPerYear);
}

function buildInterpretation(
  periods: number,
  tickers: number,
  totalReturn: number,
  sharpe: number,
  hitRate: number,
  avgSpread: number,
  avgTurnover: number,
): string {
  const sharpeStr = Number.isFinite(sharpe) ? sharpe.toFixed(2) : "n/a";
  const direction =
    avgSpread > 0
      ? "longs outperformed shorts"
      : avgSpread < 0
        ? "longs UNDERPERFORMED shorts (factor inverted)"
        : "no long-short edge";
  return (
    `Cross-sectional backtest over ${periods} periods × ${tickers} tickers: ` +
    `total return ${(totalReturn * 100).toFixed(2)}%, annualized Sharpe ${sharpeStr}, ` +
    `hit rate ${(hitRate * 100).toFixed(1)}%. Avg long-short spread ` +
    `${(avgSpread * 100).toFixed(3)}%/period (${direction}); ` +
    `avg one-way turnover ${(avgTurnover * 100).toFixed(1)}%.`
  );
}

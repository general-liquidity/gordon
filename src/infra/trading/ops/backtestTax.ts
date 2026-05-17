/**
 * Backtest Tax (GORDON_BACKTEST_TAX).
 *
 * Port of Wright Ch 9's explicit rule before computing Kelly or any
 * conviction-based sizing:
 *
 *   "Assume your real-world parameters will be worse than your backtest
 *    suggests. Discount your estimated win rate by 10-20%. Discount
 *    your payoff ratio similarly. Then calculate Kelly on the discounted
 *    numbers."
 *
 * Implements Wright's margin-of-safety against overfitting, regime
 * decay, and the realized-vs-theoretical execution gap. Tax fractions
 * are caller-configurable; defaults match Wright's mid-range numbers.
 *
 * Pure compute. Composes upstream of WW1 pathDependentSizer when the
 * sizer's inputs derive from backtest stats. Composes with Q4
 * multipleTestingTracker (which deflates Sharpe for trial count) —
 * different correction, different stage. Apply both for raw backtest →
 * production parameter conversion.
 */

export const BACKTEST_TAX_FLAG_ENV = "GORDON_BACKTEST_TAX";

export function isBacktestTaxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[BACKTEST_TAX_FLAG_ENV] === "1" || env[BACKTEST_TAX_FLAG_ENV] === "true";
}

export interface BacktestStats {
  winRate: number;
  payoffRatio: number;
}

export interface TaxedStats extends BacktestStats {
  rawWinRate: number;
  rawPayoffRatio: number;
  winRateTaxFraction: number;
  payoffTaxFraction: number;
}

export interface TaxInput {
  stats: BacktestStats;
  /** Fraction to discount win-rate by. Default 0.15 (Wright's 10-20% midpoint). */
  winRateTaxFraction?: number;
  /** Fraction to discount payoff ratio by. Default 0.25 (Wright's 20-30% midpoint). */
  payoffTaxFraction?: number;
}

const DEFAULT_WIN_RATE_TAX = 0.15;
const DEFAULT_PAYOFF_TAX = 0.25;

export function applyBacktestTax(input: TaxInput): TaxedStats {
  const wTax = input.winRateTaxFraction ?? DEFAULT_WIN_RATE_TAX;
  const pTax = input.payoffTaxFraction ?? DEFAULT_PAYOFF_TAX;
  const rawWin = input.stats.winRate;
  const rawPayoff = input.stats.payoffRatio;
  return {
    rawWinRate: rawWin,
    rawPayoffRatio: rawPayoff,
    winRateTaxFraction: wTax,
    payoffTaxFraction: pTax,
    winRate: Math.max(0, rawWin * (1 - wTax)),
    payoffRatio: Math.max(0, rawPayoff * (1 - pTax)),
  };
}

/**
 * Expected R-multiple per trade after applying tax.
 *   E[R] = winRate × payoffRatio − (1 − winRate)
 * Negative result = strategy is unprofitable once the tax is applied.
 */
export function expectedRAfterTax(taxed: TaxedStats): number {
  return taxed.winRate * taxed.payoffRatio - (1 - taxed.winRate);
}

export function formatTaxedStats(taxed: TaxedStats): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return [
    `Backtest tax applied (win-rate −${pct(taxed.winRateTaxFraction)}, payoff −${pct(taxed.payoffTaxFraction)}):`,
    `  Win rate: ${pct(taxed.rawWinRate)} → ${pct(taxed.winRate)}`,
    `  Payoff:   ${taxed.rawPayoffRatio.toFixed(2)} → ${taxed.payoffRatio.toFixed(2)}`,
    `  Expected R after tax: ${expectedRAfterTax(taxed).toFixed(3)}`,
  ].join("\n");
}

export function taxToPayload(taxed: TaxedStats): Record<string, unknown> {
  return {
    kind: "backtest_tax.applied",
    rawWinRate: Number(taxed.rawWinRate.toFixed(4)),
    rawPayoffRatio: Number(taxed.rawPayoffRatio.toFixed(4)),
    taxedWinRate: Number(taxed.winRate.toFixed(4)),
    taxedPayoffRatio: Number(taxed.payoffRatio.toFixed(4)),
    expectedRAfterTax: Number(expectedRAfterTax(taxed).toFixed(4)),
  };
}
